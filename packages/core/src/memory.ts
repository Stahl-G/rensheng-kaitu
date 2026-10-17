import { readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { KaituError } from "./errors.js";
import { parseFrontmatter, stringifyFrontmatter } from "./frontmatter.js";
import { snapshot } from "./history.js";
import type { By } from "./records.js";
import { formatErrors, schemas } from "./schema.js";
import { isoInZone, localDate } from "./time.js";
import { ulid } from "./ulid.js";
import type { Workspace } from "./workspace.js";

export type MemoryType = "preference" | "fact" | "context" | "person" | "decision";

export interface MemoryInput {
  type: MemoryType;
  name: string;
  text: string;
  source?: string;
  sensitive?: boolean;
}

export type MemoryPatch = Partial<Pick<MemoryInput, "name" | "text" | "type" | "sensitive">>;

export interface Memory extends MemoryInput {
  created: string;
  updated: string;
}

export interface MemoryEntry extends Memory {
  file: string;
}

export interface MemoryOptions {
  by?: By;
  now?: Date;
  actor?: string;
}

const TYPES: Record<MemoryType, string> = {
  preference: "偏好",
  fact: "事实",
  context: "背景",
  person: "人物",
  decision: "决定",
};

function who(by: By | undefined): string {
  if (by === "user") return "你";
  if (by?.startsWith("import:")) return `导入（${by.slice("import:".length)}）时`;
  return "Agent ";
}

function validateMemory(memory: Memory): void {
  const fn = schemas().builtin("memory.schema.json");
  if (!fn(memory)) {
    const issues = formatErrors(fn.errors)
      .map((i) => `${i.path} ${i.message}`)
      .join("；");
    throw new KaituError(`记忆不合法：${issues}`, "INVALID_MEMORY");
  }
}

/** 新建的记忆用 <类型>_<英文>.md；用户或 Agent 自己放进 memory/ 的任何 .md 也当记忆读。 */
function memoryPath(file: string): string {
  if (!/^[^/\\]+\.md$/.test(file) || file.startsWith(".") || file === "MEMORY.md") {
    throw new KaituError(`不是合法的记忆文件名：${file}`, "INVALID_MEMORY");
  }
  return `memory/${file}`;
}

const MEMORY_TYPES: MemoryType[] = ["preference", "fact", "context", "person", "decision"];

export function memoryType(value: unknown): MemoryType | undefined {
  return MEMORY_TYPES.find((type) => type === value);
}

/** AI 交来的记忆：名字没写就取正文开头。 */
export function memoryInput(raw: Record<string, unknown>): MemoryInput {
  const type = memoryType(raw.type);
  if (!type)
    throw new KaituError("记忆类型只能是 preference、fact、context、person、decision", "INVALID_MEMORY");
  const text = typeof raw.text === "string" && raw.text.trim() ? raw.text : undefined;
  if (!text) throw new KaituError("记忆没有正文 text", "INVALID_MEMORY");
  const name = typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : text.trim().slice(0, 30);
  return {
    type,
    name,
    text: text.trim(),
    ...(typeof raw.source === "string" && raw.source.trim() ? { source: raw.source.trim() } : {}),
    ...(sensitiveFlag(raw.sensitive) ? { sensitive: true } : {}),
  };
}

/** 写了敏感标记就从严：只有没写或明确写否（false、no、否、0）才算不敏感，"true"、"是" 都算敏感。 */
function sensitiveFlag(value: unknown): boolean {
  if (value === undefined || value === null || value === false || value === "") return false;
  return !/^(false|no|否|0)$/i.test(String(value).trim());
}

/** 读一份记忆文件：frontmatter 缺的字段从文件名、标题和正文补，读不出正文才不算记忆。 */
function looseMemory(file: string, raw: string, fallbackDate: string): Memory | undefined {
  let data: Record<string, unknown> = {};
  let body = raw;
  // frontmatter 写坏时读不出是否敏感，按敏感处理（不进资料包），正文照常显示。
  let broken = false;
  try {
    const parsed = parseFrontmatter(raw);
    data = parsed.data;
    body = parsed.body;
  } catch {
    broken = true;
    body = raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
  }
  const heading = /^#\s+(.+)$/m.exec(body)?.[1]?.trim();
  const content = (heading ? body.replace(/^#\s+.+$/m, "") : body).trim();
  const text = (typeof data.text === "string" && data.text.trim()) || content || heading;
  if (!text) return undefined;
  const base = file.replace(/\.md$/, "");
  const name =
    (typeof data.name === "string" && data.name.trim()) ||
    heading ||
    base.replace(/^(preference|fact|context|person|decision)_/, "") ||
    text.slice(0, 30);
  // 没写的才从文件名、修改时间补；写了却认不出的类型和日期原样保留，让校验报出来，写回时也不丢。
  const absent = (value: unknown) => value === undefined || value === null || value === "";
  // 写成数字的日期（20261017）按文字保留：校验能报出来，排序也不会因为它出错。
  const date = (value: unknown) => (absent(value) ? fallbackDate : String(value));
  return {
    ...data,
    type: absent(data.type)
      ? (memoryType(base.split("_")[0]) ?? "context")
      : (memoryType(data.type) ?? data.type),
    name,
    text,
    created: date(data.created),
    updated: date(data.updated ?? data.created),
    sensitive: broken || sensitiveFlag(data.sensitive),
    ...(typeof data.source === "string" ? { source: data.source } : {}),
  } as Memory;
}

function availableFile(ws: Workspace, type: MemoryType, name: string, current?: string): string {
  const slug =
    name
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "") || ulid().slice(-8).toLowerCase();
  const base = `${type}_${slug}`;
  let file = `${base}.md`;
  let suffix = 2;
  while (file !== current && ws.exists(memoryPath(file))) file = `${base}-${suffix++}.md`;
  return file;
}

/** 校验和读取用同一份补齐后的记忆：没有 frontmatter 的普通 Markdown 也算合法记忆。 */
export function normalizedMemory(ws: Workspace, file: string): Memory | undefined {
  const path = memoryPath(file);
  const text = ws.scanText(path);
  if (text === undefined) return undefined;
  return looseMemory(file, text, localDate(statSync(ws.resolve(path)).mtime, ws.timeZone()));
}

function readMemory(ws: Workspace, file: string): { data: Memory; body: string } {
  const path = memoryPath(file);
  if (!ws.exists(path)) throw new KaituError(`找不到记忆：${file}`, "NOT_FOUND");
  const text = ws.readText(path);
  const data = looseMemory(file, text, localDate(statSync(ws.resolve(path)).mtime, ws.timeZone()));
  if (!data) throw new KaituError(`记忆没有正文：${file}`, "INVALID_MEMORY");
  let body = "";
  try {
    body = parseFrontmatter(text).body;
  } catch {}
  return { data, body };
}

export function listMemories(ws: Workspace): MemoryEntry[] {
  if (!ws.exists("memory")) return [];
  const order = Object.keys(TYPES);
  return readdirSync(ws.resolve("memory"))
    .filter((file) => file.endsWith(".md") && file !== "MEMORY.md" && !file.startsWith("."))
    .flatMap((file) => {
      // 同步冲突副本不是记忆，先跳过，免得一份副本让全部记忆读不出来。
      if (ws.conflictCopy(`memory/${file}`)) return [];
      // 文件没变时直接用上次解析的结果；字段不全的照样读，补不出正文的才跳过。
      const path = memoryPath(file);
      const data = ws.scanParsed(path, "memory", (text) =>
        looseMemory(file, text, localDate(statSync(ws.resolve(path)).mtime, ws.timeZone())),
      );
      return data ? [{ ...data, file }] : [];
    })
    .sort(
      (a, b) =>
        order.indexOf(a.type) - order.indexOf(b.type) ||
        String(b.updated).localeCompare(String(a.updated)) ||
        a.file.localeCompare(b.file),
    );
}

export function searchMemories(ws: Workspace, query: string): MemoryEntry[] {
  const term = query.toLowerCase();
  return listMemories(ws).filter(
    (m) => m.name.toLowerCase().includes(term) || m.text.toLowerCase().includes(term),
  );
}

function rewriteIndex(ws: Workspace): void {
  const lines = listMemories(ws).map((m) => {
    const name = m.name.replace(/\s+/g, " ").trim();
    const text = m.text.replace(/\s+/g, " ").trim();
    const summary = text.match(/^.*?(?:[。！？]|[.!?](?=\s|$)|$)/u)?.[0]?.trim() || text;
    return `- [${TYPES[m.type]}] ${name} —— ${summary}（${m.file}）`;
  });
  ws.writeText("memory/MEMORY.md", lines.length ? `${lines.join("\n")}\n` : "");
}

export async function addMemory(
  ws: Workspace,
  input: MemoryInput,
  opts: MemoryOptions = {},
): Promise<MemoryEntry> {
  ws.assertDownloaded("memory");
  const now = opts.now ?? new Date();
  const date = isoInZone(now, ws.timeZone()).slice(0, 10);
  const data: Memory = { ...input, sensitive: input.sensitive ?? false, created: date, updated: date };
  validateMemory(data);
  const file = availableFile(ws, data.type, data.name);
  ws.writeText(memoryPath(file), stringifyFrontmatter(data));
  rewriteIndex(ws);
  await snapshot(ws, `${opts.actor ?? who(opts.by)}记住了：${data.name}`, now);
  return { ...data, file };
}

export async function updateMemory(
  ws: Workspace,
  file: string,
  patch: MemoryPatch,
  opts: MemoryOptions = {},
): Promise<MemoryEntry> {
  const current = readMemory(ws, file);
  ws.assertDownloaded("memory");
  const now = opts.now ?? new Date();
  // 只改交来的字段：没写的（undefined）保留原值，不把类型等必填项清空。
  const changes = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined));
  const data: Memory = { ...current.data, ...changes, updated: isoInZone(now, ws.timeZone()).slice(0, 10) };
  validateMemory(data);
  const renamed = data.name !== current.data.name || data.type !== current.data.type;
  const nextFile = renamed ? availableFile(ws, data.type, data.name, file) : file;
  ws.writeText(memoryPath(nextFile), stringifyFrontmatter(data, current.body));
  if (nextFile !== file) rmSync(ws.resolve(memoryPath(file)));
  rewriteIndex(ws);
  await snapshot(ws, `${opts.actor ?? who(opts.by)}更新了一条记忆：${data.name}`, now);
  return { ...data, file: nextFile };
}

