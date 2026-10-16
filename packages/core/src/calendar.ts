import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { KaituError } from "./errors.js";
import { parseFrontmatter } from "./frontmatter.js";
import { importIcs } from "./importers/ics.js";
import { readRecords } from "./records.js";
import { localDate, localTimeToInstant } from "./time.js";
import type { TodayPlan } from "./workbench.js";
import { type Workspace, stateDirectory } from "./workspace.js";

export interface CalendarSubscription {
  id: string;
  name: string;
  url: string;
  attemptedAt: string | null;
  syncedAt: string | null;
  error: string | null;
}
export interface CalendarEntry {
  id: string;
  title: string;
  start: string;
  end?: string;
  source: string;
  pending: boolean;
}
export interface CalendarData {
  today: string;
  timeZone: string;
  events: CalendarEntry[];
  subscriptions: Omit<CalendarSubscription, "url">[];
}
// 私有日历的订阅地址本身就是凭据，只存本机状态目录，不进同步盘。
const file = (ws: Workspace) => join(stateDirectory(ws.root), "calendar-subscriptions.json");
const interval = 15 * 60 * 1000;
const subscriptions = (ws: Workspace): CalendarSubscription[] =>
  existsSync(file(ws)) ? JSON.parse(readFileSync(file(ws), "utf8")) : [];
const save = (ws: Workspace, rows: CalendarSubscription[]) => {
  mkdirSync(dirname(file(ws)), { recursive: true });
  writeFileSync(file(ws), `${JSON.stringify(rows, null, 2)}\n`, { mode: 0o600 });
};

export async function addCalendarSubscription(ws: Workspace, address: string, name: string) {
  let url: URL;
  try {
    url = new URL(address.replace(/^webcal:/i, "https:"));
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) throw new Error();
  } catch {
    throw new KaituError("请输入有效的 ICS 订阅地址", "BAD_ARGS");
  }
  const rows = subscriptions(ws);
  if (rows.some((row) => row.url === url.href)) throw new KaituError("这个日历已经添加", "CONFLICT");
  rows.push({
    id: randomUUID(),
    name: name.trim().slice(0, 100) || "订阅日历",
    url: url.href,
    attemptedAt: null,
    syncedAt: null,
    error: null,
  });
  save(ws, rows);
  await pullCalendarSubscriptions(ws);
  return readCalendar(ws);
}

export async function pullCalendarSubscriptions(ws: Workspace, now = new Date()) {
  const rows = subscriptions(ws);
  for (const row of rows) {
    if (row.attemptedAt && +now - Date.parse(row.attemptedAt) < interval) continue;
    row.attemptedAt = now.toISOString();
    const directory = mkdtempSync(join(tmpdir(), "kaitu-calendar-"));
    try {
      const response = await fetch(row.url, { signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw new Error();
      const reader = response.body?.getReader();
      if (!reader) throw new Error();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 10 * 1024 * 1024) throw new Error();
          chunks.push(value);
        }
      } finally {
        await reader.cancel();
      }
      const input = join(directory, "calendar.ics");
      writeFileSync(input, Buffer.concat(chunks), { mode: 0o600 });
      await importIcs(ws, input, { calendar: `subscription:${row.id}`, now });
      row.syncedAt = now.toISOString();
      row.error = null;
    } catch {
      row.error = "日历拉取失败，稍后重试";
    } finally {
      rmSync(directory, { recursive: true, force: true });
      save(ws, rows);
    }
  }
}

export function readCalendar(ws: Workspace, now = new Date()): CalendarData {
  const rows = subscriptions(ws);
  const labels = new Map(rows.map((row) => [`subscription:${row.id}`, row.name]));
  const events: CalendarEntry[] = readRecords(ws, "event").map((row) => ({
    id: row.id,
    title: String(row.title),
    start: String(row.start),
    end: String(row.end),
    source:
      labels.get(String(row.calendar)) ??
      (/^[0-9a-f-]{36}$/i.test(String(row.calendar)) ? "导入日历 · 名称未记录" : String(row.calendar)),
    pending: false,
  }));
  if (ws.exists("NOW.md")) {
    const { data } = parseFrontmatter<TodayPlan>(ws.readText("NOW.md"));
    const date = data.date;
    for (const block of data.blocks ?? []) {
      if (!date || !block.start || ["rejected", "skipped"].includes(block.status)) continue;
      const start = block.start;
      if (block.ref && events.some((event) => event.id === block.ref)) continue;
      if (
        block.kind === "event" &&
        events.some(
          (event) =>
            event.title === block.title &&
            Date.parse(event.start) ===
              +localTimeToInstant(`${date}T${start.length === 5 ? `${start}:00` : start}`, ws.timeZone()),
        )
      )
        continue;
      events.push({
        id: block.id,
        title: block.title,
        source: "开图",
        pending: block.status === "pending",
        start: `${date}T${block.start}`,
        ...(block.end ? { end: `${date}T${block.end}` } : {}),
      });
    }
  }
  return {
    today: localDate(now, ws.timeZone()),
    timeZone: ws.timeZone(),
    events,
    subscriptions: rows.map(({ url: _url, ...row }) => row),
  };
}
