import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { KaituError } from "@kaitu/core";
import type { AskMode, AskRuntime, AskService } from "../ui/ask.js";
import { detectAgents } from "./detection.js";
import { agentDefinition } from "./registry.js";
import { createLocalAgentRuntime } from "./runtime.js";
import type { LocalSelection, McpCommand } from "./types.js";

interface SdkConnection {
  settings(): Promise<Awaited<ReturnType<AskService["settings"]>> & Record<string, unknown>>;
  configure(input: Record<string, unknown>): Promise<unknown>;
  runtime(mode: AskMode): Promise<AskRuntime>;
}
export function createAgentConnection(options: {
  state: string;
  workspace: string;
  mcp: McpCommand;
  sdk?: () => SdkConnection;
  env?: NodeJS.ProcessEnv;
}) {
  const file = join(options.state, "local-agent.json");
  const stored = (): { choice?: string; selection?: LocalSelection } =>
    existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
  const save = (value: unknown) => {
    mkdirSync(options.state, { recursive: true, mode: 0o700 });
    writeFileSync(`${file}.tmp`, JSON.stringify(value), { mode: 0o600 });
    renameSync(`${file}.tmp`, file);
  };
  const base = () =>
    options.sdk?.().settings() ??
    Promise.resolve({
      configured: false,
      provider: "deepseek-official",
      providerName: "DeepSeek",
      model: "deepseek-flash",
      providers: [],
      protocols: [],
      supportsImages: false,
    });
  const detect = () => detectAgents(stored().selection, options.env);
  const settings = async () => {
    const value = stored();
    const previous = await base();
    if (value.choice !== "local" || !value.selection) return previous;
    const agents = await detect();
    const selected = agents.find((item) => item.id === value.selection?.agent);
    return {
      ...previous,
      choice: "local" as const,
      configured: !!selected?.path && !["signed-out", "unavailable"].includes(selected.status),
      provider: value.selection.agent,
      providerName: selected?.name,
      model: "由 Agent 管理",
      supportsImages: false,
      localAgent: value.selection,
      agents,
      search: undefined,
    };
  };
  return {
    settings,
    detect,
    async configure(input: Record<string, unknown>) {
      if (input.choice === "local") {
        const selection = input.localAgent as LocalSelection;
        if (!selection) throw new KaituError("请选择本机 Agent", "AI_CONFIG");
        agentDefinition(selection);
        save({ choice: "local" as const, selection });
        return settings();
      }
      if (!options.sdk) throw new KaituError("API Key 连接请在 Kaitu.app 中设置", "AI_CONFIG");
      const result = await options.sdk().configure(input);
      if (input.choice) save({ choice: input.choice, selection: stored().selection });
      return result;
    },
    async runtime(mode: AskMode) {
      const value = stored();
      if (value.choice === "local" && value.selection)
        return createLocalAgentRuntime({ ...options, mode, selection: value.selection });
      if (!options.sdk) throw new KaituError("请先连接电脑上的 AI", "AI_CONNECTION");
      return options.sdk().runtime(mode);
    },
  };
}
