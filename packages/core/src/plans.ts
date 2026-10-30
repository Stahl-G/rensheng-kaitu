import { createHash } from "node:crypto";
import { KaituError } from "./errors.js";
import { schemas } from "./schema.js";
import type { Task } from "./tasks.js";
import type { Goal, WorkbenchData } from "./workbench.js";
import type { Workspace } from "./workspace.js";

/** 目标来源写在 id 里：`<来源>-<YYYYMMDD>-<6 位摘要>`。只用 goals.json 既有字段。 */
export const goalOrigins = [
  "chatgpt",
  "claude",
  "gemini",
  "doubao",
  "other",
  "note",
  "conversation",
] as const;
export type GoalOrigin = (typeof goalOrigins)[number];
const originPattern = new RegExp(
  `^(${goalOrigins.join("|")})-(\\d{4})(\\d{2})(\\d{2})-[a-f0-9]{6}(?:-\\d+)?$`,
);

export function goalOrigin(id: string): { source: GoalOrigin; date: string } | null {
  const match = originPattern.exec(id);
  if (!match) return null;
  return { source: match[1] as GoalOrigin, date: `${match[2]}-${match[3]}-${match[4]}` };
}

const sameTitle = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const isOpenGoal = (goal: Goal) => !goal.status || goal.status === "active" || goal.status === "paused";

/** 采纳或搬来时登记目标；同名的进行中目标直接复用。调用方负责存版本。 */
export function upsertGoal(
  ws: Workspace,
  title: string,
  origin: GoalOrigin,
  date: string,
): { id: string; created: boolean } {
  const text = title.trim();
  if (!text || /[\r\n]/.test(text)) throw new KaituError("目标需要一行文字", "BAD_ARGS");
  const goals = ws.exists("me/goals.json") ? ws.readJson<Goal[]>("me/goals.json") : [];
  const existing = goals.find((goal) => isOpenGoal(goal) && sameTitle(goal.title, text));
  if (existing) return { id: existing.id, created: false };
  const base = `${origin}-${date.replaceAll("-", "")}-${createHash("sha256").update(text).digest("hex").slice(0, 6)}`;
  let id = base;
  for (let n = 2; goals.some((goal) => goal.id === id); n++) id = `${base}-${n}`;
  const next = [...goals, { id, title: text, status: "active" }];
  if (!schemas().builtin("goals.schema.json")(next))
    throw new KaituError("目标格式不合法", "INVALID_DOCUMENT");
  ws.writeJson("me/goals.json", next);
  return { id, created: true };
}

export function noteLine(notes: string, label: string): string {
  return (
    notes
      .split("\n")
      .find((line) => line.startsWith(`${label}：`))
      ?.slice(label.length + 1) ?? ""
  );
}

/** 下一步属于哪个目标：备注里的目标编号优先，旧记录按目标原文对应。 */
function goalRef(task: Task): { id: string } | { title: string } | null {
  const notes = task.notes ?? "";
  const id = noteLine(notes, "目标编号") || /^me\/goals\.json#([a-z0-9-]+)$/.exec(task.source ?? "")?.[1];
  if (id) return { id };
  const title = noteLine(notes, "当前目标");
  return title ? { title } : null;
}

export function taskGoal(task: Task, goals: Goal[]): Goal | undefined {
  const ref = goalRef(task);
  if (!ref) return undefined;
  return "id" in ref
    ? goals.find((goal) => goal.id === ref.id)
    : goals.find((goal) => sameTitle(goal.title, ref.title));
}

/** 完成时间：备注里的「完成时间」，旧记录没有时退回创建时间。 */
export function completedAt(task: Task): number {
  const at = Date.parse(noteLine(task.notes ?? "", "完成时间"));
  return Number.isFinite(at) ? at : Date.parse(task.ts);
}

export interface PlanGoal {
  id: string;
  title: string;
  area: string | null;
  origin: { source: GoalOrigin; date: string } | null;
  next: { id: string; title: string; due: string | null; rev: number } | null;
  results: number;
  lastResult: string | null;
}
export interface PlansData {
  goals: PlanGoal[];
  projects: number;
  directions: number;
  sources: Record<string, { taskId: string; title: string; goalId?: string; goalTitle?: string }>;
}

/** 今天页「你带来的规划」：进行中的目标、各自的下一步和已记下的结果。只读已加载的数据。 */
export function readPlans(data: Pick<WorkbenchData, "goals" | "records" | "projects">): PlansData {
  // 只列正在推进的目标；暂停的不算「进行中」。
  const goals = data.goals.filter((goal) => !goal.status || goal.status === "active");
  const tasks = (data.records.task ?? []) as Task[];
  const byId = new Map(data.goals.map((goal) => [goal.id, goal]));
  const byTitle = new Map<string, Goal>();
  for (const goal of [...goals, ...data.goals]) {
    const key = goal.title.trim().toLowerCase();
    if (!byTitle.has(key)) byTitle.set(key, goal);
  }
  const linked = new Map<string, Task[]>();
  const sources: PlansData["sources"] = {};
  for (const task of tasks) {
    if (task.status === "proposed") continue;
    const ref = goalRef(task);
    const goal = !ref
      ? undefined
      : "id" in ref
        ? byId.get(ref.id)
        : byTitle.get(ref.title.trim().toLowerCase());
    if (task.source)
      sources[task.source] = {
        taskId: task.id,
        title: task.title,
        ...(goal ? { goalId: goal.id, goalTitle: goal.title } : {}),
      };
    if (!goal || (goal.status && goal.status !== "active")) continue;
    const own = linked.get(goal.id);
    if (own) own.push(task);
    else linked.set(goal.id, [task]);
  }
  return {
    sources,
    goals: goals.map((goal) => {
      const own = linked.get(goal.id) ?? [];
      const open = own.filter((task) => task.status === "open").at(-1);
      const results = own
        .filter((task) => task.status === "done" && noteLine(task.notes ?? "", "完成结果"))
        .sort((a, b) => completedAt(a) - completedAt(b));
      return {
        id: goal.id,
        title: goal.title,
        area: goal.area ?? null,
        origin: goalOrigin(goal.id),
        next: open ? { id: open.id, title: open.title, due: open.due ?? null, rev: open.rev ?? 1 } : null,
        results: results.length,
        lastResult: results.length ? noteLine(results.at(-1)?.notes ?? "", "完成结果") : null,
      };
    }),
    projects: data.projects.filter((project) => project.stage === "active").length,
    directions: (data.records.direction ?? []).filter((row) => row.status === "active").length,
  };
}
