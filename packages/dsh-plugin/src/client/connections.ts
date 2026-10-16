export function aiHandover(workspace: string, prompt = "") {
  return `请接续我的开图工作区：${workspace}\n先读 AGENT-README.md 和 OVERVIEW.md，再读相关交接。${prompt ? `\n这次要处理：${prompt}` : ""}`;
}
