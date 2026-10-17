import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { KaituError } from "@kaitu/core";
import type { AskMode, AskRuntime } from "../ui/ask.js";
import { connectAcp } from "./acp.js";
import { agentEnvironment, detectAgent } from "./detection.js";
import { agentDefinition } from "./registry.js";
import { parseAgentFrame } from "./streams.js";
import type { LocalSelection, McpCommand } from "./types.js";

export async function createLocalAgentRuntime(options: {
  selection: LocalSelection;
  mode: AskMode;
  workspace: string;
  state: string;
  mcp: McpCommand;
  env?: NodeJS.ProcessEnv;
}): Promise<AskRuntime> {
  const { selection, mode, workspace, state, mcp } = options;
  const env = agentEnvironment(options.env);
  const def = agentDefinition(selection);
  const detected = await detectAgent(def, env);
  if (!detected.path || detected.status === "signed-out" || detected.status === "unavailable")
    throw new KaituError(
      `${def.name} ${detected.status === "signed-out" ? "尚未登录，请先在终端登录" : "不可用，请检查安装"}`,
      "AI_CONNECTION",
    );
  if (mode === "scoped" && !detected.scoped)
    throw new KaituError(
      detected.fullOnlyReason ?? "此 agent 仅支持完整 Agent，请先确认模式",
      "AI_CONNECTION",
    );
  const root = join(
    state,
    "local-agents",
    createHash("sha256")
      .update(JSON.stringify([workspace, selection, mode]))
      .digest("hex")
      .slice(0, 24),
  );
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const file = join(root, "sessions.json");
  const sessions: Record<string, string> = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
  const settingsFile = join(root, "gemini-settings.json");
  if (def.format === "gemini") {
    writeFileSync(settingsFile, JSON.stringify({ mcpServers: { kaitu: { ...mcp, trust: true } } }), {
      mode: 0o600,
    });
    env.GEMINI_CLI_SYSTEM_SETTINGS_PATH = settingsFile;
  }
  const saveSession = (id: string, upstream: string) => {
    if (typeof upstream !== "string" || !upstream) return;
    sessions[id] = upstream;
    writeFileSync(`${file}.tmp`, JSON.stringify(sessions), { mode: 0o600 });
    renameSync(`${file}.tmp`, file);
  };
  const listeners = new Set<(method: string, params: Record<string, unknown>) => void>();
  const active = new Map<string, { child: ChildProcessWithoutNullStreams; cancel: () => Promise<void> }>();
  const acpSessions = new Map<
    string,
    { child: ChildProcessWithoutNullStreams; rpc: ReturnType<typeof connectAcp>; upstream: string }
  >();
  const outputs = new Map<
    string,
    {
      text: (value: string) => void;
      tool: (id: string, name: string, args: unknown) => void;
      result: (id: string, value: unknown, error?: boolean) => void;
    }
  >();
  let closed = false;
  let seq = Date.now() * 1000;
  const notify = (method: string, params: Record<string, unknown>) => {
    for (const listener of listeners) listener(method, params);
  };
  const event = (sessionId: string, type: string, data: Record<string, unknown>) =>
    notify("session.event", { sessionId, event: { type, data, seq: ++seq } });
  const status = (sessionId: string, error?: string) =>
    notify("session.status", { sessionId, status: "idle", error });
  const terminate = async (child: ChildProcessWithoutNullStreams) => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const kill = (signal: NodeJS.Signals) => {
      try {
        if (process.platform !== "win32" && child.pid) process.kill(-child.pid, signal);
        else child.kill(signal);
      } catch {
        /* Already exited. */
      }
    };
    kill("SIGTERM");
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        kill("SIGKILL");
        resolve();
      }, 1000);
      child.once("close", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  };
  const launch = (id: string) => {
    const child = spawn(
      detected.path as string,
      def.args({ mode, resume: sessions[id], mcp, settingsFile }),
      { cwd: workspace, env, detached: process.platform !== "win32", stdio: ["pipe", "pipe", "pipe"] },
    );
    child.stdin.on("error", () => {});
    return child;
  };
  const prompt = async (id: string, content: { type: string; text?: string }[]) => {
    if (closed || active.has(id)) throw new KaituError("Agent 正忙或已关闭", "AI_CONNECTION");
    const text = content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n");
    const messageId = `local-${++seq}`;
    let answer = "";
    let cancelled = false;
    const output = {
      text(value: string) {
        if (!value || cancelled || closed) return;
        answer += value;
        event(id, "assistant/message", {
          message: { id: messageId, content: [{ type: "text", text: answer }] },
          localStream: true,
        });
      },
      session: (upstream: string) => saveSession(id, upstream),
      tool: (callId: string, name: string, args: unknown) =>
        event(id, "tool/call", { callId, name, arguments: JSON.stringify(args) }),
      result: (toolCallId: string, value: unknown, isError = false) =>
        event(id, "tool/result", {
          message: {
            toolCallId,
            isError,
            content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value) }],
          },
        }),
      error(message: string) {
        throw new Error(message);
      },
    };
    outputs.set(id, output);
    let child: ChildProcessWithoutNullStreams;
    let acp = acpSessions.get(id);
    if (acp) child = acp.child;
    else child = launch(id);
    let rpc: ReturnType<typeof connectAcp> | undefined;
    const cancel = async () => {
      cancelled = true;
      rpc?.notify("session/cancel", { sessionId: sessions[id] });
      await terminate(child);
      acpSessions.delete(id);
    };
    active.set(id, { child, cancel });
    event(id, "user/message", { content, source: { kind: "user" } });
    try {
      if (def.format === "acp") {
        child.stderr.resume();
        rpc =
          acp?.rpc ??
          connectAcp(child, {
            full: mode === "full",
            update: (params) => {
              const update = params.update as {
                sessionUpdate: string;
                content?: { type: string; text: string };
                toolCallId: string;
                title?: string;
                kind: string;
                rawInput?: unknown;
                status?: string;
              };
              if (update?.sessionUpdate === "agent_message_chunk" && update.content?.type === "text")
                outputs.get(id)?.text(update.content.text);
              if (update?.sessionUpdate === "tool_call")
                outputs.get(id)?.tool(update.toolCallId, update.title ?? update.kind, update.rawInput ?? {});
              if (update?.sessionUpdate === "tool_call_update")
                outputs.get(id)?.result(update.toolCallId, update.content, update.status === "failed");
            },
          });
        if (!acp) {
          const init = await rpc.request("initialize", {
            protocolVersion: 1,
            clientCapabilities: {},
            clientInfo: { name: "kaitu", version: "0.0.0" },
          });
          const mcpServers = [
            {
              name: "kaitu",
              ...mcp,
              env: Object.entries(mcp.env ?? {}).map(([name, value]) => ({ name, value })),
            },
          ];
          if (sessions[id] && !init.agentCapabilities?.loadSession)
            throw new Error("这个 ACP agent 不支持恢复已关闭的会话，请新建对话；原记录仍可查看");
          const result = await rpc.request(sessions[id] ? "session/load" : "session/new", {
            cwd: workspace,
            mcpServers,
            ...(sessions[id] ? { sessionId: sessions[id] } : {}),
          });
          const upstream = result.sessionId ?? sessions[id];
          if (!upstream) throw new Error("ACP agent 未返回会话 ID");
          saveSession(id, upstream);
          acp = { child, rpc, upstream };
          acpSessions.set(id, acp);
        }
        await rpc.request(
          "session/prompt",
          { sessionId: acp.upstream, prompt: [{ type: "text", text }] },
          30 * 60 * 1000,
        );
      } else {
        await new Promise<void>((resolve, reject) => {
          let failure: Error | undefined;
          let stderr = "";
          const lines = createInterface({ input: child.stdout });
          lines.on("line", (line) => {
            try {
              parseAgentFrame(def.format, JSON.parse(line), output);
            } catch (error) {
              if (error instanceof SyntaxError) return;
              failure = error as Error;
            }
          });
          child.stderr.on("data", (chunk) => {
            stderr = (stderr + chunk).slice(-2000);
          });
          child.once("error", () => reject(new Error(`${def.name} 无法启动，请检查安装`)));
          child.once("close", (code) => {
            lines.close();
            if (cancelled) resolve();
            else if (failure) reject(failure);
            else if (code !== 0)
              reject(
                new Error(
                  `${def.name} 回复未完成（退出 ${code}）。请检查登录、额度或网络。${/login|auth|sign.in/i.test(stderr) ? "请先在终端登录。" : ""}`,
                ),
              );
            else if (!answer) reject(new Error(`${def.name} 未返回文字，请检查 CLI 的登录状态与输出格式`));
            else resolve();
          });
          const instructions = `你正在开图问问中。使用 kaitu MCP 读写资料，遵守工作区 AGENTS.md，中文回答。${
            mode === "scoped"
              ? "默认模式只能经 MCP 读写资料和联网，不可执行命令或直接读写文件。\n"
              : "当前用户已确认完整 Agent 模式。\n"
          }`;
          child.stdin.end(`${instructions}${text}`);
        });
      }
      status(id);
    } catch (error) {
      acpSessions.delete(id);
      rpc?.close();
      await terminate(child);
      if (!cancelled) status(id, error instanceof Error ? error.message : "本机 Agent 回复未完成");
      else status(id);
    } finally {
      active.delete(id);
    }
  };
  return {
    async request(method, params) {
      const id = String(params.sessionId);
      if (method === "session/cancel") {
        await active.get(id)?.cancel();
        return {};
      }
      if (method !== "session/prompt") throw new Error("未知本机 Agent 请求");
      // Match the SDK's receipt contract; status notifications settle the turn.
      void prompt(id, params.contentBlocks as { type: string; text?: string }[]).catch((error) =>
        status(id, String(error)),
      );
      return {};
    },
    onNotification(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async close() {
      closed = true;
      await Promise.all([...active.values()].map((run) => run.cancel()));
      await Promise.all(
        [...acpSessions.values()].map(async ({ child, rpc }) => {
          rpc.close();
          await terminate(child);
        }),
      );
      acpSessions.clear();
      listeners.clear();
    },
  };
}
