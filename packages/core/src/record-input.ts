import { isoInZone, localTimeToInstant } from "./time.js";

/**
 * 宽进严存：AI 和导入工具交来的写法各不相同（dinner、"1050 kcal"、不带时区的时间、一道菜名），
 * 写入前按该类型的 schema 换成规范值。存下来的仍是统一格式，统计、图表和去重才算得对。
 * 换不了的原样交给校验；收件箱会把整行原文转成待整理笔记，不会丢。
 */

interface Schema {
  type?: string | string[];
  enum?: unknown[];
  format?: string;
  properties?: Record<string, Schema>;
  required?: string[];
  items?: Schema;
}

/** 常见叫法 → 规范值。只有规范值在该字段允许的取值里时才会用上。 */
const SYNONYMS: Record<string, string> = {
  breakfast: "早",
  morning: "早",
  早餐: "早",
  早饭: "早",
  早上: "早",
  brunch: "午",
  lunch: "午",
  noon: "午",
  午餐: "午",
  午饭: "午",
  中午: "午",
  中饭: "午",
  dinner: "晚",
  supper: "晚",
  evening: "晚",
  晚餐: "晚",
  晚饭: "晚",
  晚上: "晚",
  snack: "加餐",
  snacks: "加餐",
  零食: "加餐",
  夜宵: "加餐",
  宵夜: "加餐",
  下午茶: "加餐",
  news: "article",
  blog: "article",
  web: "article",
  tweet: "x_post",
  post: "x_post",
  x: "x_post",
  youtube: "video",
  h: "high",
  高: "high",
  偏高: "high",
  l: "low",
  低: "low",
  偏低: "low",
  正常: "normal",
  异常: "abnormal",
};

const HAS_OFFSET = /(Z|[+-]\d{2}:\d{2})$/i;

function types(schema: Schema): string[] {
  return ([] as string[]).concat(schema.type ?? []);
}

function enumValue(allowed: unknown[], value: string, key: string | undefined): string {
  if (allowed.includes(value)) return value;
  const options = allowed.filter((item): item is string => typeof item === "string");
  const lower = value.toLowerCase();
  const synonym = SYNONYMS[lower];
  const match =
    options.find((item) => item.toLowerCase() === lower) ??
    (synonym && options.includes(synonym) ? synonym : undefined) ??
    // 只有交来的 Agent（via）认前缀：grok-bot → grok、codex-cli → codex。其他取值写错交给校验，
    // 不把 private-shared 悄悄改成 private。
    (key === "via"
      ? options.find(
          (item) =>
            /^[a-z]/.test(item) && lower.startsWith(item) && /^[-_ .]?$/.test(lower[item.length] ?? ""),
        )
      : undefined);
  if (match) return match;
  return key === "via" && options.includes("agent") ? "agent" : value;
}

/** 字段名带单位时可接受的写法和换算到该单位的倍数。 */
const UNITS: [RegExp, Record<string, number>][] = [
  [/_kg$/, { kg: 1, kgs: 1, 公斤: 1, 千克: 1, lb: 0.45359237, lbs: 0.45359237, 磅: 0.45359237, 斤: 0.5 }],
  [
    /(_g|^grams)$/,
    { g: 1, 克: 1, kg: 1000, 公斤: 1000, 千克: 1000, mg: 0.001, 毫克: 0.001, oz: 28.349523125 },
  ],
  [
    /_min$/,
    {
      min: 1,
      mins: 1,
      minute: 1,
      minutes: 1,
      分钟: 1,
      分: 1,
      h: 60,
      hr: 60,
      hrs: 60,
      hour: 60,
      hours: 60,
      小时: 60,
      个小时: 60,
      s: 1 / 60,
      sec: 1 / 60,
      秒: 1 / 60,
    },
  ],
  [
    /_km$/,
    {
      km: 1,
      公里: 1,
      千米: 1,
      m: 0.001,
      米: 0.001,
      mi: 1.609344,
      mile: 1.609344,
      miles: 1.609344,
      英里: 1.609344,
    },
  ],
  [/_m$/, { m: 1, 米: 1, km: 1000, 公里: 1000, ft: 0.3048, feet: 0.3048, 英尺: 0.3048 }],
  [/(^|_)kcal$/, { kcal: 1, cal: 1, 千卡: 1, 大卡: 1, 卡: 1, 卡路里: 1, kj: 1 / 4.184, 千焦: 1 / 4.184 }],
];
// 数字旁边常见的修饰词和营养名，不算单位：「约 35 g 蛋白质」「1050 calories」。
const NOISE =
  /约|大约|大概|左右|上下|~|≈|about|approx|around|蛋白质|蛋白|protein|碳水化合物|碳水|carbohydrates?|carbs?|脂肪|fat|热量|calories/gi;

