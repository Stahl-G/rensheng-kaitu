import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { KaituError } from "@kaitu/core";
import type { AskRuntime } from "../ui/ask.js";
import { connectAcp, sessionModels } from "./acp.js";
import { type LocalAgent, agentEnvironment, launchAgent, terminateAgent } from "./agents.js";
import { localAgentPrivacy } from "./privacy.js";

export interface McpCommand {
  command: string;
  args: string[];
  env?: Record<string, string>;
}
const initialize = {
  protocolVersion: 1,
  clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
  clientInfo: { name: "kaitu", version: "0.1" },
};
/** 开一个空会话读出 agent 可选的模型，不发消息；会话放在开图自己的目录，不进资料文件夹。 */
export async function agentModels(agent: LocalAgent, bin: string, state: string, env?: NodeJS.ProcessEnv) {
  const cwd = join(state, "local-agents", "models");
  mkdirSync(cwd, { recursive: true, mode: 0o700 });
  const child = launchAgent(agent, bin, cwd, agentEnvironment(agent, env));
  child.stderr.resume();
  const rpc = connectAcp(child, { full: false, update() {}, timeout: 30000 });
  try {
    await rpc.request("initialize", initialize);
    return sessionModels(await rpc.request("session/new", { cwd, mcpServers: [] })).models;
  } catch {
    throw new KaituError(`${agent.name} 未能列出模型，请检查 CLI 登录和网络`, "AI_CONNECTION");
  } finally {
    rpc.close();
    await terminateAgent(child);
  }
}
export async function createAgentRuntime(options: {
  agent: LocalAgent;
  model?: string;
  workspace: string;
  state: string;
  path?: string;
  mcp: McpCommand;
  env?: NodeJS.ProcessEnv;
}): Promise<AskRuntime> {
  const { agent } = options;
  const env = agentEnvironment(agent, options.env);
  const bin = options.path;
  if (!bin)
    throw new KaituError(`未找到 ${agent.name} CLI，请安装并登录，或填写已有 CLI 的路径`, "AI_CONNECTION");
  // 开图对话 id → agent 会话 id，用来续接原会话。
  const root = join(options.state, "local-agents");
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const file = join(root, `${agent.id}-sessions.json`);
  const sessions: Record<string, string> = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
  type Session = {
    child: ReturnType<typeof launchAgent>;
    rpc: ReturnType<typeof connectAcp>;
    upstream: string;
    /** 新会话的第一条消息前带上隐私提醒；续接的会话里已经有了。 */
    fresh: boolean;
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
    const child = launchAgent(agent, bin, options.workspace, env);
    // Never surface CLI diagnostic output: it can contain account details.
    child.stderr.resume();
    const state = {
      child,
      rpc: undefined as unknown as ReturnType<typeof connectAcp>,
      upstream: "",
      fresh: false,
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
            name: u.title ?? u.kind ?? agent.name,
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
      const init = await state.rpc.request("initialize", initialize);
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
      state.fresh = method === "session/new";
      if (!state.upstream) throw new Error("no session ID");
      const choices = sessionModels(result);
      if (options.model && choices.current !== options.model) {
        const changed = await state.rpc.request(
          choices.configId ? "session/set_config_option" : "session/set_model",
          choices.configId
            ? { sessionId: state.upstream, configId: choices.configId, value: options.model }
            : { sessionId: state.upstream, modelId: options.model },
        );
        // 有的 agent 收下不存在的模型也不报错，回复时才拒绝；这里先核对。
        if (choices.configId && sessionModels(changed).current !== options.model)
          throw new Error("model unavailable");
      }
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
        `${agent.name} 未能连接或续接，请检查 CLI 登录、网络和所选模型；原记录保留，可新建对话重试`,
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
        throw new KaituError("不支持此 Agent 请求", "AI_CONNECTION");
      const content = params.contentBlocks as { type: string; text?: string }[];
      // 这个 agent 没见过这段对话（中途换过来的）：不续接旧会话，记录已经在提示词里。
      if (params.fresh && sessions[id]) {
        await cancel(id);
        delete sessions[id];
      }
      let state = running.get(id);
      if (state?.busy) throw new KaituError(`${agent.name} 正忙`, "AI_CONNECTION");
      try {
        state ??= await open(id);
        state.busy = true;
        state.output = "";
        state.messageId = `${agent.id}-${++seq}`;
        event(id, "user/message", { content, source: { kind: "user" } });
        const text = content.map((item) => item.text ?? "").join("\n");
        const done = await state.rpc.request(
          "session/prompt",
          {
            sessionId: state.upstream,
            prompt: [{ type: "text", text: (state.fresh ? localAgentPrivacy : "") + text }],
          },
          30 * 60 * 1000,
        );
        state.fresh = false;
        if (done.stopReason === "refusal")
          throw new KaituError(
            `${agent.name} 拒绝了这次请求，可能是所选模型不可用，换个模型再试`,
            "AI_CONNECTION",
          );
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
            : new KaituError(`${agent.name} 回复未完成，请检查登录、网络或账户额度后重试`, "AI_CONNECTION");
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
