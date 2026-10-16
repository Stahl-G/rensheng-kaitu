import { readFileSync, readdirSync, rmSync } from "node:fs";
import { KaituError } from "./errors.js";
import { parseFrontmatter, stringifyFrontmatter } from "./frontmatter.js";
import { snapshot } from "./history.js";
import type { By } from "./records.js";
import { formatErrors, schemas } from "./schema.js";
import { isoInZone } from "./time.js";
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

function memoryPath(file: string): string {
  if (!/^(preference|fact|context|person|decision)_[a-z0-9-]+\.md$/.test(file)) {
    throw new KaituError(`不是合法的记忆文件名：${file}`, "INVALID_MEMORY");
  }
  return `memory/${file}`;
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

function readMemory(ws: Workspace, file: string): { data: Memory; body: string } {
  const path = memoryPath(file);
  if (!ws.exists(path)) throw new KaituError(`找不到记忆：${file}`, "NOT_FOUND");
  const parsed = parseFrontmatter<Memory>(ws.readText(path));
  validateMemory(parsed.data);
  return parsed;
}

export function listMemories(ws: Workspace): MemoryEntry[] {
  if (!ws.exists("memory")) return [];
  const order = Object.keys(TYPES);
  return readdirSync(ws.resolve("memory"))
    .filter(
      (file) => file.endsWith(".md") && file !== "MEMORY.md" && ws.scanText(`memory/${file}`) !== undefined,
    )
    .map((file) => ({ ...readMemory(ws, file).data, file }))
    .sort(
      (a, b) =>
        order.indexOf(a.type) - order.indexOf(b.type) ||
        b.updated.localeCompare(a.updated) ||
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
  const data: Memory = { ...current.data, ...patch, updated: isoInZone(now, ws.timeZone()).slice(0, 10) };
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