export async function removeMemory(
  ws: Workspace,
  file: string,
  opts: MemoryOptions = {},
): Promise<MemoryEntry> {
  ws.assertDownloaded("memory");
  const { data } = readMemory(ws, file);
  rmSync(ws.resolve(memoryPath(file)));
  rewriteIndex(ws);
  await snapshot(ws, `${opts.actor ?? who(opts.by)}删除了一条记忆：${data.name}`, opts.now);
  return { ...data, file };
}

export async function importMemories(
  ws: Workspace,
  inputs: MemoryInput[],
  opts: MemoryOptions & { dryRun?: boolean } = {},
) {
  if (!Array.isArray(inputs)) throw new KaituError("候选文件必须是记忆数组", "BAD_ARGS");
  const date = isoInZone(opts.now ?? new Date(), ws.timeZone()).slice(0, 10);
  const candidates = inputs.map((input) => {
    const data: Memory = { ...input, sensitive: input.sensitive ?? false, created: date, updated: date };
    validateMemory(data);
    return data;
  });
  if (opts.dryRun) return { entries: candidates, version: null };
  ws.assertDownloaded("memory");
  const entries = candidates.map((data) => {
    const file = availableFile(ws, data.type, data.name);
    ws.writeText(memoryPath(file), stringifyFrontmatter(data));
    return { ...data, file };
  });
  if (!entries.length) return { entries, version: null };
  rewriteIndex(ws);
  const version = await snapshot(
    ws,
    `${opts.actor ?? who(opts.by)}导入了 ${entries.length} 条记忆`,
    opts.now,
  );
  return { entries, version };
}

export function importMemoryFile(
  ws: Workspace,
  file: string,
  opts: MemoryOptions & { dryRun?: boolean } = {},
) {
  return importMemories(ws, JSON.parse(readFileSync(file, "utf8")), opts);
}
