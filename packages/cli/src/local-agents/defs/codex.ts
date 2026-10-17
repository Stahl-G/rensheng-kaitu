import type { AgentDefinition } from "../types.js";

export const codex: AgentDefinition = {
  id: "codex",
  name: "Codex",
  bin: "codex",
  format: "codex",
  authArgs: ["login", "status"],
  fullOnlyReason: "Codex 的只读沙箱仍可执行命令、读取工作区外文件，无法落实默认模式的资料范围。",
  args: ({ resume, mcp }) => [
    "exec",
    ...(resume ? ["resume", resume] : []),
    "--json",
    "--skip-git-repo-check",
    "-c",
    'sandbox_mode="workspace-write"',
    "-c",
    'approval_policy="never"',
    "-c",
    "sandbox_workspace_write.network_access=true",
    "-c",
    `mcp_servers.kaitu.command=${JSON.stringify(mcp.command)}`,
    "-c",
    `mcp_servers.kaitu.args=${JSON.stringify(mcp.args)}`,
    ...Object.entries(mcp.env ?? {}).flatMap(([key, value]) => [
      "-c",
      `mcp_servers.kaitu.env.${key}=${JSON.stringify(value)}`,
    ]),
    "-",
  ],
};
