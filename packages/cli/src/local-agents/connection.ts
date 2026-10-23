import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type AgentConnectionId, KaituError } from "@kaitu/core";
import type { AskMode, AskService } from "../ui/ask.js";
import { agentEnvironment, findAgent, localAgent, localAgents } from "./agents.js";
import { type McpCommand, agentModels, createAgentRuntime } from "./runtime.js";

export function createAgentConnection(options: {
  state: string;
  workspace: () => string;
  mcp: McpCommand;
  sdk: () => Pick<AskService, "settings" | "configure" | "models"> & {
    runtime(
      mode: AskMode,
      capabilities?: boolean,
      connection?: AgentConnectionId,
      textOnly?: boolean,
    ): ReturnType<typeof createAgentRuntime>;
    catalogSettings(includeSaved?: boolean): Promise<unknown>;
    support(method: string, input: Record<string, unknown>): Promise<unknown>;
  };
  env?: NodeJS.ProcessEnv;
}) {
  const file = join(options.state, "local-agent.json");
  let saved: { choice?: string; agent?: string; path?: string; model?: string } = existsSync(file)
    ? JSON.parse(readFileSync(file, "utf8"))
    : {};
  const save = (next: typeof saved) => {
    mkdirSync(options.state, { recursive: true, mode: 0o700 });
    writeFileSync(`${file}.tmp`, JSON.stringify(next), { mode: 0o600 });
    renameSync(`${file}.tmp`, file);
    saved = next;
  };
  const local = () => saved.choice === "local";
  // 每次发消息都会读设置；CLI 位置只在启动时找一次，模型列表按 CLI 缓存。
  let installed: { id: string; name: string; path: string }[] | undefined;
  const models = new Map<string, Promise<{ id: string; name?: string }[]>>();
  const find = (id: string, custom?: string) => {
    const agent = localAgent(id);
    return findAgent(agent, custom, agentEnvironment(agent, options.env));
  };
  const detected = () => {
    installed ??= localAgents.flatMap((agent) => {
      const path = find(agent.id);
      return path ? [{ id: agent.id, name: agent.name, path }] : [];
    });
    return installed;
  };
  const current = () => {
    const agent = localAgent(saved.agent);
    const path = saved.path ?? detected().find((item) => item.id === agent.id)?.path;
    return { agent, path };
  };
  const settings = async (resolveImages = false) => {
    if (!local())
      return { ...(await options.sdk().settings(resolveImages)), backend: "dsh", localAgents: detected() };
    const { agent, path } = current();
    return {
      choice: "local" as const,
      configured: !!path,
      provider: agent.id,
      providerName: agent.name,
      model: saved.model ?? "默认模型",
      supportsImages: false,
      supportsAttachments: false,
      // 换了 agent 或 CLI（另一个安装或登录环境）就算换了连接：旧对话要新建；换模型仍续接原会话。
      backend: `${agent.id}:${path ?? ""}`,
      localAgent: { id: agent.id, name: agent.name, path, status: path ? "installed" : "missing" },
      localAgents: detected(),
      fullOnly: true,
      protocols: [],
      providers: [],
    };
  };
  return {
    settings,
    async configure(input: Record<string, unknown>) {
      if (input.choice === "local") {
        const agent = localAgent(typeof input.agent === "string" ? input.agent : undefined);
        const selected = typeof input.path === "string" && input.path.trim() ? input.path.trim() : undefined;
        if (!find(agent.id, selected))
          throw new KaituError(
            `未找到 ${agent.name} CLI，请安装并登录，或填写已有 CLI 的绝对路径`,
            "AI_CONNECTION",
          );
        save({
          choice: "local",
          agent: agent.id,
          ...(selected ? { path: selected } : {}),
          ...(typeof input.model === "string" && input.model ? { model: input.model } : {}),
        });
        return settings();
      }
      const result = await options.sdk().configure(input);
      if (input.choice) save({ choice: String(input.choice) });
      return result;
    },
    async models(input: Record<string, unknown>) {
      if (typeof input.agent !== "string") return options.sdk().models(input);
      const agent = localAgent(input.agent);
      const path = find(agent.id, typeof input.path === "string" && input.path ? input.path : undefined);
      if (!path) throw new KaituError(`未找到 ${agent.name} CLI`, "AI_CONNECTION");
      let list = models.get(path);
      if (!list) {
        list = agentModels(agent, path, options.state, options.env);
        models.set(path, list);
        list.catch(() => models.delete(path));
      }
      return list;
    },
    async support(method: string, input: Record<string, unknown>) {
      if (method === "builtinSettings") return options.sdk().catalogSettings(input.saved === true);
      if (local()) throw new KaituError("本机 Agent 只接收文字，不能用附件和引用", "AI_CONNECTION");
      return options.sdk().support(method, input);
    },
    runtime(mode: AskMode, connection: AgentConnectionId = "local-ask", textOnly = false) {
      if (!local()) return options.sdk().runtime(mode, false, connection, textOnly);
      const { agent, path } = current();
      return createAgentRuntime({
        agent,
        model: saved.model,
        workspace: options.workspace(),
        state: options.state,
        path,
        mcp: { ...options.mcp, env: { ...options.mcp.env, KAITU_AGENT_CONNECTION: connection } },
        env: options.env,
        textOnly,
      });
    },
  };
}