/**
 * 「约 1050 kcal」「8,532 步」里取出唯一的数字。字段名带单位（weight_kg、duration_min……）时
 * 只认同一单位，能换算的换算（150 lb → 68.04 kg、2 hours → 120 分钟），认不出的单位交给校验，
 * 不把 150 磅当成 150 公斤。
 */
function numberValue(value: string, key?: string): number | undefined {
  const text = value.replace(/(\d),(?=\d{3}\b)/g, "$1");
  const found = text.match(/-?\d+(?:\.\d+)?/g);
  if (found?.length !== 1) return undefined;
  const number = Number(found[0]);
  const units = key ? UNITS.find(([pattern]) => pattern.test(key))?.[1] : undefined;
  if (!units) return number;
  const unit = text
    .replace(found[0], "")
    .replace(NOISE, "")
    .replace(/[\s.,，。]/g, "")
    .toLowerCase();
  if (!unit) return number;
  const factor = units[unit];
  return factor === undefined ? undefined : Math.round(number * factor * 100) / 100;
}

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

function list(value: string, items: Schema | undefined): string[] {
  const lines = value
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:[-*•·]|\d+[.)、])\s*/, "").trim())
    .filter(Boolean);
  // 「米饭、鸡蛋」这样的菜名清单按顿号逗号拆开；文字要点只按行拆。
  if (lines.length === 1 && items?.required?.includes("name"))
    return value
      .split(/[、，,；;+]/)
      .map((part) => part.trim())
      .filter(Boolean);
  return lines;
}

function normalizeValue(schema: Schema | undefined, raw: unknown, timeZone: string, key?: string): unknown {
  if (!schema) return raw;
  const value = raw;
  const kinds = types(schema);
  // 只在需要换写法时去掉首尾空白；普通文字原样保存（备注末尾的换行有用）。
  if (typeof value === "string") {
    const text = value.trim();
    if (schema.enum) return enumValue(schema.enum, text, key);
    if (kinds.includes("number") || kinds.includes("integer")) {
      const number = numberValue(text, key);
      return number !== undefined && (!kinds.includes("integer") || Number.isInteger(number))
        ? number
        : value;
    }
    if (schema.format === "date-time") return dateTime(text, timeZone);
  }
  if (kinds.includes("array")) {
    const items = schema.items;
    const values =
      typeof value === "string"
        ? list(value, items)
        : value && typeof value === "object" && !Array.isArray(value)
          ? [value]
          : value;
    if (!Array.isArray(values)) return value;
    return values.map((item) =>
      normalizeValue(
        items,
        typeof item === "string" && items?.required?.includes("name") && types(items).includes("object")
          ? { name: item }
          : item,
        timeZone,
      ),
    );
  }
  if (schema.properties && value && typeof value === "object" && !Array.isArray(value))
    return normalizeObject(schema, value as Record<string, unknown>, timeZone);
  return value;
}

function normalizeObject(schema: Schema, data: Record<string, unknown>, timeZone: string, keepEmpty = false) {
  const out: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(data)) {
    const property = schema.properties?.[key];
    // 新增时可选字段交了空值（null、""）等于没交；修改时空值可能是要清空，原样保留。
    if (!keepEmpty && property && (raw === null || raw === "") && !schema.required?.includes(key)) continue;
    out[key] = normalizeValue(property, raw, timeZone, key);
  }
  return out;
}

export function normalizeRecordInput(
  schema: unknown,
  data: Record<string, unknown>,
  timeZone: string,
  now: Date,
  options: { patch?: boolean } = {},
): Record<string, unknown> {
  const root = (schema ?? {}) as Schema;
  const out = normalizeObject(root, data, timeZone, options.patch);
  if (typeof out.ts === "string") out.ts = dateTime(out.ts.trim(), timeZone);
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
