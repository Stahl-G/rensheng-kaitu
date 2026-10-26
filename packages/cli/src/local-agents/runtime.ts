import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { KaituError, workspaceAgentGuide, workspaceTaskSkill } from "@kaitu/core";
import type { AskRuntime } from "../ui/ask.js";
import { connectAcp, sessionModels, sessionModes } from "./acp.js";
import { type LocalAgent, agentEnvironment, launchAgent, terminateAgent } from "./agents.js";
import { localAgentPrivacy } from "./privacy.js";

/** 同一 agent 的不同 CLI 路径各有一份会话表，避免串用 upstream session id。 */
function sessionsPath(root: string, agentId: string, cliPath?: string) {
  const key = cliPath ? createHash("sha256").update(resolve(cliPath)).digest("hex").slice(0, 16) : "default";
  return join(root, `${agentId}-${key}-sessions.json`);
}

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
function permissionModes(agent: LocalAgent, result: Parameters<typeof sessionModes>[0]) {
  const modes = sessionModes(result);
  return {
    ...modes,
    modes: modes.modes.filter(
      (item) =>
        ["default", "ask"].includes(item.id) ||
        (item.id === agent.autoMode &&
          /review|classif|审查|分类/i.test(item.description ?? "") &&
          /den(y|ied)|reject|拒绝/i.test(item.description ?? "") &&
          !/skip.*(?:permission|check)|bypass/i.test(item.description ?? "")),
    ),
  };
}
/** 开一个空会话读出 agent 可选的模型，不发消息；会话放在开图自己的目录，不进资料文件夹。 */
export async function agentSessionOptions(
  agent: LocalAgent,
  bin: string,
  state: string,
  env?: NodeJS.ProcessEnv,
) {
  const cwd = join(state, "local-agents", "models");
  mkdirSync(cwd, { recursive: true, mode: 0o700 });
  const child = launchAgent(agent, bin, cwd, agentEnvironment(agent, env));
  child.stderr.resume();
  const rpc = connectAcp(child, { update() {}, timeout: 30000 });
  try {
    await rpc.request("initialize", initialize);
    const result = await rpc.request("session/new", { cwd, mcpServers: [] });
    const modes = permissionModes(agent, result);
    return {
      models: sessionModels(result).models,
      permissionModes: {
        current: modes.current,
        modes: modes.modes,
      },
    };
  } catch {
    throw new KaituError(`${agent.name} 未能列出模型，请检查 CLI 登录和网络`, "AI_CONNECTION");
  } finally {
    rpc.close();
    await terminateAgent(child);
  }
}
export async function agentModels(agent: LocalAgent, bin: string, state: string, env?: NodeJS.ProcessEnv) {
  return (await agentSessionOptions(agent, bin, state, env)).models;
}
export async function createAgentRuntime(options: {
  agent: LocalAgent;
  model?: string;
  permissionMode?: string;
  workspace: string;
  state: string;
  path?: string;
  mcp: McpCommand;
  env?: NodeJS.ProcessEnv;
  /** 只收发文字的一次性对话。本机 Agent 自带读文件和命令工具，开图无法事前关掉，所以不接。 */
  textOnly?: boolean;
}): Promise<AskRuntime> {
  const { agent } = options;
  if (options.textOnly)
    throw new KaituError(`${agent.name} 自带读文件和命令工具，不能用于只收发文字的对话`, "AI_CONNECTION");
  const env = agentEnvironment(agent, options.env);
  const bin = options.path;
  if (!bin)
    throw new KaituError(`未找到 ${agent.name} CLI，请安装并登录，或填写已有 CLI 的路径`, "AI_CONNECTION");
  // 开图对话 id → agent 会话 id，用来续接原会话（按 CLI 路径分开存）。
  const root = join(options.state, "local-agents");
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const file = sessionsPath(root, agent.id, bin);
  const legacy = join(root, `${agent.id}-sessions.json`);
  // 升级后新文件按路径分存；找不到时退回读旧的单文件，避免已有对话丢上下文。
  const sessions: Record<string, string> = existsSync(file)
    ? JSON.parse(readFileSync(file, "utf8"))
    : existsSync(legacy)
      ? JSON.parse(readFileSync(legacy, "utf8"))
      : {};
  const persistSessions = () => {
    writeFileSync(`${file}.tmp`, JSON.stringify(sessions), { mode: 0o600 });
    renameSync(`${file}.tmp`, file);
  };
  type Session = {
    child: ReturnType<typeof launchAgent>;
    rpc: ReturnType<typeof connectAcp>;
    upstream: string;
    /** 新会话首条消息带同源任务指引与隐私提醒；续接不重复。 */
    fresh: boolean;
    cancelled: boolean;
    permissionExpired: boolean;
    busy: boolean;
    skills: Set<string>;
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
  const permissions = new Map<
    string,
    {
      sessionId: string;
      options: { optionId: string; kind: string; name: string }[];
      finish: (optionId: string | null, status: string) => void;
    }
  >();
  const cancelPermissions = (id: string) => {
    for (const permission of permissions.values())
      if (permission.sessionId === id) permission.finish(null, "cancelled");
  };
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
      permissionExpired: false,
      busy: false,
      skills: new Set<string>(),
      output: "",
      messageId: "",
    };
    running.set(id, state);
    state.rpc = connectAcp(child, {
      permission(params) {
        if (state.cancelled || closed) return Promise.resolve(null);
        const choices = Array.isArray(params.options)
          ? params.options.filter(
              (item): item is { optionId: string; kind: string; name: string } =>
                !!item &&
                typeof item === "object" &&
                typeof item.optionId === "string" &&
                (["allow_once", "reject_once"].includes(item.kind) ||
                  (item.kind === "allow" && item.optionId === "allow_once")),
            )
          : [];
        const requestId = `native-${randomUUID()}`;
        return new Promise<string | null>((resolve) => {
          const timer = setTimeout(() => permissions.get(requestId)?.finish(null, "expired"), 60000);
          const finish = (optionId: string | null, status: string) => {
            if (!permissions.delete(requestId)) return;
            clearTimeout(timer);
            event(id, "approval/resolved", { requestId, optionId, status });
            resolve(optionId);
            if (status === "expired") {
              state.permissionExpired = true;
              state.rpc.notify("session/cancel", { sessionId: state.upstream });
              state.rpc.close();
            }
          };
          permissions.set(requestId, { sessionId: id, options: choices, finish });
          const tool = params.toolCall as { title?: string; rawInput?: unknown } | undefined;
          event(id, "approval/asked", {
            requestId,
            reason: typeof tool?.title === "string" ? tool.title : `${agent.name} 请求单次操作权限`,
            detail: JSON.stringify(tool?.rawInput ?? {}),
            options: choices.map((choice) => ({ ...choice, name: choice.name ?? choice.optionId })),
          });
        });
      },
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
                ? u.content.map((block) => {
                    // ACP wraps ContentBlock in { type: "content", content }.
                    // Ask renders the same flat text blocks as the native SDK.
                    const value = block as { type?: string; content?: { type?: string } };
                    return value?.type === "content" && value.content?.type ? value.content : block;
                  })
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
    const resume = sessions[id];
    try {
      const init = await state.rpc.request("initialize", initialize);
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
      if (options.permissionMode) {
        const modes = permissionModes(agent, result);
        if (
          !["default", "ask", agent.autoMode].includes(options.permissionMode) ||
          !modes.modes.some((item) => item.id === options.permissionMode)
        )
          throw new KaituError(
            `${agent.name} 未提供所选权限模式，消息未发送，请重新选择`,
            "AI_PERMISSION_MODE",
          );
        const changed = await state.rpc
          .request(modes.configId ? "session/set_config_option" : "session/set_mode", {
            sessionId: state.upstream,
            ...(modes.configId
              ? { configId: modes.configId, value: options.permissionMode }
              : { modeId: options.permissionMode }),
          })
          .catch(() => {
            throw new KaituError(
              `${agent.name} 未能切换权限模式，消息未发送；可切回询问模式重试`,
              "AI_PERMISSION_MODE",
            );
          });
        // 旧 session/set_mode 的成功响应可以是空对象；configOptions 必须回报所选值。
        const applied = sessionModes(changed).current;
        if ((modes.configId || applied !== undefined) && applied !== options.permissionMode)
          throw new KaituError(`${agent.name} 未确认所选权限模式，消息未发送`, "AI_PERMISSION_MODE");
      }
      sessions[id] = state.upstream;
      persistSessions();
      return state;
    } catch (error) {
      cancelPermissions(id);
      state.rpc.close();
      await terminateAgent(child);
      running.delete(id);
      // 续接失败时丢掉这条映射，下次改走新建，避免坏 id 一直卡住。
      if (resume && sessions[id] === resume) {
        delete sessions[id];
        persistSessions();
      }
      if (state.cancelled || closed) throw cancelledError;
      if (error instanceof KaituError) throw error;
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
    cancelPermissions(id);
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
      if (method === "session/permission") {
        const requestId = String(params.requestId ?? "");
        const permission = permissions.get(requestId);
        if (closed || !permission || permission.sessionId !== id)
          throw new KaituError("操作审批已处理或过期", "CONFLICT");
        const optionId = params.optionId;
        const choice = permission.options.find((item) => item.optionId === optionId);
        if (optionId !== null && !choice)
          throw new KaituError("请选择本次操作提供的单次审批选项", "BAD_ARGS");
        permission.finish(
          optionId === null ? null : String(optionId),
          choice && ["allow", "allow_once"].includes(choice.kind) ? "approved" : "rejected",
        );
        return {};
      }
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
        persistSessions();
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
        const skill = workspaceTaskSkill(text);
        const skillText = skill && !state.skills.has(skill.name) ? `\n\n${skill.text}\n\n` : "";
        const done = await state.rpc.request(
          "session/prompt",
          {
            sessionId: state.upstream,
            prompt: [
              {
                type: "text",
                text:
                  (state.fresh ? `${workspaceAgentGuide()}\n\n${localAgentPrivacy}` : "") + skillText + text,
              },
            ],
          },
          30 * 60 * 1000,
        );
        state.fresh = false;
        if (skill) state.skills.add(skill.name);
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
          if (state?.permissionExpired)
            throw new KaituError(
              "批准请求已过期，已结束这轮。重新发送可再次请求批准",
              "AI_APPROVAL_REQUIRED",
            );
          throw error instanceof KaituError
            ? error
            : new KaituError(`${agent.name} 回复未完成，请检查登录、网络或账户额度后重试`, "AI_CONNECTION");
        }
        return {};
      } finally {
        cancelPermissions(id);
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
