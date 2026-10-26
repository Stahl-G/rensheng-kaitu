import { createHash } from "node:crypto";
import { linkSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { KaituError } from "./errors.js";
import { parseFrontmatter, stringifyFrontmatter } from "./frontmatter.js";
import { invalidateHistoryFile, snapshot } from "./history.js";
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
  origin?: "user-stated" | "ai-estimate" | "ai-suggestion";
  observed_at?: string;
  evidence?: string;
  uncertainty?: string;
  replaces?: string;
}

export type MemoryPatch = Partial<Pick<MemoryInput, "name" | "text" | "type" | "sensitive">>;

export interface Memory extends MemoryInput {
  created: string;
  updated: string;
  ended?: string;
  replaced_by?: string;
}

export interface MemoryEntry extends Memory {
  file: string;
}

export interface MemoryOptions {
  by?: By;
  now?: Date;
  actor?: string;
}

export interface MemoryReplacement {
  file: string;
  candidate: MemoryInput;
}

export interface MemoryExpectation {
  type: MemoryType;
  name: string;
  text: string;
  source: string | null;
  sensitive: boolean;
}

export function memoryExpectation(memory: MemoryInput): MemoryExpectation {
  return {
    type: memory.type,
    name: memory.name,
    text: memory.text,
    source: memory.source ?? null,
    sensitive: memory.sensitive ?? false,
  };
}

function assertExpected(memory: Memory, expected: MemoryExpectation): void {
  if (!isDeepStrictEqual(memoryExpectation(memory), expected))
    throw new KaituError("这条记忆已更新，请核对后再确认", "CONFLICT");
}

/** 候选仍留在已有的收件箱文件里；确认前不写入 memory/，也不新增持久格式。 */
export function pendingMemoryReplacements(ws: Workspace): MemoryReplacement[] {
  if (!ws.exists("inbox/agents")) return [];
  const result: MemoryReplacement[] = [];
  for (const file of readdirSync(ws.resolve("inbox/agents"))) {
    if (!file.endsWith(".memory.json") || file.startsWith(".") || ws.conflictCopy(`inbox/agents/${file}`))
      continue;
    try {
      const raw: unknown = ws.scanParsed(`inbox/agents/${file}`, "memory-replacements", JSON.parse);
      const rows = Array.isArray(raw) ? raw : ((raw as { memories?: unknown[] })?.memories ?? [raw]);
      for (const row of rows) {
        if (!row || typeof row !== "object" || typeof row.replaces !== "string") continue;
        const old = normalizedMemory(ws, row.replaces);
        if (!old || old.ended) continue;
        result.push({ file: row.replaces, candidate: memoryInput(row) });
      }
    } catch {
      // 不完整或无效的文件仍由收件箱按原流程给出原因。
    }
  }
  return result;
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

function availableFile(ws: Workspace, type: MemoryType, name: string): string {
  const slug =
    name
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "") || ulid().slice(-8).toLowerCase();
  const base = `${type}_${slug}`;
  let file = `${base}.md`;
  let suffix = 2;
  while (ws.exists(memoryPath(file))) file = `${base}-${suffix++}.md`;
  return file;
}

