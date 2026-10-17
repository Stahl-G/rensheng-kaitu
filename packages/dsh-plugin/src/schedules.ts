import { randomUUID } from "node:crypto";
import { type AutomationKey, type Workspace, configuredAutomationTimes, readAutomation } from "@kaitu/core";

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

// 0.2.1-rc.2 dsh-schedule and dsh-api-session-controller: lib/types/index.d.ts.
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
  root?: string;
  relocation?: {
    sessionId: string;
    oldSession: string;
    oldTasks: Record<string, string>;
    inputs: Partial<Record<AutomationKey, ScheduleInput>>;
  };
  sessionId: string;
  tasks: Record<string, string>;
  applied?: Partial<Record<AutomationKey, boolean>>;
  appliedTimes?: Partial<Record<AutomationKey, string>>;
  observedTimes?: Partial<Record<AutomationKey, string>>;
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
      "读取并执行开图 ORGANIZER.md。先检查今天是否已有每日整理，有则结束。只整理已发生的交接和已保存的原文，不猜测完成情况。" +
      "整理后可用 exploration_read 检查最近七天是否已有 AI 方向建议（含已拒绝的），有则不再提。没有时，结合档案、目标、项目、足迹、资讯反馈，" +
      "只用主题词联网搜索，不能发送个人资料原文。通过 exploration_write 提议一批 3–5 个不同方向，自动保持 suggested，不能采纳。" +
      "motivation 引用个人资料、外部来源及日期，references 附资料路径与链接，unknowns 写未知，hypothesis 附一周内低成本小实验。避开已有与不感兴趣的方向；搜索不可用则跳过。",
  },
  {
    key: "news",
    title: "开图资讯搜索",
    time: "08:00:00",
    prompt:
      "按开图 feed/COLLECT.md 的采集规则，围绕 feed/feeds.json 中用户已确认的 keywords 搜索近期资讯，结合目标和项目判断关联；没有关注方向时请用户先设置。保留原始来源与发布时间，按链接去重，只投递有实际关联的新资料。结束前留交接记录，没有新结果也写一句。",
  },
] as const;

export async function setupSchedules(
  ctx: ScheduleContext,
  ws: Workspace,
  legacyEnabled = false,
): Promise<void> {
  const file = ".kaitu/dsh-setup.json";
  const settings = readAutomation(ws);
  if (!settings.asked && !legacyEnabled) return;
  const requested = configuredAutomationTimes(ws);
  const setup: Setup = ws.exists(file)
    ? ws.readJson(file)
    : { sessionId: `session-${randomUUID()}`, tasks: {} };
  setup.applied ??= {};
  setup.appliedTimes ??= {};
  setup.observedTimes ??= {};
  const before = JSON.stringify(setup);
  let current = Object.keys(setup.tasks).length
    ? await ctx.schedule.list({ sessionId: setup.sessionId })
    : [];
  if (setup.root && setup.root !== ws.root) {
    setup.relocation ??= {
      sessionId: `session-${randomUUID()}`,
      oldSession: setup.sessionId,
      oldTasks: { ...setup.tasks },
      inputs: {},
    };
    ws.writeJson(file, setup, { internal: true });
    const move = setup.relocation;
    await ctx.sessionController.create({ sessionId: move.sessionId, cwd: ws.root, agentPreset: "standard" });
    const resolved = await ctx.sessionController.resolveAgent(move.sessionId);
    if ("error" in resolved) throw resolved.error;
    if (!(await ctx.sessions.flush(resolved.agent.session)))
      throw new Error("新位置的自动整理会话未获得保存回执");
    const oldTasks = await ctx.schedule.list({ sessionId: move.oldSession });
    for (const task of defaultSchedules) {
      const prior = oldTasks.find((row) => row.id === move.oldTasks[task.key]);
      if (prior && !move.inputs[task.key]) {
        move.inputs[task.key] = savedInput(prior);
        ws.writeJson(file, setup, { internal: true });
      }
      const input = move.inputs[task.key];
      if (!input) continue;
      const existing = (await ctx.schedule.list({ sessionId: move.sessionId })).find(
        (row) => row.title === input.title,
      );
      const moved = existing ?? (await ctx.schedule.create(move.sessionId, input));
      setup.tasks[task.key] = moved.id;
      ws.writeJson(file, setup, { internal: true });
      if (prior) await ctx.schedule.delete({ sessionId: move.oldSession, id: prior.id });
    }
    setup.sessionId = move.sessionId;
    setup.root = ws.root;
    setup.relocation = undefined;
    ws.writeJson(file, setup, { internal: true });
    current = await ctx.schedule.list({ sessionId: setup.sessionId });
  }
  setup.root = ws.root;
  let ready = false;
  for (const task of defaultSchedules) {
    const key = task.key;
    const previous = setup.applied[key] ?? (setup.tasks[key] ? true : undefined);
    const timeChanged = requested[key] !== undefined && requested[key] !== setup.appliedTimes[key];
    const existing = current.find((row) => row.id === setup.tasks[key]);
    if (previous !== settings.tasks[key] || timeChanged) {
      if (!settings.tasks[key]) {
        if (existing) {
          setup.saved ??= {};
          setup.saved[key] = savedInput(existing);
          ws.writeJson(file, setup, { internal: true });
          await ctx.schedule.delete({ sessionId: setup.sessionId, id: existing.id });
        }
        if (timeChanged) {
          setup.observedTimes[key] = requested[key];
          const saved = setup.saved?.[key];
          if (saved?.daily) saved.daily.time = `${requested[key]}:00`;
          if (saved?.weekly) saved.weekly.time = `${requested[key]}:00`;
        }
      } else {
        if (!ready) {
          await ctx.sessionController.create({
            sessionId: setup.sessionId,
            cwd: ws.root,
            agentPreset: "standard",
          });
          const resolved = await ctx.sessionController.resolveAgent(setup.sessionId);
          if ("error" in resolved) throw resolved.error;
          if (!(await ctx.sessions.flush(resolved.agent.session)))
            throw new Error("自动整理会话未获得持久化回执");
          ready = true;
        }
        const prior = existing ?? current.find((row) => row.title === task.title);
        const input = prior
          ? savedInput(prior)
          : (setup.saved?.[key] ?? {
              title: task.title,
              prompt: task.prompt,
              daily: { time: task.time, time_zone: ws.timeZone() },
            });
        if (timeChanged && requested[key]) {
          const time = `${requested[key]}:00`;
          if (input.daily) input.daily.time = time;
          else if (input.weekly) input.weekly.time = time;
          else if (timeChanged) throw new Error("这个自动任务使用自定义周期，请在 DSH 中调整时间");
        }
        let result = prior;
        if (!prior || timeChanged) {
          setup.saved ??= {};
          setup.saved[key] = input;
          ws.writeJson(file, setup, { internal: true });
          if (prior) await ctx.schedule.delete({ sessionId: setup.sessionId, id: prior.id });
          result = (await ctx.schedule.create(setup.sessionId, input)) as ScheduleTask;
        }
        if (result) setup.tasks[key] = result.id;
      }
      setup.applied[key] = settings.tasks[key];
      if (requested[key]) setup.appliedTimes[key] = requested[key];
      ws.writeJson(file, setup, { internal: true });
      current = await ctx.schedule.list({ sessionId: setup.sessionId });
    }
    const actual = current.find((row) => row.id === setup.tasks[key]);
    if (actual?.time) setup.observedTimes[key] = actual.time.slice(0, 5);
  }
  if (JSON.stringify(setup) !== before) ws.writeJson(file, setup, { internal: true });
}
