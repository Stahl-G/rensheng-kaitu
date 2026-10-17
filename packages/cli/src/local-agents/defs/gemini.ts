import type { AgentDefinition } from "../types.js";

export const gemini: AgentDefinition = {
  id: "gemini",
  name: "Gemini CLI",
  bin: "gemini",
  format: "gemini",
  fullOnlyReason: "尚未核实 Gemini CLI 可同时隔离本机文件与禁用所有命令入口，首批仅提供完整 Agent。",
  args: ({ resume }) => [
    "--output-format",
    "stream-json",
    "--approval-mode",
    "yolo",
    "--allowed-mcp-server-names",
    "kaitu",
    ...(resume ? ["--resume", resume] : []),
  ],
};
