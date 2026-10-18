import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { KaituError } from "@kaitu/core";
import type { AskMode, AskService } from "../ui/ask.js";
import { agentEnvironment, findCodeBuddy } from "./codebuddy.js";
import { type McpCommand, createCodeBuddyRuntime } from "./runtime.js";

export function createAgentConnection(options: {
  state: string;
  workspace: () => string;
  mcp: McpCommand;
  sdk: () => Pick<AskService, "settings" | "configure" | "models"> & {
    runtime(mode: AskMode): ReturnType<typeof createCodeBuddyRuntime>;
    support(method: string, input: Record<string, unknown>): Promise<unknown>;
  };
  env?: NodeJS.ProcessEnv;
}) {
  const file = join(options.state, "local-agent.json");
  let saved: { choice?: string; path?: string } = existsSync(file)
    ? JSON.parse(readFileSync(file, "utf8"))
    : {};
  const save = (next: typeof saved) => {
    mkdirSync(options.state, { recursive: true, mode: 0o700 });
    writeFileSync(`${file}.tmp`, JSON.stringify(next), { mode: 0o600 });
    renameSync(`${file}.tmp`, file);
    saved = next;
    found = undefined;
  };
  const local = () => saved.choice === "local";
  // 每次发消息都会读设置；CLI 位置只在启动和重新连接时找一次。
  let found: { path?: string } | undefined;
  const detection = () => {
    found ??= { path: findCodeBuddy(saved.path, agentEnvironment(options.env)) };
    const { path } = found;
    return { id: "codebuddy", name: "CodeBuddy", path, status: path ? "installed" : "missing" };
  };
  const settings = async () => {
    if (!local()) return { ...(await options.sdk().settings()), backend: "dsh" };
    const detected = detection();
    return {
      choice: "local" as const,
      configured: !!detected.path,
      provider: "codebuddy",
      providerName: "CodeBuddy",
      model: "CodeBuddy 默认",
      supportsImages: false,
      supportsAttachments: false,
      backend: "codebuddy",
      localAgent: detected,
      fullOnly: true,
      protocols: [],
      providers: [],
    };
  };
  return {
    settings,
    async configure(input: Record<string, unknown>) {
      if (input.choice === "local") {
        const selected = typeof input.path === "string" && input.path.trim() ? input.path.trim() : undefined;
        if (!findCodeBuddy(selected, agentEnvironment(options.env)))
          throw new KaituError(
            "未找到 CodeBuddy CLI，请安装并登录，或填写已有 CLI 的绝对路径",
            "AI_CONNECTION",
          );
        save({ choice: "local", ...(selected ? { path: selected } : {}) });
        return settings();
      }
      const result = await options.sdk().configure(input);
      if (input.choice) save({ choice: String(input.choice) });
      return result;
    },
    models: (input: Record<string, unknown>) => options.sdk().models(input),
    async support(method: string, input: Record<string, unknown>) {
      if (method === "builtinSettings") return options.sdk().settings();
      if (local()) throw new KaituError("CodeBuddy 只接收文字，不能用附件和引用", "AI_CONNECTION");
      return options.sdk().support(method, input);
    },
    runtime(mode: AskMode) {
      if (!local()) return options.sdk().runtime(mode);
      return createCodeBuddyRuntime({
        workspace: options.workspace(),
        state: options.state,
        path: detection().path,
        mcp: options.mcp,
        env: options.env,
      });
    },
  };
}
