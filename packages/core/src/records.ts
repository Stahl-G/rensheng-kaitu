import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { KaituError } from "./errors.js";
import { type RecordTypeRef, findRecordType, recordFileFor, recordFilePattern } from "./modules.js";
import { mergeNewsRecord } from "./news.js";
import { assertPublicProject, driveProjects } from "./projects.js";
import { formatErrors, schemas } from "./schema.js";
import { isoInZone, localMonth, parseTs } from "./time.js";
import { ulid } from "./ulid.js";
import type { Workspace } from "./workspace.js";

export type By = "user" | "agent" | `import:${string}`;

export interface StoredRecord {
  id: string;
  ts: string;
  by: By;
  rev?: number;
  deleted?: true;
  [key: string]: unknown;
}

export interface WriteOptions {
  by?: By;
  now?: Date;
}

export interface WriteResult {
  type: string;
  module: string;
  file: string;
  record: StoredRecord;
}

const RESERVED = ["id", "by", "rev", "deleted"] as const;

function validateRecord(ws: Workspace, ref: RecordTypeRef, record: StoredRecord): void {
  if (ref.type === "experience_source" && record.by !== "user")
    throw new KaituError("足迹来源设置由用户决定", "USER_DECISION");
  if (
    ref.type === "direction" &&
    record.by !== "user" &&
    !record.deleted &&
    ((record.rev ?? 1) !== 1 || record.status !== "suggested" || record.favorite !== false)
  ) {
    throw new KaituError("AI 只能新增方向建议，方向状态由用户决定", "USER_DECISION");
  }
  if (["project_metric", "github_snapshot"].includes(ref.type) && driveProjects(ws) && !record.deleted)
    assertPublicProject(ws, record.project);
  const reg = schemas();
  const fn = record.deleted
    ? reg.builtin("tombstone.schema.json")
    : reg.forModule(ref.module.def.id, join(ws.root, ref.module.dir), ref.def.schema);
  if (!fn(record)) {
    const issues = formatErrors(fn.errors)
      .map((i) => `${i.path} ${i.message}`)
      .join("；");
    throw new KaituError(`「${ref.type}」记录不合法：${issues}`, "INVALID_RECORD");
  }
  // 自定义 schema 不一定引用公共字段，这里统一再校验一次
  const base = reg.builtin("record-base.schema.json");
  if (!base(record))
    throw new KaituError(
      `记录公共字段不合法：${JSON.stringify(formatErrors(base.errors))}`,
      "INVALID_RECORD",
    );
}

function stripReserved(data: Record<string, unknown>): Record<string, unknown> {
  const out = { ...data };
  for (const k of RESERVED) delete out[k];
  return out;
}

function write(ws: Workspace, ref: RecordTypeRef, record: StoredRecord, tz: string): WriteResult {
  validateRecord(ws, ref, record);
  const file = recordFileFor(ref, localMonth(parseTs(record.ts), tz));
  ws.appendLine(file, JSON.stringify(record));
  return { type: ref.type, module: ref.module.dir, file, record };
}

/** 追加一条新记录：生成 id、ts（未提供时）与 by，校验后写入 ts 所在本地月份的文件。 */
export function addRecord(
  ws: Workspace,
  type: string,
  data: Record<string, unknown>,
  opts: WriteOptions = {},
): WriteResult {
  return addRecords(ws, type, [data], opts)[0] as WriteResult;
}

export function addRecords(
  ws: Workspace,
  type: string,
  data: Record<string, unknown>[],
  opts: WriteOptions & { dryRun?: boolean } = {},
): WriteResult[] {
  const ref = findRecordType(ws, type);
  const tz = ws.timeZone();
  const news = type === "news_item" || type === "trend";
  if (news && !opts.dryRun) ws.assertDownloaded(recordFilePattern(ref).dir);
  const existing = news ? readRecords(ws, type) : [];
  const pending: WriteResult[] = [];
  const results = data.map((item) => {
    const ts = typeof item.ts === "string" ? item.ts : isoInZone(opts.now ?? new Date(), tz);
    parseTs(ts);
    const { ts: _ts, ...rest } = stripReserved(item);
    let record: StoredRecord = {
      id: ulid(),
      ts,
      by: opts.by ?? "agent",
      ...rest,
      ...(type === "news_item" ? { kind: rest.kind ?? "article", status: "new" } : {}),
    };
    validateRecord(ws, ref, record);
    if (news) {
      record = mergeNewsRecord(type, record, existing, tz);
      validateRecord(ws, ref, record);
    }
    const changed = !existing.includes(record);
    const result = {
      type,
      module: ref.module.dir,
      file: recordFileFor(ref, localMonth(parseTs(record.ts), tz)),
      record,
    };
    if (changed) {
      pending.push(result);
      if (news) {
        const index = existing.findIndex((row) => row.id === record.id);
        if (index < 0) existing.push(record);
        else existing[index] = record;
      }
    }
    return result;
  });
  if (!opts.dryRun) {
    const files = new Map<string, string[]>();
    for (const { file, record } of pending) {
      const lines = files.get(file) ?? [];
      lines.push(JSON.stringify(record));
      files.set(file, lines);
    }
    for (const [file, lines] of files) ws.appendLine(file, lines.join("\n"));
  }
  return results;
}

