import type { AgentDefinition } from "../types.js";

export const claude: AgentDefinition = {
  id: "claude",
  name: "Claude Code",
  bin: "claude",
  format: "claude",
  authArgs: ["auth", "status"],
  helpArgs: ["-p", "--help"],
  scopedFlags: ["--tools", "--permission-mode", "--strict-mcp-config", "--settings", "--setting-sources"],
  args: ({ mode, resume, mcp }) => [
    "-p",
    "--output-format",
    "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--strict-mcp-config",
    "--mcp-config",
    JSON.stringify({ mcpServers: { kaitu: mcp } }),
    "--setting-sources",
    "",
    "--settings",
    JSON.stringify({ disableAllHooks: true }),
    ...(mode === "scoped"
      ? [
          "--permission-mode",
          "dontAsk",
          "--tools",
          "WebSearch,WebFetch",
          "--allowedTools",
          "WebSearch,WebFetch,mcp__kaitu__*",
        ]
      : ["--permission-mode", "bypassPermissions"]),
    ...(resume ? ["--resume", resume] : []),
  ],
};
