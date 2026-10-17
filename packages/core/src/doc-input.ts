import { createHash } from "node:crypto";
import { dateTime } from "./record-input.js";
import { isoInZone, localTimeToInstant } from "./time.js";

/**
 * Agent 和用户手写的 STATUS.md、NOW.md、交接记录常有小出入：下一步没写 id、状态写成「完成」、
 * 时间写成 9:00、updated 只写日期。读取和修改前先补齐成规范写法，不因为一个字段让整份文件读不出来。
 * id 由标题算出，每次读到的都一样，界面点「完成」能找回同一条。
 */

type Doc = Record<string, unknown>;

const NEXT_STATUS: Record<string, string> = {
  todo: "todo",
  "to do": "todo",
  open: "todo",
  pending: "todo",
  planned: "todo",
  next: "todo",
  doing: "todo",
  active: "todo",
  "in progress": "todo",
  blocked: "todo",
  waiting: "todo",
  待办: "todo",
  未完成: "todo",
  进行中: "todo",
  proposed: "proposed",
  suggested: "proposed",
  建议: "proposed",
  待确认: "proposed",
  done: "done",
  complete: "done",
  completed: "done",
  finished: "done",
  closed: "done",
  完成: "done",
  已完成: "done",
  skipped: "skipped",
  skip: "skipped",
  cancelled: "skipped",
  canceled: "skipped",
  dropped: "skipped",
  跳过: "skipped",
  放弃: "skipped",
  取消: "skipped",
};
const BLOCK_STATUS: Record<string, string> = {
  confirmed: "confirmed",
  确认: "confirmed",
  已确认: "confirmed",
  pending: "pending",
  proposed: "pending",
  待确认: "pending",
  done: "done",
  completed: "done",
  完成: "done",
  已完成: "done",
  skipped: "skipped",
  skip: "skipped",
  跳过: "skipped",
  cancelled: "skipped",
  canceled: "skipped",
  取消: "skipped",
  已取消: "skipped",
  rejected: "rejected",
  declined: "rejected",
  拒绝: "rejected",
};
const BLOCK_KIND: Record<string, string> = {
  event: "event",
  meeting: "event",
  calendar: "event",
  日程: "event",
  proposal: "proposal",
  suggestion: "proposal",
  建议: "proposal",
  task: "task",
  todo: "task",
  待办: "task",
};
const PRIORITY: Record<string, string> = {
  high: "high",
  高: "high",
  normal: "normal",
  中: "normal",
  low: "low",
  低: "low",
};

const OFFSET = /(Z|[+-]\d{2}:\d{2})$/i;
/** 读得出的时间换成带偏移的 ISO，读不出返回 undefined。 */
const instant = (value: unknown, timeZone: string) => {
  const result = text(value) ? dateTime(text(value), timeZone) : "";
  return OFFSET.test(result) && Number.isFinite(Date.parse(result)) ? result : undefined;
};
const text = (value: unknown) =>
  typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "";
const pick = (table: Record<string, string>, value: unknown) => table[text(value).toLowerCase()];
const missing = (value: unknown) => value === undefined || value === null || text(value) === "";
const shortHash = (value: string) => createHash("sha1").update(value).digest("hex").slice(0, 8);

/** 9:00、9点、21:30 → 09:00、21:30；读不出返回 undefined。 */
export function clockTime(value: unknown): string | undefined {
  const match = /^(\d{1,2})(?::|点|：)?(\d{2})?\s*(am|pm)?$/i.exec(text(value));
  if (!match) return undefined;
  let hour = Number(match[1]);
  const minute = Number(match[2] ?? "0");
  if (match[3]?.toLowerCase() === "pm" && hour < 12) hour += 12;
  if (match[3]?.toLowerCase() === "am" && hour === 12) hour = 0;
  if (hour > 24 || minute > 59 || (hour === 24 && minute > 0)) return undefined;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function day(value: unknown): string | undefined {
  const match = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(text(value));
  return match ? `${match[1]}-${match[2]?.padStart(2, "0")}-${match[3]?.padStart(2, "0")}` : undefined;
}

function items(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  return value === undefined || value === null || value === "" ? [] : [value];
}

function uniqueIds<T extends { id: string }>(list: T[]): T[] {
  const seen = new Map<string, number>();
  return list.map((item) => {
    const count = seen.get(item.id) ?? 0;
    seen.set(item.id, count + 1);
    return count ? { ...item, id: `${item.id}-${count + 1}` } : item;
  });
}

export function normalizeStatus(data: Doc, timeZone: string): Doc {
  const out: Doc = { ...data };
  out.updated = instant(out.updated, timeZone) ?? null;
  const progress = out.progress as Doc | null | undefined;
  if (progress !== undefined && progress !== null) {
    const current = Number(progress.current);
    const target = Number(progress.target);
    out.progress =
      typeof progress === "object" &&
      text(progress.label) &&
      Number.isFinite(current) &&
      Number.isFinite(target)
        ? { ...progress, label: text(progress.label), current, target }
        : null;
  }
  if (out.next !== undefined) {
    const next = items(out.next).flatMap((raw) => {
      const item: Doc =
        typeof raw === "string" ? { title: raw } : raw && typeof raw === "object" ? { ...(raw as Doc) } : {};
      const title = text(item.title) || text(item.name) || text(item.text);
      if (!title) return [];
      const due = day(item.due);
      // 带时间或文字的截止（2026-10-17T14:00、下周五）原样留在 when，due 只留日期，时间不丢。
      const dateOnly = /^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}$/.test(text(item.due));
      const when = text(item.when) || (item.due !== undefined && (!due || !dateOnly) ? text(item.due) : "");
      // 没写状态算待办；认得出的写法换成规范值，写了却认不出的留给校验报错，不悄悄当成待办。
      const status = missing(item.status) ? "todo" : (pick(NEXT_STATUS, item.status) ?? item.status);
      const priority = pick(PRIORITY, item.priority);
      const { name: _name, text: _text, ...rest } = item;
      return [
        {
          ...rest,
          id: text(item.id) || `n-${shortHash(title)}`,
          title,
          status,
          ...(priority ? { priority } : { priority: undefined }),
          ...(item.due !== undefined ? { due: due ?? null } : {}),
          ...(when ? { when } : item.when === undefined ? {} : { when: null }),
          ...(item.estimate !== undefined ? { estimate: text(item.estimate) || null } : {}),
        },
      ];
    });
    out.next = uniqueIds(next).map((item) =>
      Object.fromEntries(Object.entries(item).filter(([, v]) => v !== undefined)),
    );
  }
  return out;
}

