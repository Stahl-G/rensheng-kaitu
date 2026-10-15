import { rmSync } from "node:fs";
import { expect, it } from "vitest";
import {
  Workspace,
  addTask,
  cancelTask,
  completeTask,
  history,
  listTasks,
  readStatus,
  readWorkbench,
  refreshOverview,
  validateWorkspace,
} from "../src/index.js";
import { freshWorkspace } from "./helpers.js";

it("待办按本地创建月存储，跨午夜查询到期和提醒，状态追加修订与版本", async () => {
  const ws = await freshWorkspace("Asia/Shanghai");
  try {
    // 模拟已发布工作区：打开时仅补缺少的内置 task 定义，保留原模块配置。
    const module = ws.readJson<{ records?: unknown; description: string }>("me/module.json");
    module.records = undefined;
    module.description = "自定义说明";
    ws.writeJson("me/module.json", module);
    new Workspace(ws.root);
    expect(ws.readJson<typeof module>("me/module.json").description).toBe("自定义说明");
    const before = await history(ws);
    const now = new Date("2026-10-14T16:30:00Z");
    const today = await addTask(
      ws,
      {
        title: "礼物",
        due: "2026-10-15",
        remind_at: "2026-10-14T17:00:00Z",
      },
      { now: new Date("2026-09-30T16:30:00Z") },
    );
    const overdue = await addTask(ws, { title: "旧待办", due: "2026-10-14" }, { now });
    const reminder = await addTask(
      ws,
      {
        title: "明天的事",
        due: "2026-10-15T18:00:00Z",
        remind_at: "2026-10-14T16:10:00Z",
      },
      { now },
    );
    expect(today.file).toBe("me/data/tasks/2026-10.jsonl");
    expect(listTasks(ws, { dueBefore: "2026-10-15" }).map((t) => t.id)).toEqual([
      today.record.id,
      overdue.record.id,
    ]);
    expect(listTasks(ws, { dueBefore: now.toISOString() }).map((t) => t.id)).toEqual([overdue.record.id]);
    const tasks = readStatus(ws, now).tasks;
    expect(tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: today.record.id, dueToday: true, overdue: false, remindToday: true }),
        expect.objectContaining({
          id: overdue.record.id,
          dueToday: false,
          overdue: true,
          remindToday: false,
        }),
        expect.objectContaining({
          id: reminder.record.id,
          dueToday: false,
          overdue: false,
          remindToday: true,
        }),
      ]),
    );
    expect(readWorkbench(ws, now).tasks).toEqual(tasks);
    const beforeMidnight = readStatus(ws, new Date("2026-10-14T15:30:00Z")).tasks;
    expect(beforeMidnight.map((t) => t.id)).toEqual([overdue.record.id]);
    expect(beforeMidnight[0]).toMatchObject({ dueToday: true, overdue: false });
    const done = await completeTask(ws, today.record.id, { now: new Date("2026-11-01T00:00:00Z") });
    expect(done.file).toBe(today.file);
    expect(done.record).toMatchObject({ ts: today.record.ts, rev: 2, status: "done" });
    expect(listTasks(ws).map((t) => t.id)).not.toContain(today.record.id);
    expect(listTasks(ws, { status: "done" }).map((t) => t.id)).toEqual([today.record.id]);
    expect(
      ws
        .readText(today.file)
        .trim()
        .split("\n")
        .map((s) => JSON.parse(s))
        .filter((r) => r.id === today.record.id),
    ).toEqual([today.record, done.record]);
    const cancelled = await cancelTask(ws, overdue.record.id);
    expect(cancelled.record).toMatchObject({ rev: 2, status: "cancelled" });
    expect(listTasks(ws).map((t) => t.id)).toEqual([reminder.record.id]);
    expect(listTasks(ws, { status: "all" })).toHaveLength(3);
    expect(await history(ws)).toHaveLength(before.length + 5);
    expect([today, overdue, reminder, done, cancelled].every((r) => r.version)).toBe(true);
    refreshOverview(ws, now);
    expect(readStatus(ws, now).tasks.map((t) => t.id)).toEqual([reminder.record.id]);
    expect(validateWorkspace(ws)).toEqual([]);
  } finally {
    rmSync(ws.root, { recursive: true, force: true });
  }
});
