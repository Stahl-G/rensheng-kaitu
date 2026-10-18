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
  editCalendarBlock,
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
  it("updates the iPhone-written event once it syncs here, never creates it, and only then allows moving it", async () => {
    const ws = await freshWorkspace();
    const block = {
      id: "slot",
      title: "手机确认的日程",
      kind: "proposal",
      status: "confirmed",
      calendar: "phone",
    };
    ws.writeText(
      "NOW.md",
      stringifyFrontmatter({ date: "2026-10-16", blocks: [{ ...block, start: "10:00", end: "11:00" }] }, ""),
    );
    const events = new Map<string, CalendarPushEntry>();
    let failing = false;
    const executor: CalendarExecutor = {
      async upsert(entry, uid, changed) {
        if (failing) throw new Error("日历超时");
        const key =
          uid ??
          [...events].find(([, event]) => event.notes.split("\n").includes(`开图记录：${entry.id}`))?.[0];
        if (!key) return null;
        if (changed !== false) events.set(key, structuredClone(entry));
        return key;
      },
      async remove(uid) {
        events.delete(uid);
      },
    };
    const push = new CalendarPush(calendarPushStore(ws), executor);
    await push.sync(calendarPushEntries(ws));
    expect(events.size).toBe(0);
    await expect(editCalendarBlock(ws, "slot", "14:00", "15:00", push.located("slot"))).rejects.toThrow(
      "iPhone",
    );
    // iPhone 写的那条经 iCloud 同步到这台电脑之后才能跟着改。同步过来前已在手机上挪到 11:00（UTC 03:00），
    // 第一次找到时不能改回 10:00；找的时候出错要下次再找，不记成要导入的日历文件。
    const notes = "做完后回开图记一句结果\n开图记录：2026-10-16/slot";
    const moved = {
      id: "2026-10-16/slot",
      title: block.title,
      start: "2026-10-16T03:00:00.000Z",
      end: "",
      notes,
    };
    events.set("iphone-event", moved);
    failing = true;
    await push.sync(calendarPushEntries(ws));
    expect(calendarPushStore(ws).read().entries).toEqual({});
    failing = false;
    await push.sync(calendarPushEntries(ws));
    expect(events.get("iphone-event")).toEqual(moved);
    // 找到了也要这里能写回日历：没有执行器（DSH 插件）或同步关着时仍然不让改。
    expect(new CalendarPush(calendarPushStore(ws)).located("slot")).toBe(false);
    push.configure(false);
    expect(push.located("slot")).toBe(false);
    push.configure(true);
    await editCalendarBlock(ws, "slot", "14:00", "15:00", push.located("slot"));
    await push.sync(calendarPushEntries(ws));
    expect([...events.keys()]).toEqual(["iphone-event"]);
    expect(events.get("iphone-event")?.start).toBe("2026-10-16T06:00:00.000Z");
  });

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
    const goal = { id: "goal-materials", title: "完成作品集", status: "active" };
    ws.writeJson("me/goals.json", [goal]);
    const linked = parseFrontmatter<TodayPlan>(ws.readText("NOW.md"));
    linked.data.blocks[0].ref = goal.id;
    ws.writeText("NOW.md", stringifyFrontmatter(linked.data, linked.body));
    const calendar = fakeCalendar();
    const store = calendarPushStore(ws);
    const sync = () => new CalendarPush(store, calendar.executor).sync(calendarPushEntries(ws));
    await sync();
    expect(calendar.events.size).toBe(0);
    await decideProposal(ws, "slot", "confirmed");
    await sync();
    const uid = [...calendar.events.keys()][0];
    expect(calendar.events.size).toBe(1);
    expect(calendar.events.get(uid)?.notes).toContain(goal.title);
    expect(calendar.events.get(uid)?.notes).not.toContain(linked.data.blocks[0].title);
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
    expect(store.read().entries["2026-10-16/later"].receipt.status).toBe("deleted");
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
    await decideProposal(ws, "slot", "confirmed");
    await sync();
    const yesterdayUid = [...calendar.events.keys()][0];
    const yesterday = structuredClone(calendar.events.get(yesterdayUid));
    ws.writeText("NOW.md", stringifyFrontmatter({ date: "2026-10-17", blocks: [] }, ""));
    await sync();
    expect(calendar.events.get(yesterdayUid)).toEqual(yesterday);
    ws.writeText(
      "NOW.md",
      stringifyFrontmatter(
        {
          date: "2026-10-17",
          blocks: [
            {
              id: "slot",
              title: "新一天的安排",
              kind: "proposal",
              status: "confirmed",
              start: "10:00",
              end: "11:00",
            },
          ],
        },
        "",
      ),
    );
    await sync();
    expect(calendar.events.size).toBe(2);
    expect(calendar.events.get(yesterdayUid)).toEqual(yesterday);
    const todayUid = store.read().entries["2026-10-17/slot"].uid;
    expect(todayUid).not.toBe(yesterdayUid);
    expect(writer.settings().entries.slot.status).toBe("added");
    await decideProposal(ws, "slot", "rejected");
    await sync();
    expect(calendar.events.has(todayUid ?? "")).toBe(false);
    expect(calendar.events.get(yesterdayUid)).toEqual(yesterday);
    await writer.removeAll();
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
    expect(event.uid).toBe("kaitu-block-2026-10-16/ics-slot");
    expect(event.summary).toBe('测试 "引号"\n换行');
    expect(event.description).not.toContain(event.summary);
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
    await decideProposal(ws, "ics-slot", "confirmed");
    await writer.sync(calendarPushEntries(ws));
    const yesterday = calendarPushStore(ws).read().entries["2026-10-16/ics-slot"];
    const plan = parseFrontmatter<TodayPlan>(ws.readText("NOW.md"));
    plan.data.date = "2026-10-17";
    plan.data.blocks[0].status = "confirmed";
    ws.writeText("NOW.md", stringifyFrontmatter(plan.data, plan.body));
    const today = (await writer.sync(calendarPushEntries(ws))).entries["ics-slot"];
    expect(parse(today.ics).uid).not.toBe(event.uid);
    expect(parse(today.ics).startDate.toJSDate().toISOString()).toBe("2026-10-17T02:00:00.000Z");
    expect(calendarPushStore(ws).read().entries["2026-10-16/ics-slot"]).toEqual(yesterday);
    const retry = (await writer.sync(calendarPushEntries(ws), "ics-slot")).entries["ics-slot"];
    expect(parse(retry.ics).uid).toBe(parse(today.ics).uid);
  });
});

it("Agent 手写、没写 id 的时间段也能同步到系统日历，用和今天页一样的 id", async () => {
  const ws = await freshWorkspace("Asia/Shanghai");
  ws.writeText(
    "NOW.md",
    '---\ndate: "2026-10-17"\nblocks:\n  - { title: 写周报, kind: task, status: confirmed, start: "15:00", end: "16:00" }\n---\n',
  );
  const entries = calendarPushEntries(ws);
  expect(entries).toHaveLength(1);
  expect(entries[0]?.id).toMatch(/^2026-10-17\/b-[0-9a-f]{8}$/);
  const calendar = fakeCalendar();
  const result = await new CalendarPush(calendarPushStore(ws), calendar.executor).sync(entries);
  // 同步后按当天的时间段 id 记下回执：日期前缀和条目对得上才会真的写进日历。
  expect(result.entries[(entries[0]?.id as string).slice("2026-10-17/".length)]?.status).toBe("added");
});
