import { createHash } from "node:crypto";
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
  const stored = (): { choice?: string; path?: string } =>
    existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
  const local = () => stored().choice === "local";
  const detection = () => {
    const path = findCodeBuddy(stored().path, agentEnvironment(options.env));
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
      model: "CodeBuddy 默认 / Host default",
      supportsImages: false,
      supportsAttachments: false,
      backend: `codebuddy:${createHash("sha256")
        .update(detected.path ?? "missing")
        .digest("hex")
        .slice(0, 16)}`,
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
        if (input.agent !== "codebuddy")
          throw new KaituError("请选择 CodeBuddy / Select CodeBuddy", "AI_CONFIG");
        if (input.path !== undefined && typeof input.path !== "string")
          throw new KaituError("无效 CLI 路径 / Invalid CLI path", "AI_CONFIG");
        const selected = typeof input.path === "string" && input.path.trim() ? input.path.trim() : undefined;
        if (!findCodeBuddy(selected, agentEnvironment(options.env)))
          throw new KaituError(
            "未找到 CodeBuddy CLI，请安装并登录，或填写已有 CLI 的绝对路径 / CodeBuddy CLI not found",
            "AI_CONNECTION",
          );
        mkdirSync(options.state, { recursive: true, mode: 0o700 });
        writeFileSync(
          `${file}.tmp`,
          JSON.stringify({ choice: "local", ...(selected ? { path: selected } : {}) }),
          { mode: 0o600 },
        );
        renameSync(`${file}.tmp`, file);
        return settings();
      }
      const result = await options.sdk().configure(input);
      if (input.choice) {
        mkdirSync(options.state, { recursive: true, mode: 0o700 });
        writeFileSync(`${file}.tmp`, JSON.stringify({ choice: input.choice }), { mode: 0o600 });
        renameSync(`${file}.tmp`, file);
      }
      return result;
    },
    models: (input: Record<string, unknown>) => options.sdk().models(input),
    async support(method: string, input: Record<string, unknown>) {
      if (method === "builtinSettings") return options.sdk().settings();
      if (local())
        throw new KaituError(
          "CodeBuddy 首版只接收文字，不提供内置模型的附件或引用 / CodeBuddy accepts text only",
          "AI_CONNECTION",
        );
      return options.sdk().support(method, input);
    },
    runtime(mode: AskMode) {
      if (!local()) return options.sdk().runtime(mode);
      return createCodeBuddyRuntime({
        mode,
        workspace: options.workspace(),
        state: options.state,
        path: stored().path,
        mcp: options.mcp,
        env: options.env,
      });
    },
  };
}
