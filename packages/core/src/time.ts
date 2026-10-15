/** 时区工具：所有日期切分都按用户本地时区（rules.md 的 timezone）。 */

interface Parts {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
  second: string;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function partsIn(date: Date, timeZone: string): Parts {
  let fmt = formatters.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    formatters.set(timeZone, fmt);
  }
  const out: Record<string, string> = {};
  for (const p of fmt.formatToParts(date)) out[p.type] = p.value;
  return out as unknown as Parts;
}

export function assertTimeZone(timeZone: string): void {
  try {
    new Intl.DateTimeFormat("en", { timeZone });
  } catch {
    throw new Error(`无效的时区：${timeZone}`);
  }
}

/** 该时区相对 UTC 的偏移（分钟），东八区为 +480。 */
export function offsetMinutes(date: Date, timeZone: string): number {
  const p = partsIn(date, timeZone);
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000);
}

/** 带时区偏移的 ISO 8601，如 2026-10-15T21:00:00+08:00。 */
export function isoInZone(date: Date, timeZone: string): string {
  const p = partsIn(date, timeZone);
  const off = offsetMinutes(date, timeZone);
  const sign = off >= 0 ? "+" : "-";
  const abs = Math.abs(off);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}${sign}${hh}:${mm}`;
}

/** 某时刻在用户时区的本地日期 YYYY-MM-DD。 */
export function localDate(date: Date, timeZone: string): string {
  const p = partsIn(date, timeZone);
  return `${p.year}-${p.month}-${p.day}`;
}

export function localMonth(date: Date, timeZone: string): string {
  return localDate(date, timeZone).slice(0, 7);
}

const HAS_OFFSET = /(Z|[+-]\d{2}:\d{2})$/i;

/** 解析带偏移的 ISO 时间；不带偏移的时间有歧义，拒绝。 */
export function parseTs(ts: string): Date {
  if (!HAS_OFFSET.test(ts)) throw new Error(`时间必须带时区偏移：${ts}`);
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) throw new Error(`无法解析的时间：${ts}`);
  return d;
}

export function localTimeToInstant(wall: string, timeZone: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(wall)) throw new Error("本地时间格式不合法");
  const naive = new Date(`${wall}Z`);
  if (!Number.isFinite(naive.getTime()) || naive.toISOString().slice(0, 19) !== wall) {
    throw new Error("本地时间不合法");
  }
  const offsets = new Set(
    [-86400000, 0, 86400000].map((delta) => offsetMinutes(new Date(naive.getTime() + delta), timeZone)),
  );
  const candidates = [...offsets].map((offset) => new Date(naive.getTime() - offset * 60000));
  const matches = candidates.filter((date) => isoInZone(date, timeZone).slice(0, 19) === wall);
  // 重复时刻取第一次，春季跳时按跳时前的偏移解释（RFC 5545）。
  return new Date(matches.length ? Math.min(...matches.map(Number)) : Math.max(...candidates.map(Number)));
}

export function timeZoneNotice(timeZone: string, now = new Date()): string {
  return `时区：${timeZone}（UTC${isoInZone(now, timeZone).slice(-6)}）；以下时间均为该时区。`;
}
