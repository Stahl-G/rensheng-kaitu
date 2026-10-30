import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, relative } from "node:path";
import { KaituError } from "./errors.js";
import { frontmatterBody, parseFrontmatter, stringifyFrontmatter } from "./frontmatter.js";
import { invalidateHistoryFile, snapshot } from "./history.js";
import { batchOverview } from "./overview.js";
import { phoneInboxName } from "./phone-actions.js";
import { isoInZone, localDate } from "./time.js";
import { ulid } from "./ulid.js";
import type { Workspace } from "./workspace.js";

/** 原文的固定身份；归档后仍用保存时的日期和文件名。 */
export function isCaptureSource(source: unknown): source is string {
  if (typeof source !== "string") return false;
  const match = /^inbox\/notes\/\d{4}-\d{2}-\d{2}\/([a-zA-Z0-9.-]+)$/.exec(source);
  if (!match || match[0] !== source) return false;
  const name = match[1] ?? "";
  return /^[0-9a-z]{26}\.md$/.test(name) || (name.endsWith(".note.md") && phoneInboxName.test(name));
}

function captureName(file: string): string {
  const name = basename(file);
  // availableInboxPath adds a ULID when two originals collide in the archive.
  return file.startsWith("inbox/notes/done/") ? name.replace(/-[0-9a-z]{26}(?=\.md$)/, "") : name;
}

export function originalCaptureSource(file: string, data: Record<string, unknown>): string | null {
  const source =
    data.kind === "capture" && typeof data.date === "string"
      ? `inbox/notes/${data.date}/${captureName(file)}`
      : null;
  return isCaptureSource(source) ? source : null;
}

/** Exact live path first; only matching archive filenames need their metadata read. */
export function findCaptureNote(ws: Workspace, source: string): string | undefined {
  if (!isCaptureSource(source)) return;
  if (ws.exists(source)) return source;
  const name = basename(source);
  const archived = (directory: string): string | undefined => {
    if (!ws.exists(directory)) return;
    for (const entry of readdirSync(ws.resolve(directory), { withFileTypes: true })) {
      const file = `${directory}/${entry.name}`;
      if (entry.isDirectory()) {
        const found = archived(file);
        if (found) return found;
      } else if (
        entry.isFile() &&
        captureName(file) === name &&
        originalCaptureSource(file, noteMetadata(ws.scanText(file) ?? "")) === source
      )
        return file;
    }
  };
  const file = archived("inbox/notes/done");
  if (!file && findInboxNote(ws, name)) throw new KaituError("原文来源与保存记录不一致", "BAD_ARGS");
  return file;
}

/** 无需模型的原文记录，供任意 Agent 后续整理。 */
export async function captureNote(ws: Workspace, text: string, investment?: string, limit = 100000) {
  if (typeof text !== "string" || !text.trim() || text.length > limit)
    throw new KaituError("请输入要记录的内容（最多 10 万字）", "BAD_ARGS");
  const now = new Date();
  const date = localDate(now, ws.timeZone());
  const path = `inbox/notes/${date}/${ulid().toLowerCase()}.md`;
  ws.writeText(
    path,
    stringifyFrontmatter(
      {
        agent: "你",
        date,
        created: isoInZone(now, ws.timeZone()),
        kind: "capture",
        ...(investment ? { investment } : {}),
      },
      text.trim(),
    ),
  );
  return { path, version: await snapshot(ws, "你保存了一条原文记录") };
}

export type CaptureReceipt = { status: "not_found" | "saved" | "uncertain"; path: string | null };
type CaptureIntent = { version: 1; path: string; hash: string };
const operationIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function captureIntentPath(ws: Workspace, operationId: string) {
  if (!operationIdPattern.test(operationId)) throw new KaituError("记录操作编号不合法", "BAD_ARGS");
  return ws.resolve(`.kaitu/capture-operations/${operationId.toLowerCase()}.json`, { internal: true });
}
const captureHash = (text: string) => createHash("sha256").update(text.trim()).digest("hex");
function captureIntent(file: string): CaptureIntent | null {
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as CaptureIntent;
    if (parsed.version !== 1 || !isCaptureSource(parsed.path) || !/^[a-f0-9]{64}$/.test(parsed.hash))
      return null;
    return parsed;
  } catch {
    return null;
  }
}

/** A missing receipt is safe to create; an incomplete/moved receipt must never trigger another write. */
export function readCaptureReceipt(ws: Workspace, operationId: string): CaptureReceipt {
  const file = captureIntentPath(ws, operationId);
  if (!existsSync(file)) return { status: "not_found", path: null };
  const intent = captureIntent(file);
  if (!intent || !ws.exists(intent.path)) return { status: "uncertain", path: null };
  try {
    const content = ws.readText(intent.path);
    if (noteMetadata(content).kind !== "capture" || captureHash(frontmatterBody(content)) !== intent.hash)
      return { status: "uncertain", path: null };
  } catch {
    return { status: "uncertain", path: null };
  }
  return { status: "saved", path: intent.path };
}

