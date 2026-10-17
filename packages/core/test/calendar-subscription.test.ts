import { expect, it, vi } from "vitest";
import { fetchCalendar } from "../src/calendar-fetch.js";
import { addCalendarSubscription, pullCalendarSubscriptions, readCalendar } from "../src/calendar.js";
import { deleteRecord, readRecords, updateRecord } from "../src/records.js";
import { freshWorkspace } from "./helpers.js";

vi.mock("../src/calendar-fetch.js", () => ({ fetchCalendar: vi.fn() }));

it("订阅拉取按 15 分钟刷新，保留人工修改与删除，失败不清空已导入日程", async () => {
  const ws = await freshWorkspace();
  let calls = 0;
  let fail = false;
  const now = new Date();
  const day = now.toISOString().slice(0, 10).replaceAll("-", "");
  vi.mocked(fetchCalendar).mockImplementation(async () => {
    calls++;
    if (fail) throw new Error("synthetic unavailable");
    return Buffer.from(
      `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${["a", "b", "c"].map((id) => `BEGIN:VEVENT\r\nUID:${id}\r\nDTSTART:${day}T090000Z\r\nDTEND:${day}T100000Z\r\nSUMMARY:${id}-${calls}\r\nEND:VEVENT\r\n`).join("")}END:VCALENDAR\r\n`,
    );
  });
  try {
    await addCalendarSubscription(ws, "https://calendar.example/calendar.ics", "合成日历");
    const rows = readRecords(ws, "event");
    expect(rows).toHaveLength(3);
    updateRecord(ws, "event", rows[0]?.id as string, { title: "人工标题" }, { by: "user" });
    deleteRecord(ws, "event", rows[1]?.id as string, { by: "user" });
    await pullCalendarSubscriptions(ws, new Date(+now + 60000));
    expect(calls).toBe(1);
    await pullCalendarSubscriptions(ws, new Date(+now + 16 * 60000));
    expect(calls).toBe(2);
    expect(readRecords(ws, "event").map((row) => [row.id, row.title])).toEqual([
      [rows[0]?.id as string, "人工标题"],
      [rows[2]?.id as string, "c-2"],
    ]);
    fail = true;
    await pullCalendarSubscriptions(ws, new Date(+now + 32 * 60000));
    expect(readCalendar(ws).subscriptions[0]?.error).toBeTruthy();
    expect(readRecords(ws, "event")).toHaveLength(2);
  } finally {
    vi.mocked(fetchCalendar).mockReset();
  }
});

it("日历页和今天页读同一份补齐后的计划：取消的不显示，斜杠日期和「7点」照常显示", async () => {
  const ws = await freshWorkspace("Asia/Shanghai");
  ws.writeText(
    "NOW.md",
    '---\ndate: "2026/10/17"\nblocks:\n  - { title: 晨跑, start: 7点, end: 8点 }\n  - { title: 取消的会, start: "10:00", end: "11:00", status: 取消 }\n---\n',
  );
  const calendar = readCalendar(ws, new Date("2026-10-17T03:00:00Z"));
  expect(calendar.planDate).toBe("2026-10-17");
  expect(calendar.events.map((event) => [event.title, event.start])).toEqual([["晨跑", "2026-10-17T07:00"]]);
});
