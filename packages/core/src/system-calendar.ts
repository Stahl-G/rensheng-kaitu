import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import ICAL from "ical.js";
import { normalizeNow, normalizeStatus } from "./doc-input.js";
import { parseFrontmatter } from "./frontmatter.js";
import { localStateRoot } from "./local-state.js";
import { stateBinding } from "./state-binding.js";
import { listTasks } from "./tasks.js";
import { localTimeToInstant } from "./time.js";
import { type Goal, type ModuleStatus, type TodayPlan, statusFiles } from "./workbench.js";
import type { Workspace } from "./workspace.js";

export interface CalendarPushEntry {
  id: string;
  title: string;
  start: string;
  end: string;
  notes: string;
  /** 在 iPhone 上确认、由手机写进日历：电脑只更新找得到的那条，从不新建。 */
  phone?: true;
}
export interface CalendarPushReceipt {
  status: "added" | "file" | "deleted" | "removed" | "error";
  reason?: string;
  ics?: string;
}
export interface CalendarPushSettings {
  enabled: boolean;
  entries: Record<string, CalendarPushReceipt>;
}
export interface CalendarPushResult {
  version: string | null;
  calendarPush: CalendarPushSettings;
}
interface Mapping {
  suppressed?: boolean;
  uid?: string;
  entry: CalendarPushEntry;
  receipt: CalendarPushReceipt;
  sequence: number;
}
export interface CalendarPushState {
  enabled: boolean;
  entries: Record<string, Mapping>;
}
export interface CalendarPushStore {
  date(): string | null;
  read(): CalendarPushState;
  write(state: CalendarPushState): void;
}
export interface CalendarExecutor {
  upsert(entry: CalendarPushEntry, uid?: string, changed?: boolean): Promise<string | null>;
  remove(uid: string, entry: CalendarPushEntry): Promise<void>;
}
function nowPlan(ws: Workspace): TodayPlan {
  return normalizeNow(parseFrontmatter(ws.readText("NOW.md")).data) as unknown as TodayPlan;
}
export function calendarPushStore(ws: Workspace): CalendarPushStore {
  const file = () => join(localStateRoot(), "system-calendar", `${stateBinding(ws.root).id}.json`);
  return {
    date: () => (ws.exists("NOW.md") ? nowPlan(ws).date : null),
    read: () =>
      existsSync(file()) ? JSON.parse(readFileSync(file(), "utf8")) : { enabled: true, entries: {} },
    write: (state) => {
      const path = file();
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      const temp = `${path}.${randomUUID()}.tmp`;
      writeFileSync(temp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
      renameSync(temp, path);
    },
  };
}
export function calendarPushEntries(ws: Workspace): CalendarPushEntry[] {
  if (!ws.exists("NOW.md")) return [];
  // 和今天页读同一份补齐后的数据：Agent 手写、没写 id 的时间段也有稳定 id。
  const data = nowPlan(ws);
  if (!data.date) return [];
  const previous = calendarPushStore(ws).read().entries;
  const tasks = listTasks(ws, { status: "all" });
  const related = new Map(tasks.map((task) => [task.id, task.title]));
  const taskIds = new Set(tasks.filter((task) => task.status !== "cancelled").map((task) => task.id));
  for (const { file } of statusFiles(ws)) {
    const status = normalizeStatus(parseFrontmatter(ws.readText(file)).data) as unknown as ModuleStatus;
    for (const item of status.next ?? []) {
      related.set(item.id, item.title);
      if (item.status !== "skipped") taskIds.add(item.id);
    }
  }
  if (ws.exists("me/goals.json")) {
    for (const goal of ws.readJson<Goal[]>("me/goals.json")) related.set(goal.id, goal.title);
  }
  return data.blocks.flatMap((block) => {
    // 读不出的时间段（没标题、没 id）留给校验报出来，这里不同步。
    if (!block || typeof block.id !== "string" || typeof block.title !== "string") return [];
    const id = `${data.date}/${block.id}`;
    const linkedTitle = block.ref ? related.get(block.ref) : undefined;
    if (block.kind === "task" && block.id.startsWith("next-") && block.ref && !taskIds.has(block.ref))
      return [];
    if (
      !(block.status === "confirmed" || (block.status === "done" && previous[id])) ||
      !["proposal", "task"].includes(block.kind) ||
      !block.start ||
      !block.end
    )
      return [];
    const start = localTimeToInstant(`${data.date}T${block.start}:00`, ws.timeZone()).toISOString();
    const nextDate = new Date(Date.parse(`${data.date}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
    const end = localTimeToInstant(
      block.end === "24:00" ? `${nextDate}T00:00:00` : `${data.date}T${block.end}:00`,
      ws.timeZone(),
    ).toISOString();
    if (Date.parse(end) <= Date.parse(start)) return [];
    return [
      {
        id,
        title: block.title,
        start,
        end,
        notes: `${linkedTitle ? `关联目标：${linkedTitle}｜` : ""}做完后回开图记一句结果\n开图记录：${id}${block.ref ? `（${block.ref}）` : ""}`,
        ...(block.calendar === "phone" ? { phone: true as const } : {}),
      },
    ];
  });
}
export function calendarPushIcs(entry: CalendarPushEntry, sequence = 0, cancelled = false): string {
  const calendar = new ICAL.Component(["vcalendar", [], []]);
  calendar.updatePropertyWithValue("version", "2.0");
  calendar.updatePropertyWithValue("prodid", "-//Kaitu//Calendar//ZH");
  const component = new ICAL.Component("vevent");
  const event = new ICAL.Event(component);
  event.uid = `kaitu-block-${entry.id}`;
  event.summary = entry.title;
  event.description = entry.notes;
  event.startDate = ICAL.Time.fromDateTimeString(entry.start.replace(/\.\d{3}Z$/, "Z"));
  event.endDate = ICAL.Time.fromDateTimeString(entry.end.replace(/\.\d{3}Z$/, "Z"));
  component.updatePropertyWithValue("dtstamp", ICAL.Time.fromJSDate(new Date(), true));
  component.updatePropertyWithValue("sequence", sequence);
  if (cancelled) component.updatePropertyWithValue("status", "CANCELLED");
  if (!cancelled) {
    const alarm = new ICAL.Component("valarm");
    alarm.updatePropertyWithValue("action", "DISPLAY");
    alarm.updatePropertyWithValue("description", entry.title);
    alarm.updatePropertyWithValue("trigger", ICAL.Duration.fromString("-PT10M"));
    component.addSubcomponent(alarm);
  }
  calendar.addSubcomponent(component);
  return `${calendar.toString()}\r\n`;
}
export class CalendarPush {
  constructor(
    readonly store: CalendarPushStore,
    readonly executor?: CalendarExecutor,
  ) {}
  settings(): CalendarPushSettings {
    const state = this.store.read();
    const prefix = `${this.store.date()}/`;
    const rows = Object.entries(state.entries);
    return {
      enabled: state.enabled,
      entries: Object.fromEntries([
        ...rows.filter(([id]) => !id.startsWith(prefix)).map(([id, row]) => [id, row.receipt]),
        ...rows
          .filter(([id]) => id.startsWith(prefix))
          .map(([id, row]) => [id.slice(prefix.length), row.receipt]),
      ]),
    };
  }
  /** 这台电脑已在日历里找到该时间段的事件，包括 iPhone 写入、经 iCloud 同步来的那条。 */
  located(id: string) {
    const date = this.store.date();
    return Boolean(date && this.store.read().entries[`${date}/${id}`]?.uid);
  }
  configure(enabled: boolean) {
    const state = this.store.read();
    state.enabled = enabled;
    this.store.write(state);
    return this.settings();
  }
  async sync(entries: CalendarPushEntry[], retryId?: string, removeAll = false) {
    const state = this.store.read();
    if (!state.enabled && !removeAll) return this.settings();
    const date = this.store.date();
    const prefix = `${date}/`;
    const current = date ? entries.filter((entry) => entry.id.startsWith(prefix)) : [];
    const desired = new Map(current.map((entry) => [entry.id, entry]));
    for (const [id, row] of Object.entries(state.entries)) {
      if (!removeAll && (!date || !id.startsWith(prefix) || desired.has(id))) continue;
      if (["removed", "deleted"].includes(row.receipt.status)) continue;
      try {
        if (row.uid) {
          if (!this.executor) throw new Error("请在 Kaitu.app 中移除已写入的日历事件");
          await this.executor.remove(row.uid, row.entry);
        }
        row.suppressed = removeAll;
        row.sequence++;
        row.receipt = {
          status: "removed",
          ...(!row.uid
            ? {
                ics: calendarPushIcs(row.entry, row.sequence, true),
                reason: "请导入取消文件以移除之前导入的事件",
              }
            : {}),
        };
      } catch (error) {
        row.receipt = {
          status: "error",
          reason: error instanceof Error ? error.message : String(error),
          ics: calendarPushIcs(row.entry, row.sequence + 1, true),
        };
      }
      this.store.write(state);
    }
    if (removeAll) return this.settings();
    for (const entry of current) {
      // 手机写的日程没有日历可改时（非 macOS），也不另生成日历文件。
      if (entry.phone && !this.executor) continue;
      let old = state.entries[entry.id];
      if (old?.receipt.status === "deleted" || old?.suppressed) continue;
      if (old?.receipt.status === "removed") {
        old.uid = undefined;
        old = { ...old, receipt: { status: "error" }, entry: { ...old.entry, start: "" } };
      }
      const changed = !old || JSON.stringify(old.entry) !== JSON.stringify(entry);
      if (
        !changed &&
        ["file", "error"].includes(old?.receipt.status ?? "") &&
        retryId !== entry.id &&
        retryId !== entry.id.slice(prefix.length)
      )
        continue;
      const row: Mapping = old ?? { entry, sequence: -1, receipt: { status: "error" } };
      if (changed) row.sequence++;
      row.entry = entry;
      state.entries[entry.id] = row;
      try {
        if (!this.executor) throw new Error("当前为浏览器、DSH 插件或非 macOS 环境，请导入日历文件");
        // 第一次找到手机那条只记下编号、不改它：手机上可能已经挪过时间。
        const discovering = entry.phone && !row.uid;
        const uid = await this.executor.upsert(entry, row.uid, discovering ? false : changed);
        if (uid === null && discovering) {
          // iPhone 写的那条还没同步到这台电脑：先不记，下次再找，不替手机新建。
          delete state.entries[entry.id];
          continue;
        }
        if (uid === null) row.receipt = { status: "deleted" };
        else {
          row.uid = uid;
          row.receipt = { status: "added" };
        }
      } catch (error) {
        // 找手机那条出错（超时、没权限）就下次再找，不生成会和手机重复的日历文件。
        if (entry.phone && !row.uid) {
          delete state.entries[entry.id];
          continue;
        }
        row.receipt = {
          status: "file",
          ics: calendarPushIcs(entry, row.sequence),
          reason: error instanceof Error ? error.message : String(error),
        };
      }
      this.store.write(state);
    }
    return this.settings();
  }
  removeAll() {
    return this.sync([], undefined, true);
  }
}
