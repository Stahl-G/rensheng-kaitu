import { mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
import { dirname, extname } from "node:path";
import { type Workspace, readAgentFile, snapshot, validateWorkspace, writeAgentsMd } from "@kaitu/core";

function visiblePath(ws: Workspace, file: string): string {
  const path = ws.resolve(file);
  if (file.split(/[\\/]/).some((part) => part.startsWith("."))) throw new Error("不允许访问隐藏目录");
  return path;
}

export function listFiles(ws: Workspace, directory: string) {
  const path = directory === "" ? ws.root : visiblePath(ws, directory);
  return readdirSync(path, { withFileTypes: true })
    .filter((entry) => !entry.name.startsWith("."))
    .map((entry) => ({ name: entry.name, directory: entry.isDirectory() }));
}

/** 文件编辑只开放文档和模块定义，结构化记录与记忆走 core 的专用写入接口。 */
export async function writeFiles(
  ws: Workspace,
  files: { path: string; content: string }[],
  confirmed: boolean,
) {
  const previous = new Map<string, string | undefined>();
  for (const { path, content } of files) {
    visiblePath(ws, path);
    if (![".md", ".json"].includes(extname(path))) throw new Error("只允许写 Markdown / JSON");
    if (
      ["AGENTS.md", "AGENT-README.md", "ORGANIZER.md", "OVERVIEW.md"].includes(path) ||
      path.startsWith("memory/") ||
      path.startsWith("chats/") ||
      (path.includes("/data/") && !/^health\/data\/labs\/[^/]+\.json$/.test(path))
    )
      throw new Error("此路径由开图管理，请用专用工具");
    if (["me/rules.md", "me/goals.json"].includes(path) && !confirmed)
      throw new Error("规则或目标变更须用户确认");
    if (extname(path) === ".json") JSON.parse(content);
    if (previous.has(path)) throw new Error("一次写入不能包含重复路径");
    previous.set(path, ws.exists(path) ? readAgentFile(ws, path) : undefined);
  }
  try {
    for (const { path, content } of files) ws.writeText(path, content);
    const issues = validateWorkspace(ws).filter((issue) => files.some((file) => issue.file === file.path));
    if (issues.length) throw new Error(JSON.stringify(issues));
  } catch (error) {
    for (const [path, content] of previous) {
      if (content === undefined) rmSync(ws.resolve(path), { force: true });
      else ws.writeText(path, content);
    }
    throw error;
  }
  if (files.some((file) => file.path.endsWith("/module.json"))) writeAgentsMd(ws);
  return { files: files.map((file) => file.path), version: await snapshot(ws, "DeepSeek 更新了工作区文档") };
}

export async function archiveHandoffs(ws: Workspace, files: string[], date: string) {
  for (const file of files) {
    if (!/^handoffs\/[^/]+\.md$/.test(file)) throw new Error("只归档 handoffs 根目录的交接记录");
    const target = `handoffs/archive/${date}/${file.slice("handoffs/".length)}`;
    visiblePath(ws, file);
    visiblePath(ws, target);
    if (ws.exists(target)) throw new Error(`归档已存在：${target}`);
  }
  for (const file of files) {
    const target = ws.resolve(`handoffs/archive/${date}/${file.slice("handoffs/".length)}`);
    mkdirSync(dirname(target), { recursive: true });
    renameSync(ws.resolve(file), target);
  }
  return { version: await snapshot(ws, "DeepSeek 归档了已整理交接") };
}
