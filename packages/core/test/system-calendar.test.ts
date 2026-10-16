import ICAL from "ical.js";
import { describe, expect, it } from "vitest";
import {
  type CalendarExecutor,
  CalendarPush,
  type CalendarPushEntry,
  type TodayPlan,
  addTask,
  calendarPushEntries,
  calendarPushStore,
  cancelTask,
  decideProposal,
  parseFrontmatter,
  scheduleNext,
  stringifyFrontmatter,
} from "../src/index.js";
import { freshWorkspace } from "./helpers.js";

function fakeCalendar() {
  const events = new Map<string, CalendarPushEntry>();
  let creates = 0;
  const executor: CalendarExecutor = {
    async upsert(entry, uid) {
      if (uid && !events.has(uid)) return null;
      const key = uid ?? `event-${++creates}`;
      events.set(key, structuredClone(entry));
      return key;
    },
    async remove(uid) {
      events.delete(uid);
    },
  };
  return { executor, events, created: () => creates };
}

describe("confirmed system calendar", () => {
  it("writes only confirmed slots, preserves identity on reschedule, cancels and respects manual deletion and the switch", async () => {
    const ws = await freshWorkspace();
    ws.writeText(
      "NOW.md",
      stringifyFrontmatter(
        {
          date: "2026-10-16",
          blocks: [
            {
              id: "slot",
              title: "合成下一步",
              kind: "proposal",
              status: "pending",
              start: "10:00",
              end: "11:00",
            },
            {
              id: "later",
              title: "待确认",
              kind: "proposal",
              status: "pending",
              start: "12:00",
              end: "13:00",
            },
            { id: "untimed", title: "待办", kind: "task", status: "confirmed" },
          ],
        },
        "",
      ),
    );
    const calendar = fakeCalendar();
    const store = calendarPushStore(ws);
    const sync = () => new CalendarPush(store, calendar.executor).sync(calendarPushEntries(ws));
    await sync();
    expect(calendar.events.size).toBe(0);
    await decideProposal(ws, "slot", "confirmed");
    await sync();
    const uid = [...calendar.events.keys()][0];
    expect(calendar.events.size).toBe(1);
    expect(calendar.events.get(uid)?.start).toBe("2026-10-16T02:00:00.000Z");
    await decideProposal(ws, "slot", "confirmed");
    await sync();
    expect(calendar.created()).toBe(1);
    const plan = parseFrontmatter<TodayPlan>(ws.readText("NOW.md"));
    plan.data.blocks[0].start = "14:00";
    plan.data.blocks[0].end = "15:00";
    ws.writeText("NOW.md", stringifyFrontmatter(plan.data, plan.body));
    await sync();
    expect(calendar.events.get(uid)?.start).toBe("2026-10-16T06:00:00.000Z");
    expect(calendar.created()).toBe(1);
    const writer = new CalendarPush(store, calendar.executor);
    writer.configure(false);
    await decideProposal(ws, "slot", "rejected");
    await sync();
    expect(calendar.events.size).toBe(1);
    writer.configure(true);
    await sync();
    expect(calendar.events.size).toBe(0);
    await decideProposal(ws, "later", "confirmed");
    await sync();
    calendar.events.clear();
    await sync();
    expect(store.read().entries.later.receipt.status).toBe("deleted");
    await sync();
    expect(calendar.created()).toBe(2);
    expect(calendar.events.size).toBe(0);
    const task = await addTask(ws, { title: "合成的已采纳下一步" });
    await scheduleNext(ws, "task", task.record.id, "16:00", "17:00");
    await sync();
    expect(calendar.events.size).toBe(1);
    await cancelTask(ws, task.record.id);
    await sync();
    expect(calendar.events.size).toBe(0);
  });

  it("falls back to parseable ICS with a stable UID and revision when executor fails", async () => {
    const ws = await freshWorkspace();
    ws.writeText(
      "NOW.md",
      stringifyFrontmatter(
        {
          date: "2026-10-16",
          blocks: [
            {
              id: "ics-slot",
              title: '测试 "引号"\n换行',
              kind: "proposal",
              status: "pending",
              start: "10:00",
              end: "11:00",
            },
          ],
        },
        "",
      ),
    );
    await decideProposal(ws, "ics-slot", "confirmed");
    const writer = new CalendarPush(calendarPushStore(ws), {
      async upsert() {
        throw new Error("permission denied");
      },
      async remove() {
        throw new Error("permission denied");
      },
    });
    const first = (await writer.sync(calendarPushEntries(ws))).entries["ics-slot"];
    expect(first.status).toBe("file");
    const parse = (ics = "") =>
      new ICAL.Event(new ICAL.Component(ICAL.parse(ics)).getFirstSubcomponent("vevent") ?? undefined);
    const event = parse(first.ics);
    expect(event.uid).toBe("kaitu-block-ics-slot");
    expect(event.summary).toBe('测试 "引号"\n换行');
    expect(event.startDate.toJSDate().toISOString()).toBe("2026-10-16T02:00:00.000Z");
    const next = calendarPushEntries(ws);
    next[0].end = "2026-10-16T04:00:00.000Z";
    const second = (await writer.sync(next, next[0].id)).entries["ics-slot"];
    expect(parse(second.ics).uid).toBe(event.uid);
    expect(parse(second.ics).endDate.toJSDate().toISOString()).toBe(next[0].end);
    expect(parse(second.ics).sequence).toBeGreaterThan(event.sequence);
    await decideProposal(ws, "ics-slot", "rejected");
    const cancelled = (await writer.sync(calendarPushEntries(ws))).entries["ics-slot"];
    expect(parse(cancelled.ics).uid).toBe(event.uid);
    expect(parse(cancelled.ics).component.getFirstPropertyValue("status")).toBe("CANCELLED");
  });
});
