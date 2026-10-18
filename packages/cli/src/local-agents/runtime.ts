import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { KaituError } from "@kaitu/core";
import type { AskMode, AskRuntime } from "../ui/ask.js";
import { connectAcp } from "./acp.js";
import { agentEnvironment, findCodeBuddy, launchCodeBuddy, terminateAgent } from "./codebuddy.js";
import { localAgentPrivacy } from "./privacy.js";

export interface McpCommand {
  command: string;
  args: string[];
  env?: Record<string, string>;
}
export async function createCodeBuddyRuntime(options: {
  mode: AskMode;
  workspace: string;
  state: string;
  path?: string;
  mcp: McpCommand;
  env?: NodeJS.ProcessEnv;
}): Promise<AskRuntime> {
  if (options.mode !== "full")
    throw new KaituError(
      "CodeBuddy 仅支持完整 Agent；请在对话中确认开启 / Enable full Agent mode for CodeBuddy",
      "AI_CONNECTION",
    );
  const env = agentEnvironment(options.env);
  const bin = findCodeBuddy(options.path, env);
  if (!bin)
    throw new KaituError(
      "未找到 CodeBuddy CLI，请安装并在官方 CLI 登录，或选择已有路径 / CodeBuddy CLI not found",
      "AI_CONNECTION",
    );
  const root = join(
    options.state,
    "local-agents",
    createHash("sha256")
      .update(JSON.stringify([options.workspace, "codebuddy", bin]))
      .digest("hex")
      .slice(0, 24),
  );
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const file = join(root, "sessions.json");
  const sessions: Record<string, string> = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
  type Session = {
    child: ReturnType<typeof launchCodeBuddy>;
    rpc: ReturnType<typeof connectAcp>;
    upstream: string;
    cancelled: boolean;
    busy: boolean;
    output: string;
    messageId: string;
  };
  const running = new Map<string, Session>();
  const listeners = new Set<(method: string, params: Record<string, unknown>) => void>();
  const cancelledError = new Error("cancelled");
  let closed = false;
  let seq = Date.now() * 1000;
  const notify = (method: string, params: Record<string, unknown>) => {
    for (const listener of listeners) listener(method, params);
  };
  const event = (id: string, type: string, data: Record<string, unknown>) =>
    notify("session.event", { sessionId: id, event: { type, data, seq: ++seq } });
  const idle = (id: string, error?: string) =>
    notify("session.status", { sessionId: id, status: "idle", error });
  const open = async (id: string) => {
    const child = launchCodeBuddy(bin, options.workspace, env);
    // Never surface CLI diagnostic output: it can contain account details.
    child.stderr.resume();
    const state = {
      child,
      rpc: undefined as unknown as ReturnType<typeof connectAcp>,
      upstream: "",
      cancelled: false,
      busy: false,
      output: "",
      messageId: "",
    };
    running.set(id, state);
    state.rpc = connectAcp(child, {
      full: true,
      update(params) {
        if (state.cancelled || !state.busy || closed) return;
        const u = params.update as {
          sessionUpdate?: string;
          content?: { type?: string; text?: string } | unknown[];
          toolCallId?: string;
          title?: string;
          kind?: string;
          rawInput?: unknown;
          rawOutput?: unknown;
          status?: string;
        };
        if (
          u?.sessionUpdate === "agent_message_chunk" &&
          !Array.isArray(u.content) &&
          u.content?.type === "text"
        ) {
          state.output += u.content.text ?? "";
          event(id, "assistant/delta", { messageId: state.messageId, text: state.output });
        } else if (u?.sessionUpdate === "tool_call") {
          event(id, "tool/call", {
            callId: u.toolCallId,
            name: u.title ?? u.kind ?? "CodeBuddy",
            arguments: JSON.stringify(u.rawInput ?? {}),
          });
        } else if (
          u?.sessionUpdate === "tool_call_update" &&
          ["completed", "failed"].includes(u.status ?? "")
        ) {
          event(id, "tool/result", {
            message: {
              toolCallId: u.toolCallId,
              isError: u.status === "failed",
              content: Array.isArray(u.content)
                ? u.content
                : [
                    {
                      type: "text",
                      text: typeof u.rawOutput === "string" ? u.rawOutput : JSON.stringify(u.rawOutput ?? {}),
                    },
                  ],
            },
          });
        }
      },
    });
    try {
      const init = await state.rpc.request("initialize", {
        protocolVersion: 1,
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
        clientInfo: { name: "kaitu", version: "0.1" },
      });
      const resume = sessions[id];
      const method = resume
        ? init.agentCapabilities?.loadSession
          ? "session/load"
          : init.agentCapabilities?.sessionCapabilities?.resume
            ? "session/resume"
            : undefined
        : "session/new";
      if (!method) throw new Error("resume unsupported");
      const result = await state.rpc.request(method, {
        cwd: options.workspace,
        mcpServers: [
          {
            name: "kaitu",
            ...options.mcp,
            env: Object.entries(options.mcp.env ?? {}).map(([name, value]) => ({ name, value })),
          },
        ],
        ...(resume ? { sessionId: resume } : {}),
      });
      state.upstream = result.sessionId ?? resume ?? "";
      if (!state.upstream) throw new Error("no session ID");
      sessions[id] = state.upstream;
      writeFileSync(`${file}.tmp`, JSON.stringify(sessions), { mode: 0o600 });
      renameSync(`${file}.tmp`, file);
      return state;
    } catch {
      state.rpc.close();
      await terminateAgent(child);
      running.delete(id);
      if (state.cancelled || closed) throw cancelledError;
      throw new KaituError(
        "CodeBuddy 未能连接或恢复，请检查官方 CLI 登录和网络；原记录保留，可新建对话重试 / Check CodeBuddy login and connection",
        "AI_CONNECTION",
      );
    }
  };
  const cancel = async (id: string) => {
    const state = running.get(id);
    if (!state) return;
    state.cancelled = true;
    state.rpc.notify("session/cancel", { sessionId: state.upstream });
    await terminateAgent(state.child);
    state.rpc.close();
    running.delete(id);
  };
  return {
    onNotification(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async request(method, params) {
      const id = String(params.sessionId ?? "");
      if (method === "session/cancel") {
        await cancel(id);
        return {};
      }
      if (method !== "session/prompt" || !id || closed)
        throw new KaituError("不支持此 Agent 请求 / Unsupported Agent request", "AI_CONNECTION");
      const content = params.contentBlocks as { type: string; text?: string }[];
      if (!Array.isArray(content) || content.some((item) => item.type !== "text"))
        throw new KaituError(
          "CodeBuddy 首版只接收文字，请移除附件 / CodeBuddy currently accepts text only",
          "AI_ATTACHMENT",
        );
      let state = running.get(id);
      if (state?.busy) throw new KaituError("CodeBuddy 正忙 / CodeBuddy is busy", "AI_CONNECTION");
      try {
        state ??= await open(id);
        state.busy = true;
        state.output = "";
        state.messageId = `codebuddy-${++seq}`;
        event(id, "user/message", { content, source: { kind: "user" } });
        const result = await state.rpc.request(
          "session/prompt",
          {
            sessionId: state.upstream,
            prompt: [
              { type: "text", text: localAgentPrivacy + content.map((item) => item.text ?? "").join("\n") },
            ],
          },
          30 * 60 * 1000,
        );
        if (!state.cancelled && result.stopReason !== "cancelled" && !state.output.trim())
          throw new Error("empty response");
        return {};
      } catch (error) {
        if (!state?.cancelled && !closed && error !== cancelledError) {
          if (state) {
            await terminateAgent(state.child);
            state.rpc.close();
            running.delete(id);
          }
          throw error instanceof KaituError
            ? error
            : new KaituError(
                "CodeBuddy 回复未完成，请检查登录、网络或账户额度后重试 / CodeBuddy reply failed; check login, network and account",
                "AI_CONNECTION",
              );
        }
        return {};
      } finally {
        if (state) {
          if (state.output)
            event(id, "assistant/message", {
              message: { id: state.messageId, content: [{ type: "text", text: state.output }] },
            });
          state.busy = false;
        }
        idle(id);
      }
    },
    async close() {
      closed = true;
      await Promise.all([...running.keys()].map(cancel));
      listeners.clear();
    },
  };
}
