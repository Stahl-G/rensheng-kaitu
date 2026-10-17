import type { AskMode } from "../ui/ask.js";

export interface McpCommand {
  command: string;
  args: string[];
  env?: Record<string, string>;
}
export interface Invocation {
  mode: AskMode;
  resume?: string;
  mcp: McpCommand;
  settingsFile: string;
}
export interface AgentDefinition {
  id: string;
  name: string;
  bin: string;
  format: "claude" | "codex" | "gemini" | "acp";
  authArgs?: string[];
  helpArgs?: string[];
  scopedFlags?: string[];
  fullOnlyReason?: string;
  args: (input: Invocation) => string[];
}
export interface AgentStatus {
  id: string;
  name: string;
  path?: string;
  version?: string;
  status: "missing" | "signed-out" | "ready" | "unknown" | "unavailable";
  detail?: string;
  scoped: boolean;
  fullOnlyReason?: string;
}
export interface LocalSelection {
  agent: string;
  command?: string;
  args?: string[];
}
