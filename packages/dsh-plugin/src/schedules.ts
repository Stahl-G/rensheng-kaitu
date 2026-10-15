import { randomUUID } from "node:crypto";
import type { Workspace } from "@kaitu/core";

// rc.2 schedule/src/{index,types}.ts and api/session-controller/src/{index,types}.ts.
interface ScheduleContext {
  schedule: {
    list(input: { sessionId: string }): Promise<{ id: string; title: string }[]>;
    create(
      sessionId: string,
      input: { title: string; prompt: string; daily: { time: string; time_zone: string } },
    ): Promise<{ id: string }>;
  };
  sessionController: {
    create(input: { sessionId: string; cwd: string; agentPreset: string }): Promise<{ sessionId: string }>;
    resolveAgent(id: string): Promise<{ agent: { session: unknown } } | { error: unknown }>;
  };
  sessions: { flush(session: unknown): Promise<boolean> };
}
interface Setup {
  sessionId: string;
  tasks: Record<string, string>;
}

/** 只在首次安装创建默认任务。保存回执，不在重启时重建用户已删除或修改的任务。 */
export async function setupSchedules(ctx: ScheduleContext, ws: Workspace): Promise<void> {
  const file = ".kaitu/dsh-setup.json";
  const setup: Setup = ws.exists(file)
    ? ws.readJson(file)
    : { sessionId: `session-${randomUUID()}`, tasks: {} };
  if (setup.tasks.morning && setup.tasks.organizer) return;
  ws.writeJson(file, setup, { internal: true });
  await ctx.sessionController.create({ sessionId: setup.sessionId, cwd: ws.root, agentPreset: "standard" });
  const resolved = await ctx.sessionController.resolveAgent(setup.sessionId);
  if ("error" in resolved) throw resolved.error;
  if (!(await ctx.sessions.flush(resolved.agent.session))) throw new Error("自动整理会话未获得持久化回执");
  const current = await ctx.schedule.list({ sessionId: setup.sessionId });
  for (const task of [
    {
      key: "morning",
      title: "开图早间计划",
      time: "07:30:00",
      prompt:
        "使用 morning-plan 技能，为今天生成计划并保存到开图 NOW.md。读取最新规则与状态，建议保持待确认。",
    },
    {
      key: "organizer",
      title: "开图每日整理",
      time: "03:00:00",
      prompt:
        "读取并执行开图 ORGANIZER.md。先检查今天是否已有每日整理，有则结束。只整理已发生的交接，不猜测完成情况。",
    },
  ]) {
    if (setup.tasks[task.key]) continue;
    const existing = current.find((row) => row.title === task.title);
    const result =
      existing ??
      (await ctx.schedule.create(setup.sessionId, {
        title: task.title,
        prompt: task.prompt,
        daily: { time: task.time, time_zone: ws.timeZone() },
      }));
    setup.tasks[task.key] = result.id;
    ws.writeJson(file, setup, { internal: true });
  }
}