/** 校验和读取用同一份补齐后的记忆：没有 frontmatter 的普通 Markdown 也算合法记忆。 */
export function normalizedMemory(ws: Workspace, file: string): Memory | undefined {
  const path = memoryPath(file);
  if (!ws.exists(path)) return undefined;
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

export function listMemories(ws: Workspace, options: { includeArchived?: boolean } = {}): MemoryEntry[] {
  if (!ws.exists("memory")) return [];
  const order = Object.keys(TYPES);
  const entries = readdirSync(ws.resolve("memory"))
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
  // A correction is one atomic new file. Originals remain intact; undoing it revives the predecessor.
  const superseded = new Map<string, MemoryEntry>();
  const byFile = new Map(entries.map((entry) => [entry.file, entry]));
  for (const entry of entries.filter((item) => !item.ended)) {
    let previous = entry.replaces;
    const visited = new Set<string>();
    while (previous && !visited.has(previous)) {
      visited.add(previous);
      superseded.set(previous, entry);
      previous = byFile.get(previous)?.replaces;
    }
  }
  return entries.flatMap((entry) => {
    const replacement = superseded.get(entry.file);
    if (!replacement) return options.includeArchived || !entry.ended ? [entry] : [];
    return options.includeArchived
      ? [{ ...entry, ended: replacement.created, replaced_by: replacement.file }]
      : [];
  });
}

export function searchMemories(ws: Workspace, query: string): MemoryEntry[] {
  const term = query.toLowerCase();
  return listMemories(ws).filter(
    (m) => m.name.toLowerCase().includes(term) || m.text.toLowerCase().includes(term),
  );
}

function rewriteIndex(ws: Workspace): MemoryEntry[] {
  const entries = listMemories(ws);
  const lines = entries.map((m) => {
    const name = m.name.replace(/\s+/g, " ").trim();
    const text = m.text.replace(/\s+/g, " ").trim();
    const summary = text.match(/^.*?(?:[。！？]|[.!?](?=\s|$)|$)/u)?.[0]?.trim() || text;
    return `- [${TYPES[m.type]}] ${name} —— ${summary}（${m.file}）`;
  });
  ws.writeText("memory/MEMORY.md", lines.length ? `${lines.join("\n")}\n` : "");
  return entries;
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
  if (current.data.origin)
    throw new KaituError("自动记录的更正须追加关联原条，请用 memory_capture 或个人档案替换", "CONFLICT");
  ws.assertDownloaded("memory");
  const now = opts.now ?? new Date();
  // 只改交来的字段：没写的（undefined）保留原值，不把类型等必填项清空。
  const changes = Object.fromEntries(
    (["name", "text", "type", "sensitive"] as const)
      .filter((key) => patch[key] !== undefined)
      .map((key) => [key, patch[key]]),
  );
  const data: Memory = { ...current.data, ...changes, updated: isoInZone(now, ws.timeZone()).slice(0, 10) };
  validateMemory(data);
  ws.writeText(memoryPath(file), stringifyFrontmatter(data, current.body));
  rewriteIndex(ws);
  await snapshot(ws, `${opts.actor ?? who(opts.by)}更新了一条记忆：${data.name}`, now);
  return { ...data, file };
}

/** 归档和替换是用户的决定，Agent 的普通更新不能写 ended/replaced_by。 */
export async function archiveMemory(
  ws: Workspace,
  file: string,
  opts: MemoryOptions & { expected: MemoryExpectation },
): Promise<MemoryEntry> {
  if (opts.by !== "user") throw new KaituError("请由用户确认记忆归档", "USER_DECISION");
  ws.assertDownloaded("memory");
  const current = readMemory(ws, file);
  assertExpected(current.data, opts.expected);
  if (current.data.ended) throw new KaituError("这条记忆已归档，请重新核对", "CONFLICT");
  const date = localDate(opts.now ?? new Date(), ws.timeZone());
  const data = { ...current.data, ended: date, updated: date };
  validateMemory(data);
  ws.writeText(memoryPath(file), stringifyFrontmatter(data, current.body));
  rewriteIndex(ws);
  await snapshot(ws, `你归档了一条记忆：${data.name}`, opts.now);
  return { ...data, file };
}

export async function replaceMemory(
  ws: Workspace,
  file: string,
  input: MemoryInput,
  opts: MemoryOptions & { expected: MemoryExpectation; replacementFile?: string },
): Promise<MemoryEntry> {
  if (opts.by !== "user") throw new KaituError("请由用户确认记忆替换", "USER_DECISION");
  ws.assertDownloaded("memory");
  const current = readMemory(ws, file);
  const date = localDate(opts.now ?? new Date(), ws.timeZone());
  // 和普通 Agent 写入一样，只接受候选内容，不能夹带归档字段。
  const candidate = memoryInput(input as unknown as Record<string, unknown>);
  if (current.data.origin) {
    const key = `profile-correction:${file}:${createHash("sha256").update(JSON.stringify(candidate)).digest("hex")}`;
    const previous = normalizedMemory(ws, captureFile(key));
    const result = await captureMemory(ws, {
      ...candidate,
      source: candidate.source ?? current.data.source ?? "个人档案 / Profile",
      idempotency_key: key,
      scope: "personal",
      origin: "user-stated",
      evidence: candidate.text,
      observed_at: previous?.observed_at ?? isoInZone(opts.now ?? new Date(), ws.timeZone()),
      replaces: file,
      expected: opts.expected,
    });
    if (!result.entry) throw new KaituError("更正尚未保存", "CONFLICT");
    return result.entry;
  }

  const data: Memory = {
    ...candidate,
    // A replacement cannot silently make an existing private memory readable to agents.
    sensitive: !!current.data.sensitive || !!candidate.sensitive,
    created: date,
    updated: date,
  };
  validateMemory(data);
  const nextFile = opts.replacementFile ?? availableFile(ws, data.type, data.name);
  const path = memoryPath(nextFile);
  if (nextFile === file) throw new KaituError("替换需要保留旧记忆文件", "INVALID_MEMORY");
  // 手机先把确定的文件名记入操作账本；写到一半重投时复用它，不再新建一条。
  if (ws.exists(path)) {
    const existing = readMemory(ws, nextFile).data;
    if (
      existing.type !== data.type ||
      existing.name !== data.name ||
      existing.text !== data.text ||
      existing.source !== data.source ||
      !!existing.sensitive !== data.sensitive ||
      existing.ended
    )
      throw new KaituError("替换目标已有不同内容，未覆盖", "CONFLICT");
    if (current.data.ended && current.data.replaced_by === nextFile) return { ...existing, file: nextFile };
  }
  if (current.data.ended) throw new KaituError("这条记忆已归档，请重新核对", "CONFLICT");
  assertExpected(current.data, opts.expected);
  const archived = { ...current.data, ended: date, updated: date, replaced_by: nextFile };
  validateMemory(archived);
  const existed = ws.exists(path);
  try {
    if (!existed) ws.writeText(path, stringifyFrontmatter(data));
    ws.writeText(memoryPath(file), stringifyFrontmatter(archived, current.body));
  } catch (error) {
    if (!existed && ws.exists(path)) rmSync(ws.resolve(path));
    throw error;
  }
  rewriteIndex(ws);
  await snapshot(ws, `你替换了一条记忆：${current.data.name}`, opts.now);
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
  invalidateHistoryFile(ws, memoryPath(file));
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

function captureFile(key: string): string {
  return `context_capture-${createHash("sha256").update(key).digest("hex")}.md`;
}

/** One observation per call: no review queue and no multi-file transaction to recover. */
export const memoryCaptureSchema = z
  .object({
    idempotency_key: z.string().min(1).max(300),
    type: z.enum(["preference", "fact", "context", "person", "decision"]),
    name: z.string().min(1).max(300),
    text: z.string().min(1).max(20000),
    source: z.string().min(1).max(1000),
    origin: z.enum(["user-stated", "ai-estimate", "ai-suggestion"]),
    observed_at: z.iso.datetime({ offset: true }),
    evidence: z.string().min(1).max(20000),
    uncertainty: z.string().min(1).max(2000).optional(),
    sensitive: z.boolean().optional(),
    scope: z.enum(["personal", "temporary", "quoted", "hypothetical"]),
    conflict: z.string().min(1).optional(),
    replaces: z.string().optional(),
    expected: z
      .object({
        type: z.enum(["preference", "fact", "context", "person", "decision"]),
        name: z.string(),
        text: z.string(),
        source: z.string().nullable(),
        sensitive: z.boolean(),
      })
      .optional(),
  })
  .strict();

export async function captureMemory(
  ws: Workspace,
  raw: z.input<typeof memoryCaptureSchema>,
  options: { scheduleVersion?: (message: string) => void } = {},
) {
  const input = memoryCaptureSchema.parse(raw);
  if (input.scope !== "personal") return { status: "skipped", reason: input.scope };
  if (input.conflict) return { status: "needs-clarification", reason: input.conflict };
  if (input.origin !== "user-stated" && !input.uncertainty)
    throw new KaituError("AI 估算或建议须注明不确定性", "INVALID_MEMORY");
  const { idempotency_key, scope, conflict, expected, ...observation } = input;
  const file = captureFile(idempotency_key);
  const path = memoryPath(file);
  const label =
    input.origin === "ai-estimate"
      ? "[AI 估算 / AI estimate · 未核实] "
      : input.origin === "ai-suggestion"
        ? "[AI 建议 / AI suggestion · 尚未采纳] "
        : "";
  const candidate = {
    ...observation,
    type: input.origin === "user-stated" ? input.type : ("context" as const),
    text: `${label}${input.text}${input.origin !== "user-stated" ? `（不确定性 / Uncertainty: ${input.uncertainty}）` : ""}`,
    sensitive: input.sensitive ?? false,
  };
  ws.assertDownloaded("memory");
  if (input.replaces) {
    const original = normalizedMemory(ws, input.replaces);
    candidate.sensitive ||= !!original?.sensitive;
  }
  let previous = normalizedMemory(ws, file);
  if (previous) {
    for (const [key, value] of Object.entries(candidate))
      if (previous[key as keyof Memory] !== value)
        throw new KaituError("同一幂等标识已有不同内容，未覆盖", "CONFLICT");
  } else {
    if (input.replaces) {
      const old = listMemories(ws).find((item) => item.file === input.replaces);
      if (!old || !expected) throw new KaituError("更正对象已变化，请先回读", "CONFLICT");
      assertExpected(old, expected);
      if (input.origin !== "user-stated" && old.origin !== input.origin)
        throw new KaituError("AI 推测不能更正用户陈述", "CONFLICT");
      candidate.sensitive ||= !!old.sensitive;
    }
    const date = localDate(new Date(), ws.timeZone());
    const data: Memory = { ...candidate, created: date, updated: date };
    validateMemory(data);
    // Publish once, atomically, including across two local clients using the same key.
    const temporary = `memory/.capture-${ulid()}.tmp`;
    ws.writeText(temporary, stringifyFrontmatter(data));
    try {
      linkSync(ws.resolve(temporary), ws.resolve(path));
      invalidateHistoryFile(ws, path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      previous = normalizedMemory(ws, file);
      if (
        !previous ||
        Object.entries(candidate).some(([key, value]) => previous?.[key as keyof Memory] !== value)
      )
        throw new KaituError("同一幂等标识已有不同内容，未覆盖", "CONFLICT");
    } finally {
      rmSync(ws.resolve(temporary), { force: true });
    }
  }
  // Read the authoritative file, never use a chat reply as proof of persistence.
  const entry = { ...readMemory(ws, file).data, file };
  let status = entry.ended ? "undone" : previous ? "duplicate" : "saved";
  try {
    const current = rewriteIndex(ws);
    if (!entry.ended && !current.some((item) => item.file === file)) status = "superseded";
    const message = `自动记录：${entry.name}`;
    let version: string | null = null;
    if (options.scheduleVersion) options.scheduleVersion(message);
    else version = await snapshot(ws, message);
    return {
      status,
      entry,
      version,
      ...(!version ? { notice: "记忆文件已保存，可单条撤销；本次版本尚未核实。" } : {}),
    };
  } catch (error) {
    return {
      status,
      entry,
      version: null,
      warning: `记忆文件已保存；索引或版本待重试：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