export function normalizeNow(data: Doc, timeZone: string): Doc {
  const out: Doc = { ...data };
  out.date = day(out.date) ?? null;
  if (out.generated_at !== undefined) {
    const at = instant(out.generated_at, timeZone);
    out.generated_at = at;
  }
  const blocks = items(out.blocks).flatMap((raw) => {
    const block: Doc =
      typeof raw === "string" ? { title: raw } : raw && typeof raw === "object" ? { ...(raw as Doc) } : {};
    const title = text(block.title) || text(block.name);
    if (!title) return [];
    const start = clockTime(block.start);
    const end = clockTime(block.end);
    let kind = pick(BLOCK_KIND, block.kind) ?? (start && end ? "event" : "task");
    if (kind !== "task" && !(start && end)) kind = "task";
    const status = missing(block.status)
      ? kind === "proposal"
        ? "pending"
        : "confirmed"
      : (pick(BLOCK_STATUS, block.status) ?? block.status);
    const { name: _name, start: _start, end: _end, ...rest } = block;
    return [
      {
        ...rest,
        id: text(block.id) || `b-${shortHash(`${title}|${start ?? ""}`)}`,
        title,
        kind,
        status,
        ...(start ? { start } : {}),
        ...(end ? { end } : {}),
      },
    ];
  });
  out.blocks = uniqueIds(blocks);
  if (out.attention !== undefined)
    out.attention = items(out.attention).flatMap((raw) => {
      const item: Doc =
        typeof raw === "string" ? { title: raw } : raw && typeof raw === "object" ? (raw as Doc) : {};
      const title = text(item.title);
      return title ? [{ ...item, kind: text(item.kind) || "note", title }] : [];
    });
  // 读不出的 generated_at 去掉，不写成 null。
  return Object.fromEntries(
    Object.entries(out).filter(([key, value]) => key !== "generated_at" || value !== undefined),
  );
}

/** 交接记录缺 agent 或 at 时，从文件名 <YYYYMMDDTHHMM>-<agent>.md 补。 */
export function normalizeHandoff(data: Doc, file: string, timeZone: string): Doc {
  const out: Doc = { ...data };
  const name = file.split("/").pop()?.replace(/\.md$/, "") ?? "";
  const stamp = /^(\d{4})(\d{2})(\d{2})T?(\d{2})(\d{2})(?:\d{2})?[-_]?(.*)$/.exec(name);
  const agent = text(out.agent) || text(out.author) || text(out.by) || stamp?.[6] || "";
  if (agent) out.agent = agent;
  const at = instant(out.at, timeZone) ?? instant(out.time, timeZone) ?? instant(out.date, timeZone);
  if (at) out.at = at;
  else if (stamp)
    out.at = isoInZone(
      localTimeToInstant(`${stamp[1]}-${stamp[2]}-${stamp[3]}T${stamp[4]}:${stamp[5]}:00`, timeZone),
      timeZone,
    );
  return out;
}

/** 按 schema 名分派：NOW.md、STATUS.md 补齐，其他文档原样返回。 */
export function normalizeDocument(schema: string, data: unknown, timeZone: string): unknown {
  if (!data || typeof data !== "object" || Array.isArray(data)) return data;
  if (schema === "now.schema.json") return normalizeNow(data as Doc, timeZone);
  if (schema === "status.schema.json") return normalizeStatus(data as Doc, timeZone);
  return data;
}
