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

it("日历页和今天页读同一份补齐 id 的计划：跳过的不显示", async () => {
  const ws = await freshWorkspace("Asia/Shanghai");
  ws.writeText(
    "NOW.md",
    '---\ndate: "2026-10-17"\nblocks:\n  - { title: 晨跑, start: "07:00", end: "08:00" }\n  - { title: 取消的会, start: "10:00", end: "11:00", status: skipped }\n---\n',
  );
  const calendar = readCalendar(ws, new Date("2026-10-17T03:00:00Z"));
  expect(calendar.planDate).toBe("2026-10-17");
  expect(calendar.events.map((event) => [event.title, event.start])).toEqual([["晨跑", "2026-10-17T07:00"]]);
});

it("订阅联网不占写队列，应用结果保留等待期间新建的订阅", async () => {
  const ws = await freshWorkspace();
  const empty = Buffer.from("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n");
  vi.mocked(fetchCalendar).mockResolvedValue(empty);
  let finish!: (bytes: Uint8Array) => void;
  let pending: Promise<unknown> = Promise.resolve();
  const write = vi.fn(<T>(run: () => Promise<T>) => {
    const result = pending.then(run);
    pending = result.catch(() => {});
    return result;
  });
  try {
    await addCalendarSubscription(ws, "https://calendar.example/first.ics", "合成一");
    vi.mocked(fetchCalendar).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pulling = pullCalendarSubscriptions(ws, new Date(Date.now() + 16 * 60000), write);
    // fetch 仍未结束，队列可执行其他写入。
    expect(write).not.toHaveBeenCalled();
    await write(async () => ws.writeText("inbox/notes/synthetic.md", "合成原文"));
    await addCalendarSubscription(ws, "https://calendar.example/second.ics", "合成二", write);
    finish(empty);
    await pulling;
    expect(readCalendar(ws).subscriptions.map((row) => row.name)).toEqual(["合成一", "合成二"]);
    expect(readCalendar(ws).subscriptions.every((row) => row.error === null && row.syncedAt)).toBe(true);
    expect(ws.readText("inbox/notes/synthetic.md")).toBe("合成原文");
  } finally {
    finish?.(empty);
    vi.mocked(fetchCalendar).mockReset();
  }
});