/** Local operation receipt is created before the note, so retry never silently writes a second copy. */
export async function captureNoteOnce(
  ws: Workspace,
  text: string,
  operationId: string,
  options: { scheduleVersion?: (message: string) => void } = {},
) {
  if (typeof text !== "string" || !text.trim() || text.length > 100000)
    throw new KaituError("请输入要记录的内容（最多 10 万字）", "BAD_ARGS");
  const file = captureIntentPath(ws, operationId);
  const now = new Date();
  const date = localDate(now, ws.timeZone());
  const intent: CaptureIntent = {
    version: 1,
    path: `inbox/notes/${date}/${ulid().toLowerCase()}.md`,
    hash: captureHash(text),
  };
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  try {
    writeFileSync(file, JSON.stringify(intent), { flag: "wx", mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const prior = captureIntent(file);
    if (prior && prior.hash !== intent.hash) throw new KaituError("这个记录操作已用于其他内容", "CONFLICT");
    const receipt = readCaptureReceipt(ws, operationId);
    return {
      ...(receipt.status === "not_found" ? { status: "uncertain" as const, path: null } : receipt),
      version: null,
    };
  }
  ws.writeText(
    intent.path,
    stringifyFrontmatter(
      { agent: "你", date, created: isoInZone(now, ws.timeZone()), kind: "capture" },
      text.trim(),
    ),
  );
  try {
    if (options.scheduleVersion) {
      options.scheduleVersion("你保存了一条原文记录");
      return { status: "saved" as const, path: intent.path, version: null };
    }
    return {
      status: "saved" as const,
      path: intent.path,
      version: await snapshot(ws, "你保存了一条原文记录"),
    };
  } catch {
    return { status: "saved" as const, path: intent.path, version: null, versionError: true };
  }
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

/** Count usable notes for summary views without reading their bodies. */
export function countInboxNotes(ws: Workspace, directory = "inbox/notes") {
  if (!ws.exists(directory)) return 0;
  let count = 0;
  for (const date of readdirSync(ws.resolve(directory), { withFileTypes: true })) {
    if (!date.isDirectory() || !/^\d{4}-\d{2}-\d{2}$/.test(date.name)) continue;
    const dir = `${directory}/${date.name}`;
    for (const entry of readdirSync(ws.resolve(dir), { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
      const path = `${dir}/${entry.name}`;
      if (!ws.conflictCopy(path) && !ws.isUnavailable(path)) count++;
    }
  }
  return count;
}

export function inboxNotes(ws: Workspace, directory = "inbox/notes", options: { from?: string } = {}) {
  if (!ws.exists(directory)) return [];
  return readdirSync(ws.resolve(directory), { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        /^\d{4}-\d{2}-\d{2}$/.test(entry.name) &&
        (!options.from || entry.name >= options.from),
    )
    .flatMap((entry) => {
      const dir = `${directory}/${entry.name}`;
      return readdirSync(ws.resolve(dir), { withFileTypes: true })
        .filter((file) => file.isFile() && file.name.endsWith(".md"))
        .flatMap((file) => {
          const path = `${dir}/${file.name}`;
          // 原文没变时不重新读取和解析。
          const note = ws.scanParsed(path, "note", (content) => ({
            content,
            data: noteMetadata(content),
            firstLine:
              frontmatterBody(content)
                .split("\n")
                .find((line) => line.trim())
                ?.trim() ?? "（空）",
          }));
          return note
            ? [
                {
                  path,
                  agent: noteAgent(note.data.agent),
                  date: note.data.date ?? entry.name,
                  kind: note.data.kind,
                  investment: note.data.investment,
                  content: note.content,
                  firstLine: note.firstLine,
                },
              ]
            : [];
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
  invalidateHistoryFile(ws, file);
  invalidateHistoryFile(ws, target);
  return target;
}

/** 把一条笔记（连同附件）移到 done/ 归档，不单独存版本，由调用方决定。 */
export function archiveInboxNote(ws: Workspace, file: string): string {
  const attachment = noteMetadata(ws.readText(file)).attachment;
  const directory = `inbox/notes/done/${localDate(new Date(), ws.timeZone())}`;
  if (typeof attachment === "string" && dirname(attachment) === `${dirname(file)}/files`) {
    // 附件和笔记一起归档。
    const moved = moveInboxFile(ws, attachment, `${directory}/files`);
    const text = ws.readText(file).replaceAll(attachment, moved);
    ws.writeText(file, text);
  }
  return moveInboxFile(ws, file, directory);
}

export async function inboxNoteDone(ws: Workspace, path: string, actor = "Agent") {
  const file = relative(ws.root, ws.resolve(path)).split("\\").join("/");
  if (!inboxNotes(ws).some((note) => note.path === file)) {
    throw new KaituError("找不到待整理笔记", "NOT_FOUND");
  }
  let target = "";
  await batchOverview(ws, async () => {
    target = archiveInboxNote(ws, file);
  });
  const version = await snapshot(ws, `${actor}整理了一条收件箱笔记：${basename(file)}`);
  return { path: target, version };
}
