import { mkdirSync, readdirSync, renameSync } from "node:fs";
import { basename, dirname, relative } from "node:path";
import { KaituError } from "./errors.js";
import { parseFrontmatter, stringifyFrontmatter } from "./frontmatter.js";
import { snapshot } from "./history.js";
import { batchOverview } from "./overview.js";
import { isoInZone, localDate } from "./time.js";
import { ulid } from "./ulid.js";
import type { Workspace } from "./workspace.js";

/** 无需模型的原文记录，供任意 Agent 后续整理。 */
export async function captureNote(ws: Workspace, text: string) {
  if (typeof text !== "string" || !text.trim() || text.length > 100000)
    throw new KaituError("请输入要记录的内容（最多 10 万字）", "BAD_ARGS");
  const now = new Date();
  const date = localDate(now, ws.timeZone());
  const path = `inbox/notes/${date}/${ulid().toLowerCase()}.md`;
  ws.writeText(
    path,
    stringifyFrontmatter(
      { agent: "你", date, created: isoInZone(now, ws.timeZone()), kind: "capture" },
      text.trim(),
    ),
  );
  return { path, version: await snapshot(ws, "你保存了一条原文记录，等待整理") };
}

export function noteAgent(value: unknown): string {
  return typeof value === "string" && value.trim()
    ? value
        .trim()
        .replace(/[\r\n]/g, " ")
        .slice(0, 100)
    : "云端 Agent";
}

export function noteMetadata(text: string): Record<string, unknown> {
  try {
    return parseFrontmatter(text).data;
  } catch {
    return {};
  }
}

export function inboxNotes(ws: Workspace) {
  if (!ws.exists("inbox/notes")) return [];
  return readdirSync(ws.resolve("inbox/notes"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(entry.name))
    .flatMap((entry) => {
      const dir = `inbox/notes/${entry.name}`;
      return readdirSync(ws.resolve(dir), { withFileTypes: true })
        .filter(
          (file) =>
            file.isFile() && file.name.endsWith(".md") && ws.scanText(`${dir}/${file.name}`) !== undefined,
        )
        .map((file) => {
          const path = `${dir}/${file.name}`;
          const content = ws.readText(path);
          const data = noteMetadata(content);
          return { path, agent: noteAgent(data.agent), date: data.date ?? entry.name, content };
        });
    })
    .sort((a, b) => b.path.localeCompare(a.path));
}

export function findInboxNote(ws: Workspace, name: string, directory = "inbox/notes"): string | undefined {
  if (!ws.exists(directory)) return;
  for (const entry of readdirSync(ws.resolve(directory), { withFileTypes: true })) {
    const file = `${directory}/${entry.name}`;
    if (entry.isDirectory()) {
      const found = findInboxNote(ws, name, file);
      if (found) return found;
    } else if (entry.isFile() && entry.name === name) return file;
  }
}

export function availableInboxPath(ws: Workspace, directory: string, name: string) {
  let target = `${directory}/${name}`;
  while (ws.exists(target)) {
    const dot = name.lastIndexOf(".");
    const suffix = ulid().toLowerCase();
    target = `${directory}/${dot < 0 ? `${name}-${suffix}` : `${name.slice(0, dot)}-${suffix}${name.slice(dot)}`}`;
  }
  return target;
}

export function moveInboxFile(ws: Workspace, file: string, directory: string) {
  const target = availableInboxPath(ws, directory, basename(file));
  mkdirSync(dirname(ws.resolve(target)), { recursive: true });
  renameSync(ws.resolve(file), ws.resolve(target));
  return target;
}

export async function inboxNoteDone(ws: Workspace, path: string, actor = "Agent") {
  const file = relative(ws.root, ws.resolve(path)).split("\\").join("/");
  if (!inboxNotes(ws).some((note) => note.path === file)) {
    throw new KaituError("找不到待整理笔记", "NOT_FOUND");
  }
  let target = "";
  await batchOverview(ws, async () => {
    const attachment = noteMetadata(ws.readText(file)).attachment;
    const directory = `inbox/notes/done/${localDate(new Date(), ws.timeZone())}`;
    if (typeof attachment === "string" && dirname(attachment) === `${dirname(file)}/files`) {
      // 附件和笔记一起归档。
      const moved = moveInboxFile(ws, attachment, `${directory}/files`);
      const text = ws.readText(file).replaceAll(attachment, moved);
      ws.writeText(file, text);
    }
    target = moveInboxFile(ws, file, directory);
  });
  const version = await snapshot(ws, `${actor}整理了一条收件箱笔记：${basename(file)}`);
  return { path: target, version };
}
