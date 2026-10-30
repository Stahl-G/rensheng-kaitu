import { statSync } from "node:fs";
import { type ReadWarning, readWarning } from "./errors.js";
import { KaituError } from "./errors.js";
import { readProjectView } from "./project-view.js";
import { listProjects, projectDirectory, projectMetrics, projectSnapshot, setProject } from "./projects.js";
import { readRecords } from "./records.js";
import type { Task, listTasks } from "./tasks.js";
import { localDate } from "./time.js";
import type { ModuleStatus, WorkbenchData } from "./workbench.js";
import type { Workspace } from "./workspace.js";

export type ProjectGoal = NonNullable<ModuleStatus["progress"]>;
const clean = (text: string) => text.replace(/<!--[\s\S]*?-->/g, "").trim();

export function projectLogs(log: string) {
  return clean(log)
    .split(/^##\s+/m)
    .slice(1)
    .map((section) => {
      const [date = "", ...lines] = section.split(/\r?\n/);
      return { date: date.trim(), text: lines.join("\n").trim() };
    })
    .filter((entry) => entry.text)
    .sort((a, b) => b.date.localeCompare(a.date));
}

export function projectSummary(text: string) {
  const lines = clean(text)
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*[-*+]\s+/, "").trim())
    .filter(Boolean)
    .slice(0, 2);
  return lines
    .map((line) => {
      const commits = line.match(/^(.*?\d+ 次提交)：(.*)$/);
      return commits ? `${commits[1]}：${commits[2]?.split("；").slice(0, 2).join("；")}` : line;
    })
    .join(" · ");
}

export function readProjectsPage(
  ws: Workspace,
  options: {
    slug?: string;
    now?: Date;
    loaded?: Pick<WorkbenchData, "projects" | "records">;
    partial?: boolean;
  } = {},
) {
  const { slug, now = new Date(), loaded, partial } = options;
  const tasks = new Map<string, ReturnType<typeof listTasks>>();
  const warnings: ReadWarning[] = [];
  const openTasks = loaded
    ? ((loaded.records.task ?? []).filter((task) => task.status === "open") as Task[])
    : (readRecords(ws, "task", {
        onError: partial ? (error) => warnings.push(readWarning(error)) : undefined,
      }).filter((row) => row.status === "open") as Task[]);
  for (const task of openTasks) {
    if (!task.project) continue;
    const group = tasks.get(task.project) ?? [];
    group.push(task);
    tasks.set(task.project, group);
  }
  const today = localDate(now, ws.timeZone());
  const projects = loaded
    ? loaded.projects.filter((project) => !slug || project.slug === slug)
    : listProjects(ws, { slug, now, partial });
  return projects.map((project) => {
    const next = [...project.next];
    for (const task of tasks.get(project.slug) ?? []) {
      if (!next.some((item) => item.id === task.id || item.title === task.title))
        next.push({ id: task.id, title: task.title, status: "todo", due: task.due });
    }
    const recent = projectLogs(project.log).find((entry) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.date) || entry.date > today) return false;
      const date = new Date(`${entry.date}T12:00:00Z`);
      return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === entry.date;
    });
    return {
      ...project,
      warnings: [...project.warnings, ...warnings],
      next,
      recentLog: recent ? { date: recent.date, text: projectSummary(recent.text) } : null,
      recent7: {
        ...project.recent7,
        commits: project.recent7.commitsRecorded ? project.recent7.commits : null,
      },
    };
  });
}

export function readProjectPage(ws: Workspace, slug: string, options: { partial?: boolean } = {}) {
  const project = projectSnapshot(ws, slug, options.partial);
  const summary = readProjectsPage(ws, { slug, ...options }).find((item) => item.slug === slug);
  if (!summary) throw new KaituError("找不到项目", "NOT_FOUND");
  const warnings = [...summary.warnings];
  const metrics = projectMetrics(ws, {
    slug,
    onError: options.partial ? (error) => warnings.push(readWarning(error)) : undefined,
  });
  const architecture = `${projectDirectory(ws, slug)}/architecture.html`;
  return {
    ...summary,
    warnings: [...new Set(warnings)],
    ...readProjectView(ws, slug),
    body: project.error ? project.body : clean(project.body),
    progress: project.data.progress ?? null,
    logs: projectLogs(project.log),
    metrics: metrics.map((row) => ({
      date: row.ts.slice(0, 10),
      kind: String(row.kind),
      value: Number(row.value),
    })),
    sources: [summary.file, ...summary.metricFiles],
    architecture: ws.exists(architecture) ? statSync(ws.resolve(architecture)).mtime.toISOString() : null,
  };
}

export function validateProjectGoal(input: ProjectGoal): ProjectGoal {
  if (
    !input ||
    typeof input.label !== "string" ||
    !input.label.trim() ||
    !Number.isFinite(input.current) ||
    input.current < 0 ||
    !Number.isFinite(input.target) ||
    input.target <= 0 ||
    (input.unit !== undefined && typeof input.unit !== "string")
  )
    throw new KaituError("请填写目标名称、当前数值和大于零的目标数值", "BAD_ARGS");
  return {
    label: input.label.trim(),
    current: input.current,
    target: input.target,
    ...(input.unit ? { unit: input.unit.trim() } : {}),
  };
}

export async function saveProjectGoal(ws: Workspace, slug: string, input: ProjectGoal) {
  const goal = validateProjectGoal(input);
  const project = readProjectPage(ws, slug);
  const words = project.metrics.filter((row) => row.kind === "words").at(-1);
  if (goal.unit === "字" && words) goal.current = words.value;
  if (goal.unit === "次提交" && project.metrics.some((row) => row.kind === "commits"))
    goal.current = project.metrics
      .filter((row) => row.kind === "commits")
      .reduce((sum, row) => sum + row.value, 0);
  await setProject(ws, slug, { progress: goal });
  return readProjectPage(ws, slug);
}
