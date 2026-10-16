import { KaituError } from "./errors.js";
import { readProjectView } from "./project-view.js";
import { listProjects, readProject, setProject } from "./projects.js";
import { readRecords } from "./records.js";
import { listTasks } from "./tasks.js";
import type { ModuleStatus } from "./workbench.js";
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
  const lines = clean(text).split(/\r?\n/).filter(Boolean).slice(0, 2);
  return lines
    .map((line) => {
      const commits = line.match(/^(.*?\d+ 次提交)：(.*)$/);
      return commits ? `${commits[1]}：${commits[2]?.split("；").slice(0, 2).join("；")}` : line;
    })
    .join(" · ");
}

export function readProjectsPage(ws: Workspace, slug?: string) {
  const tasks = listTasks(ws);
  return listProjects(ws, { slug }).map((project) => {
    const next = [...project.next];
    for (const task of tasks.filter((task) => task.project === project.slug)) {
      if (!next.some((item) => item.id === task.id || item.title === task.title))
        next.push({ id: task.id, title: task.title, status: "todo", due: task.due });
    }
    const recent = projectLogs(project.log)[0];
    return {
      ...project,
      next,
      recentLog: recent ? { date: recent.date, text: projectSummary(recent.text) } : null,
      recent7: {
        ...project.recent7,
        commits: project.recent7.commitsRecorded ? project.recent7.commits : null,
      },
    };
  });
}

export function readProjectPage(ws: Workspace, slug: string) {
  const project = readProject(ws, slug);
  const summary = readProjectsPage(ws, slug).find((item) => item.slug === slug);
  if (!summary) throw new KaituError("找不到项目", "NOT_FOUND");
  const metrics = readRecords(ws, "project_metric").filter((row) => row.project === slug);
  return {
    ...summary,
    ...readProjectView(ws, slug),
    body: clean(project.body),
    progress: project.data.progress ?? null,
    logs: projectLogs(project.log),
    metrics: metrics.map((row) => ({
      date: row.ts.slice(0, 10),
      kind: String(row.kind),
      value: Number(row.value),
    })),
    sources: [summary.file, ...summary.metricFiles],
  };
}
export type ProjectPage = ReturnType<typeof readProjectPage>;

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
