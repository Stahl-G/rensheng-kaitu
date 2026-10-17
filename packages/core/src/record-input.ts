import { isoInZone, localTimeToInstant } from "./time.js";

/**
 * AI 和导入工具交来的记录，程序只补自己离不开的：不带时区的时间按工作区时区补上偏移，
 * 没写餐次按吃饭时间推断，新增时空着的可选字段当没交。其余原样交给校验，写错就报给 Agent 改。
 */

interface Schema {
  required?: string[];
  properties?: Record<string, { format?: string; enum?: unknown[] }>;
}

const HAS_OFFSET = /(Z|[+-]\d{2}:\d{2})$/i;

/** 补上时区偏移：+0800 → +08:00，不带偏移的按当地时间；读不出原样返回。 */
export function dateTime(value: string, timeZone: string): string {
  const offset = value.replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  if (HAS_OFFSET.test(offset)) return offset;
  const match = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?)?$/.exec(value);
  if (!match) return value;
  try {
    const wall = `${match[1]}T${match[2] ?? "12"}:${match[3] ?? "00"}:${match[4] ?? "00"}`;
    return isoInZone(localTimeToInstant(wall, timeZone), timeZone);
  } catch {
    return value;
  }
}

export function normalizeRecordInput(
  schema: unknown,
  data: Record<string, unknown>,
  timeZone: string,
  now: Date,
  options: { patch?: boolean } = {},
): Record<string, unknown> {
  const root = (schema ?? {}) as Schema;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    const property = root.properties?.[key];
    // 新增时可选字段交了空值（null、""）等于没交；修改时空值可能是要清空，原样保留。
    if (!options.patch && property && (value === null || value === "") && !root.required?.includes(key))
      continue;
    out[key] =
      property?.format === "date-time" && typeof value === "string"
        ? dateTime(value.trim(), timeZone)
        : value;
  }
  if (typeof out.ts === "string") out.ts = dateTime(out.ts.trim(), timeZone);
  // via 由程序按交来的 Agent 名填：grok-bot → grok、codex-cli → codex，认不出的记成 agent。
  const via = root.properties?.via?.enum?.filter((item): item is string => typeof item === "string");
  if (via && typeof out.via === "string" && !via.includes(out.via)) {
    const name = out.via.toLowerCase();
    out.via =
      via.find((item) => name.startsWith(item) && /^[-_ .]?$/.test(name[item.length] ?? "")) ??
      (via.includes("agent") ? "agent" : out.via);
  }
  if (options.patch) return out;
  // 餐次没写时按吃饭时间推断，和导入营养 App 时的规则一致；写了却认不出的留给校验，不改成别的餐次。
  const meal = root.properties?.meal?.enum;
  if (meal?.includes("加餐") && (out.meal === undefined || out.meal === null || out.meal === "")) {
    const at = typeof out.ts === "string" && HAS_OFFSET.test(out.ts) ? new Date(out.ts) : now;
    if (!Number.isNaN(at.getTime())) {
      const hour = Number(isoInZone(at, timeZone).slice(11, 13));
      out.meal = hour < 11 ? "早" : hour < 16 ? "午" : hour < 21 ? "晚" : "加餐";
    }
  }
  return out;
}
