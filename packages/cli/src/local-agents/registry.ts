import { KaituError } from "@kaitu/core";
import { claude } from "./defs/claude.js";
import { codex } from "./defs/codex.js";
import { gemini } from "./defs/gemini.js";
import type { AgentDefinition, LocalSelection } from "./types.js";

export const agentDefinitions = [claude, codex, gemini];
export function agentDefinition(selection: LocalSelection): AgentDefinition {
  const builtIn = agentDefinitions.find((def) => def.id === selection.agent);
  if (builtIn) return builtIn;
  if (
    selection.agent !== "custom-acp" ||
    typeof selection.command !== "string" ||
    !selection.command.trim() ||
    !Array.isArray(selection.args) ||
    selection.args.some((arg) => typeof arg !== "string" || arg.length > 4096) ||
    selection.args.length > 64 ||
    selection.command.length > 4096
  )
    throw new KaituError("请填写 ACP 启动命令和参数数组", "AI_CONFIG");
  return {
    id: "custom-acp",
    name: "自定义 ACP agent",
    bin: selection.command.trim(),
    format: "acp",
    fullOnlyReason: "ACP 的权限拒绝不能隔离 agent 自身的文件和命令能力，未知 agent 仅支持完整 Agent。",
    args: () => selection.args ?? [],
  };
}
