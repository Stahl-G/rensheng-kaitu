import { randomUUID } from "node:crypto";
import { type AutomationKey, type Workspace, readAutomation } from "@kaitu/core";

interface ScheduleInput {
  title: string;
  prompt: string;
  daily?: { time: string; time_zone: string };
  weekly?: { time: string; time_zone: string; weekdays: number[] };
  cron?: { expression: string; time_zone: string };
  every_seconds?: number;
  at?: string;
}
interface ScheduleTask {
  id: string;
  title: string;
  prompt: string;
  kind: "daily" | "weekly" | "cron" | "every" | "at" | "after";
  time: string;
  timeZone: string;
  weekdays: number[];
  expression: string;
  everySeconds: number;
  scheduledAt: string;
}
function savedInput(task: ScheduleTask): ScheduleInput {
  const base = { title: task.title, prompt: task.prompt };
  switch (task.kind) {
    case "daily":
      return { ...base, daily: { time: task.time, time_zone: task.timeZone } };
    case "weekly":
      return { ...base, weekly: { time: task.time, time_zone: task.timeZone, weekdays: task.weekdays } };
    case "cron":
      return { ...base, cron: { expression: task.expression, time_zone: task.timeZone } };
    case "every":
      return { ...base, every_seconds: task.everySeconds };
    case "at":
    case "after":
      return { ...base, at: task.scheduledAt };
  }
}

// rc.2 schedule/src/index.ts and api/session-controller/src/index.ts.
export interface ScheduleContext {
  schedule: {
    list(input: { sessionId: string }): Promise<ScheduleTask[]>;
    delete(input: { sessionId: string; id: string }): Promise<unknown>;
    create(sessionId: string, input: ScheduleInput): Promise<{ id: string }>;
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
  applied?: Partial<Record<AutomationKey, boolean>>;
  saved?: Partial<Record<AutomationKey, ScheduleInput>>;
}
export const defaultSchedules = [
  {
    key: "morning",
    title: "开图早间计划",
    time: "07:30:00",
    prompt: "使用 morning-plan 技能，为今天生成计划并保存到开图 NOW.md。读取最新规则与状态，建议保持待确认。",
  },
  {
    key: "organizer",
    title: "开图每日整理",
    time: "03:00:00",
    prompt:
      "读取并执行开图 ORGANIZER.md。先检查今天是否已有每日整理，有则结束。只整理已发生的交接，不猜测完成情况。",
  },
  {
    key: "news",
    title: "开图资讯搜索",
    time: "08:00:00",
    prompt:
      "使用 collect-news 技能，按用户关注、目标和正在推进的项目搜索近期资讯。保留原始来源与发布时间，按链接去重。只投递有实际关联的新资料，没有新结果就不生成报告。",
  },
] as const;

/** 已有回执不重建；只有明确的开关变化才删除或重启任务，保留用户改过的时间与内容。 */
export async function setupSchedules(
  ctx: ScheduleContext,
  ws: Workspace,
  legacyEnabled = false,
): Promise<void> {
  const file = ".kaitu/dsh-setup.json";
  const settings = readAutomation(ws);
  if (!settings.asked && !legacyEnabled) return;
  const setup: Setup = ws.exists(file)
    ? ws.readJson(file)
    : { sessionId: `session-${randomUUID()}`, tasks: {} };
  setup.applied ??= {};
  const changes = defaultSchedules.filter(({ key }) => {
    const previous = setup.applied?.[key] ?? (setup.tasks[key] ? true : undefined);
    return previous !== settings.tasks[key];
  });
  if (!changes.length) return;
  ws.writeJson(file, setup, { internal: true });
  let current: ScheduleTask[] | undefined;
  for (const task of changes) {
    if (!settings.tasks[task.key]) {
      const id = setup.tasks[task.key];
      if (id) {
        const record = (await ctx.schedule.list({ sessionId: setup.sessionId })).find((row) => row.id === id);
        if (record) {
          setup.saved ??= {};
          setup.saved[task.key] = savedInput(record);
          ws.writeJson(file, setup, { internal: true });
        }
        await ctx.schedule.delete({ sessionId: setup.sessionId, id });
      }
    } else {
      if (!current) {
        await ctx.sessionController.create({
          sessionId: setup.sessionId,
          cwd: ws.root,
          agentPreset: "standard",
        });
        const resolved = await ctx.sessionController.resolveAgent(setup.sessionId);
        if ("error" in resolved) throw resolved.error;
        if (!(await ctx.sessions.flush(resolved.agent.session)))
          throw new Error("自动整理会话未获得持久化回执");
        current = await ctx.schedule.list({ sessionId: setup.sessionId });
      }
      const existing = current.find((row) => row.title === task.title);
      const result =
        existing ??
        (await ctx.schedule.create(
          setup.sessionId,
          setup.saved?.[task.key] ?? {
            title: task.title,
            prompt: task.prompt,
            daily: { time: task.time, time_zone: ws.timeZone() },
          },
        ));
      setup.tasks[task.key] = result.id;
    }
    setup.applied[task.key] = settings.tasks[task.key];
    ws.writeJson(file, setup, { internal: true });
  }
}