/** 修改：追加同 id、rev+1 的完整新版本。 */
export function updateRecord(
  ws: Workspace,
  type: string,
  id: string,
  patch: Record<string, unknown>,
  opts: WriteOptions = {},
): WriteResult {
  const ref = findRecordType(ws, type);
  ws.assertDownloaded(recordFilePattern(ref).dir);
  const current = latestById(ws, ref).get(id);
  if (!current || current.deleted) throw new KaituError(`找不到「${type}」记录 ${id}`, "NOT_FOUND");
  const merged: StoredRecord = {
    ...current,
    ...stripReserved(patch),
    id,
    by: opts.by ?? "agent",
    rev: (current.rev ?? 1) + 1,
  };
  parseTs(merged.ts);
  return write(ws, ref, merged, ws.timeZone());
}

/** 删除：追加删除标记。标记写在删除时刻所在月份的文件里，读取时按 rev 全局取最新。 */
export function deleteRecord(ws: Workspace, type: string, id: string, opts: WriteOptions = {}): WriteResult {
  const ref = findRecordType(ws, type);
  ws.assertDownloaded(recordFilePattern(ref).dir);
  const current = latestById(ws, ref).get(id);
  if (!current || current.deleted) throw new KaituError(`找不到「${type}」记录 ${id}`, "NOT_FOUND");
  const tz = ws.timeZone();
  const tomb: StoredRecord = {
    id,
    ts: isoInZone(opts.now ?? new Date(), tz),
    by: opts.by ?? "agent",
    rev: (current.rev ?? 1) + 1,
    deleted: true,
  };
  return write(ws, ref, tomb, tz);
}

export interface RecordLine {
  file: string;
  line: number;
  raw: string;
}

/** 该类型的全部数据行（按文件月份升序）。 */
export function recordLines(ws: Workspace, ref: RecordTypeRef): RecordLine[] {
  const { dir, match } = recordFilePattern(ref);
  const abs = join(ws.root, dir);
  if (!existsSync(abs)) return [];
  const out: RecordLine[] = [];
  for (const f of readdirSync(abs)
    .filter((n) => match.test(n))
    .sort()) {
    const file = `${dir}/${f}`;
    ws.scanText(file)
      ?.split("\n")
      .forEach((raw, i) => {
        if (raw.trim()) out.push({ file, line: i + 1, raw });
      });
  }
  return out;
}

/** 读取已有追加历史，包含修正前的原始记录与删除标记。 */
export function readRecordRevisions(ws: Workspace, type: string): StoredRecord[] {
  return recordLines(ws, findRecordType(ws, type)).map((line) => {
    try {
      return JSON.parse(line.raw) as StoredRecord;
    } catch {
      throw new KaituError(`${line.file}:${line.line} 不是合法 JSON`, "CORRUPT");
    }
  });
}

/** 按 id 折叠：rev 大者胜；rev 相同时后出现者胜。 */
function latestById(ws: Workspace, ref: RecordTypeRef): Map<string, StoredRecord> {
  const latest = new Map<string, StoredRecord>();
  for (const rec of readRecordRevisions(ws, ref.type)) {
    const prev = latest.get(rec.id);
    if (!prev || (rec.rev ?? 1) >= (prev.rev ?? 1)) latest.set(rec.id, rec);
  }
  return latest;
}

export interface ReadOptions {
  /** 本地日期 YYYY-MM-DD（含） */
  from?: string;
  /** 本地日期 YYYY-MM-DD（含） */
  to?: string;
}

export function readRecords(ws: Workspace, type: string, opts: ReadOptions = {}): StoredRecord[] {
  const ref = findRecordType(ws, type);
  const tz = ws.timeZone();
  const day = (r: StoredRecord) => isoInZone(parseTs(r.ts), tz).slice(0, 10);
  return [...latestById(ws, ref).values()]
    .filter((r) => !r.deleted)
    .filter((r) => (!opts.from || day(r) >= opts.from) && (!opts.to || day(r) <= opts.to))
    .sort((a, b) => parseTs(a.ts).getTime() - parseTs(b.ts).getTime() || a.id.localeCompare(b.id));
}

/** 已准备好 id 的跨类型批次：先统一校验，再追加。供需要互相关联 id 的导入使用。 */
function preparedRecords(ws: Workspace, entries: { type: string; record: StoredRecord }[]) {
  return entries.map(({ type, record }) => {
    const ref = findRecordType(ws, type);
    parseTs(record.ts);
    validateRecord(ws, ref, record);
    return { file: recordFileFor(ref, localMonth(parseTs(record.ts), ws.timeZone())), record };
  });
}

export function validatePreparedRecords(
  ws: Workspace,
  entries: { type: string; record: StoredRecord }[],
): void {
  preparedRecords(ws, entries);
}

export function appendPreparedRecords(
  ws: Workspace,
  entries: { type: string; record: StoredRecord }[],
): void {
  const plans = preparedRecords(ws, entries);
  const files = new Map<string, string[]>();
  for (const { file, record } of plans) {
    const lines = files.get(file) ?? [];
    lines.push(JSON.stringify(record));
    files.set(file, lines);
  }
  for (const [file, lines] of files) ws.appendLine(file, lines.join("\n"));
}
