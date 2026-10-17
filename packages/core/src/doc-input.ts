import { createHash } from "node:crypto";
import { isoInZone, localTimeToInstant } from "./time.js";

/**
 * Agent 和用户手写的 STATUS.md、NOW.md、交接记录：程序只补自己离不开的字段（id、默认状态、
 * 交接的 agent 和时间），其余原样保留。写法不对的值不猜意思，交给 `kaitu validate` 报给 Agent 改。
 * id 由标题算出，每次读到的都一样，界面点「完成」能找回同一条。
 */

type Doc = Record<string, unknown>;

const text = (value: unknown) =>
  typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "";
const missing = (value: unknown) =>
  value === undefined || value === null || (typeof value === "string" && !value.trim());
/** 一行写成字符串或数字就当标题；对象照原样展开；其余原样交给校验。 */
const entry = (raw: unknown): Doc | undefined =>
  typeof raw === "string" || typeof raw === "number"
    ? { title: String(raw) }
    : raw && typeof raw === "object" && !Array.isArray(raw)
      ? { ...(raw as Doc) }
      : undefined;
const shortHash = (value: string) => createHash("sha1").update(value).digest("hex").slice(0, 8);

function items(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  return missing(value) ? [] : [value];
}

function uniqueIds(list: unknown[]): unknown[] {
  const seen = new Map<string, number>();
  return list.map((item) => {
    const id = (item as Doc | undefined)?.id;
    if (typeof id !== "string") return item;
    const count = seen.get(id) ?? 0;
    seen.set(id, count + 1);
    return count ? { ...(item as Doc), id: `${id}-${count + 1}` } : item;
  });
}

export function normalizeStatus(data: Doc): Doc {
  const out: Doc = { ...data, updated: data.updated ?? null };
  if (out.next !== undefined)
    out.next = uniqueIds(
      items(out.next).map((raw) => {
        const item = entry(raw);
        const title = item ? text(item.title) : "";
        if (!item || !title) return raw;
        return {
          ...item,
          id: text(item.id) || `n-${shortHash(title)}`,
          title,
          status: missing(item.status) ? "todo" : item.status,
        };
      }),
    );
  return out;
}

export function normalizeNow(data: Doc): Doc {
  const out: Doc = { ...data };
  out.blocks = uniqueIds(
    items(out.blocks).map((raw) => {
      const block = entry(raw);
      const title = block ? text(block.title) : "";
      if (!block || !title) return raw;
      const kind = missing(block.kind) ? (block.start && block.end ? "event" : "task") : block.kind;
      return {
        ...block,
        id: text(block.id) || `b-${shortHash(`${title}|${text(block.start)}`)}`,
        title,
        kind,
        status: missing(block.status) ? (kind === "proposal" ? "pending" : "confirmed") : block.status,
      };
    }),
  );
  if (out.attention !== undefined)
    out.attention = items(out.attention).map((raw) => {
      const item = entry(raw);
      return item && text(item.title) ? { ...item, kind: missing(item.kind) ? "note" : item.kind } : raw;
    });
  return out;
}

/** 交接记录缺 agent 或 at 时，从文件名 <YYYYMMDDTHHMM>-<agent>.md 补。 */
export function normalizeHandoff(data: Doc, file: string, timeZone: string): Doc {
  const out: Doc = { ...data };
  const name = file.split("/").pop()?.replace(/\.md$/, "") ?? "";
  const stamp = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})-(.+)$/.exec(name);
  if (!stamp) return out;
  if (missing(out.agent)) out.agent = stamp[6];
  if (missing(out.at))
    try {
      out.at = isoInZone(
        localTimeToInstant(`${stamp[1]}-${stamp[2]}-${stamp[3]}T${stamp[4]}:${stamp[5]}:00`, timeZone),
        timeZone,
      );
    } catch {
      // 文件名里的时间不合法时不补，留给校验报出缺少的 at。
    }
  return out;
}

/** 按 schema 名分派：NOW.md、STATUS.md 补齐，其他文档原样返回。 */
export function normalizeDocument(schema: string, data: unknown): unknown {
  if (!data || typeof data !== "object" || Array.isArray(data)) return data;
  if (schema === "now.schema.json") return normalizeNow(data as Doc);
  if (schema === "status.schema.json") return normalizeStatus(data as Doc);
  return data;
}
