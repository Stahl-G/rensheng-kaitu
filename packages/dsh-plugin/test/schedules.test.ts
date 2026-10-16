import { rmSync } from "node:fs";
import { configureAutomation, readAutomation } from "@kaitu/core";
import { expect, it } from "vitest";
import { freshWorkspace } from "../../core/test/helpers.js";
import { type ScheduleContext, setupSchedules } from "../src/schedules.js";

it("首次确认后建立三个任务，开关可恢复，重启保留已修改和手动删除的旧任务", async () => {
  const ws = await freshWorkspace();
  const tasks = new Map<string, Awaited<ReturnType<ScheduleContext["schedule"]["list"]>>[number]>();
  let sequence = 0;
  const ctx: ScheduleContext = {
    schedule: {
      list: async () => [...tasks.values()],
      create: async (_session, input) => {
        if (!input.daily) throw new Error("Expected a daily schedule");
        const record = {
          id: `task-${++sequence}`,
          title: input.title,
          prompt: input.prompt,
          kind: "daily" as const,
          time: input.daily.time,
          timeZone: input.daily.time_zone,
          weekdays: [],
          expression: "",
          everySeconds: 0,
          scheduledAt: "",
        };
        tasks.set(record.id, record);
        return record;
      },
      delete: async ({ id }) => tasks.delete(id),
    },
    sessionController: {
      create: async (input) => input,
      resolveAgent: async () => ({ agent: { session: {} } }),
    },
    sessions: { flush: async () => true },
  };
  try {
    await setupSchedules(ctx, ws);
    expect(tasks.size).toBe(0);
    expect(readAutomation(ws).asked).toBe(false);
    configureAutomation(ws, { morning: true, organizer: true, news: true });
    await setupSchedules(ctx, ws);
    expect(tasks.size).toBe(3);
    const morning = [...tasks.values()].find((task) => task.title === "开图早间计划");
    const organizer = [...tasks.values()].find((task) => task.title === "开图每日整理");
    if (!morning || !organizer) throw new Error("Missing scheduled tasks");
    morning.time = "09:15:00";
    tasks.delete(organizer.id);
    await setupSchedules(ctx, ws);
    expect(tasks.size).toBe(2);
    expect(tasks.get(morning.id)?.time).toBe("09:15:00");
    configureAutomation(ws, { morning: false });
    await setupSchedules(ctx, ws);
    expect(tasks.has(morning.id)).toBe(false);
    configureAutomation(ws, { morning: true });
    await setupSchedules(ctx, ws);
    expect([...tasks.values()].filter((task) => task.title === morning.title)).toHaveLength(1);
    expect(tasks.size).toBe(2);
    expect([...tasks.values()].find((task) => task.title === morning.title)?.time).toBe("09:15:00");
    // 已发布的旧回执没有 applied；资讯搜索默认关，不新增，也不补回被用户删掉的整理任务。
    rmSync(ws.resolve(".kaitu/automation.json", { internal: true }));
    ws.writeJson(
      ".kaitu/dsh-setup.json",
      {
        sessionId: "legacy-session",
        tasks: { morning: morning.id, organizer: organizer.id },
      },
      { internal: true },
    );
    tasks.clear();
    tasks.set(morning.id, morning);
    await setupSchedules(ctx, ws);
    await setupSchedules(ctx, ws);
    expect(readAutomation(ws).asked).toBe(true);
    expect(tasks.get(morning.id)?.time).toBe("09:15:00");
    expect([...tasks.values()].map((task) => task.title).sort()).toEqual(["开图早间计划"]);
  } finally {
    rmSync(ws.root, { recursive: true, force: true });
  }
});
