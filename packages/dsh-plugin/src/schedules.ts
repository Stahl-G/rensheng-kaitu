import { randomUUID } from "node:crypto";
import type {
  ScheduleCatalogEntry,
  ScheduleCreateRequest,
  ScheduleEditRequest,
  ScheduleEditResult,
  SchedulePatch,
  ScheduleTiming,
} from "@deepseek-ai/dsh-schedule/client";
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
type ScheduleTask = ScheduleCatalogEntry;
function savedInput(task: ScheduleTask): ScheduleInput | undefined {
  const base = { title: task.title, prompt: task.prompt };
  switch (task.kind) {
    case "daily":
      return { ...base, daily: { time: task.time, time_zone: task.timeZone } };
    case "weekly":
      return { ...base, weekly: { time: task.time, time_zone: task.timeZone, weekdays: [...task.weekdays] } };
    case "cron":
      return { ...base, cron: { expression: task.expression, time_zone: task.timeZone } };
    case "every":
      return { ...base, every_seconds: task.everySeconds };
    case "at":
    case "after":
      return { ...base, at: task.scheduledAt };
    // RC1 rules stay in the Host, including rules the legacy receipt cannot represent.
    case "rrule":
      return undefined;
  }
}
function timing(input: ScheduleInput): ScheduleTiming {
  if (input.daily) return { kind: "daily", daily: input.daily };
  if (input.weekly) return { kind: "weekly", weekly: input.weekly };
  if (input.cron) return { kind: "cron", cron: input.cron };
  if (input.every_seconds !== undefined) return { kind: "every", every_seconds: input.every_seconds };
  if (input.at) return { kind: "at", at: input.at };
  throw new Error("自动任务周期不完整");
}
function target(sessionId: string): ScheduleCreateRequest["target"] {
  return {
    kind: "session",
    sessionId: sessionId as Extract<ScheduleTask["target"], { kind: "session" }>["sessionId"],
  };
}
function owned(tasks: ScheduleTask[], sessionId: string, id: string | undefined) {
  return tasks.find(
    (task) => task.id === id && task.target.kind === "session" && task.target.sessionId === sessionId,
  );
}
function changeTime(
  input: ScheduleInput | undefined,
  time: string,
): Extract<ScheduleTiming, { kind: "daily" | "weekly" }> {
  if (input?.daily) return { kind: "daily", daily: { ...input.daily, time: `${time}:00` } };
  if (input?.weekly) return { kind: "weekly", weekly: { ...input.weekly, time: `${time}:00` } };
  throw new Error("这个自动任务使用自定义周期，请在 DSH 中调整时间");
}
async function edit(ctx: ScheduleContext, task: ScheduleTask, patch: SchedulePatch) {
  const result = await ctx.schedule.edit({
    id: task.id,
    action: "update",
    patch,
    expectedUpdatedAt: task.updatedAt ?? null,
  });
  if ("code" in result || "deleted" in result) throw new Error("自动任务已更改，请重试");
  return result;
}
async function prepareSession(ctx: ScheduleContext, sessionId: string, cwd: string) {
  let resolved = await ctx.sessionController.resolveAgent(sessionId);
  if ("error" in resolved) {
    const error = resolved.error;
    if (
      typeof error !== "object" ||
      error === null ||
      !("code" in error) ||
      error.code !== "session/not-found"
    )
      throw error;
    const created = await ctx.sessionController.create({ sessionId, cwd, agentPreset: "standard" });
    if (created.sessionId !== sessionId) throw new Error("自动整理会话已更改，请重试");
    resolved = await ctx.sessionController.resolveAgent(sessionId);
  }
  if ("error" in resolved) throw resolved.error;
  if (resolved.agent.session.header.cwd !== cwd)
    throw new Error("自动整理会话属于其他目录，请先完成原位置迁移");
  if (!(await ctx.sessions.flush(resolved.agent.session))) throw new Error("自动整理会话未获得持久化回执");
}
export interface ScheduleContext {
  schedule: {
    catalog(): Promise<ScheduleCatalogEntry[]>;
    create(input: ScheduleCreateRequest): Promise<ScheduleCatalogEntry>;
    edit(input: ScheduleEditRequest): Promise<ScheduleEditResult>;
  };
  sessionController: {
    create(input: { sessionId: string; cwd: string; agentPreset: string }): Promise<{ sessionId: string }>;
    resolveAgent(
      id: string,
    ): Promise<{ agent: { session: { header: { cwd?: string } } } } | { error: unknown }>;
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
  let ready = false;
  if (!setup.root && !setup.relocation && Object.keys(setup.tasks).length) {
    await prepareSession(ctx, setup.sessionId, ws.root);
    ready = true;
  }
  let current = await ctx.schedule.catalog();
  if (setup.relocation || (setup.root && setup.root !== ws.root)) {
    setup.relocation ??= {
      sessionId: `session-${randomUUID()}`,
      oldSession: setup.sessionId,
      oldTasks: { ...setup.tasks },
      inputs: {},
    };
    ws.writeJson(file, setup, { internal: true });
    const move = setup.relocation;
    await prepareSession(ctx, move.sessionId, ws.root);
    for (const task of defaultSchedules) {
      const prior = owned(current, move.oldSession, move.oldTasks[task.key]);
      let moved =
        owned(current, move.sessionId, setup.tasks[task.key]) ??
        owned(current, move.sessionId, move.oldTasks[task.key]);
      if (!moved && prior) moved = await edit(ctx, prior, { target: target(move.sessionId) });
      // Resume a receipt written by the former copy/delete relocation implementation.
      if (
        !moved &&
        !current.some((row) => row.id === move.oldTasks[task.key] || row.id === setup.tasks[task.key])
      ) {
        const input = move.inputs[task.key];
        if (input)
          moved = await ctx.schedule.create({
            title: input.title,
            prompt: input.prompt,
            timing: timing(input),
            target: target(move.sessionId),
          });
      }
      if (!moved) continue;
      setup.tasks[task.key] = moved.id;
      ws.writeJson(file, setup, { internal: true });
      if (prior && prior.id !== moved.id) {
        const removed = await ctx.schedule.edit({
          id: prior.id,
          action: "delete",
          expectedUpdatedAt: prior.updatedAt ?? null,
        });
        if ("code" in removed && removed.code !== "schedule_not_found")
          throw new Error("自动任务已更改，请重试");
      }
    }
    setup.sessionId = move.sessionId;
    setup.root = ws.root;
    setup.relocation = undefined;
    ws.writeJson(file, setup, { internal: true });
    current = await ctx.schedule.catalog();
    ready = true;
  }
  setup.root = ws.root;
  for (const task of defaultSchedules) {
    const key = task.key;
    const previous = setup.applied[key] ?? (setup.tasks[key] ? true : undefined);
    const timeChanged = requested[key] !== undefined && requested[key] !== setup.appliedTimes[key];
    const existing = owned(current, setup.sessionId, setup.tasks[key]);
    if (previous !== settings.tasks[key] || timeChanged) {
      const input = existing
        ? savedInput(existing)
        : (setup.saved?.[key] ?? {
            title: task.title,
            prompt: task.prompt,
            daily: { time: task.time, time_zone: ws.timeZone() },
          });
      const changedTiming =
        timeChanged && requested[key] && (settings.tasks[key] || input?.daily || input?.weekly)
          ? changeTime(input, requested[key])
          : undefined;
      if (settings.tasks[key] && !ready) {
        await prepareSession(ctx, setup.sessionId, ws.root);
        ready = true;
      }
      if (existing) {
        if (!settings.tasks[key]) {
          setup.saved ??= {};
          setup.saved[key] = input;
          ws.writeJson(file, setup, { internal: true });
        }
        // Pause rather than recreate: keep native rules, IDs, history and interval anchors.
        const active = !settings.tasks[key] ? false : previous === false ? true : undefined;
        const updated = await edit(ctx, existing, {
          ...(active === undefined ? {} : { active }),
          ...(changedTiming ? { timing: changedTiming } : {}),
        });
        if (!settings.tasks[key] && setup.saved) setup.saved[key] = savedInput(updated);
      } else if (settings.tasks[key] && input) {
        setup.saved ??= {};
        setup.saved[key] = input;
        ws.writeJson(file, setup, { internal: true });
        const result = await ctx.schedule.create({
          title: input.title,
          prompt: input.prompt,
          timing: changedTiming ?? timing(input),
          target: target(setup.sessionId),
        });
        setup.tasks[key] = result.id;
      } else if (changedTiming && input) {
        // Old versions removed disabled tasks and retained their legacy input here.
        setup.observedTimes[key] = requested[key];
        setup.saved ??= {};
        setup.saved[key] = {
          ...input,
          ...(changedTiming.kind === "daily"
            ? { daily: changedTiming.daily }
            : { weekly: changedTiming.weekly }),
        };
      }
      setup.applied[key] = settings.tasks[key];
      if (requested[key]) setup.appliedTimes[key] = requested[key];
      ws.writeJson(file, setup, { internal: true });
      current = await ctx.schedule.catalog();
    }
    const actual = owned(current, setup.sessionId, setup.tasks[key]);
    if (actual && "time" in actual) setup.observedTimes[key] = actual.time.slice(0, 5);
  }
  if (JSON.stringify(setup) !== before) ws.writeJson(file, setup, { internal: true });
}
