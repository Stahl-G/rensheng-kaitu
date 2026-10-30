import { readOverviewPage } from "./overview-page.js";
import { readProjectsPage } from "./project-page.js";
import { localDate } from "./time.js";
import { type NextItem, type WorkbenchData, readWorkbench } from "./workbench.js";
import type { Workspace } from "./workspace.js";

type Overview = Pick<
  Awaited<ReturnType<typeof readOverviewPage>>,
  "today" | "timeZone" | "plans" | "metrics" | "versions" | "proposedTasks" | "warnings"
>;
type Projects = ReturnType<typeof readProjectsPage>;
type LearningStatus = WorkbenchData["statuses"][number];

export interface HomeSources {
  overview: Overview;
  projects: Projects;
  statuses: readonly LearningStatus[];
  records: WorkbenchData["records"];
}

/** I/O boundary: build in the background, cache the result, and invalidate it on workspace changes.
 * The workbench-derived inputs share one read and one timestamp. File I/O outside that read is not a filesystem transaction.
 */
export async function readHomeSources(ws: Workspace, now = new Date()): Promise<HomeSources> {
  // Home has no raw-note or memory list; keep those reads in the full overview.
  const data = readWorkbench(ws, now, false, true);
  const overview = await readOverviewPage(ws, now, data, false);
  return {
    overview,
    projects: readProjectsPage(ws, { now, loaded: data, partial: true }),
    statuses: data.statuses,
    records: data.records,
  };
}

/** A projection for local display. It is not a persisted record or a phone/Agent permission grant. */
export interface HomeThread {
  key: string;
  id: string;
  kind: "goal" | "project" | "learning";
  title: string;
  file: string;
  stage: "active" | "idea" | "unknown";
  domain: string | null;
  progress: { label: string; current: number; target: number; unit?: string } | null;
  resultCount: number | null;
  last: { date: string | null; text: string; by: "unknown" } | null;
  next: {
    id: string;
    file: string | null;
    title: string;
    due: string | null;
    precondition: { kind: "task"; expectedRev: number } | { kind: "status"; expectedNext: NextItem } | null;
  } | null;
}
export interface HomeTrace {
  key: string;
  date: string;
  kind: "metric" | "project-metric" | "version";
  label: string;
  value: number | null;
  unit: string | null;
  estimated: boolean;
  sourceFiles: string[];
}
export interface HomeData {
  today: string;
  /** Unknown until provenance identifies an actual user action, not merely the writer. */
  lastAuthored: string | null;
  threads: HomeThread[];
  traces: HomeTrace[];
  pending: { id: string; title: string }[];
  /** No inferred mappings: a later atlas projection must prove matching source and permissions. */
  atlas: null;
}

function day(value: string | null | undefined, timeZone: string, today: string): string | null {
  if (!value) return null;
  const stamp = Date.parse(value);
  if (!Number.isFinite(stamp)) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(stamp).toISOString().slice(0, 10) !== value) return null;
  // Date-only project log headings are already workspace-local dates.
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : localDate(new Date(stamp), timeZone);
  return date <= today ? date : null;
}
function dateThreshold(today: string, days: number): string {
  return new Date(Date.parse(`${today}T12:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Pure projection over already-loaded local views. Callers own I/O, invalidation and permission filtering.
 * It does not scan files, mutate its inputs, start the atlas, or imply that data may be sent to a phone/Agent.
 */
export function readHome(input: HomeSources): HomeData {
  const { overview, projects, statuses, records } = input;
  const statusByFile = new Map(statuses.map((item) => [item.file, item]));
  const projectTasks = new Map<string, WorkbenchData["records"][string]>();
  for (const task of records.task ?? []) {
    if (typeof task.project !== "string" || task.status !== "open" || typeof task.title !== "string")
      continue;
    const key = JSON.stringify([task.project, task.id, task.title]);
    const group = projectTasks.get(key) ?? [];
    group.push(task);
    projectTasks.set(key, group);
  }
  const threads: HomeThread[] = overview.plans.goals.map((goal) => ({
    key: `goal:${goal.id}`,
    id: goal.id,
    kind: "goal",
    title: goal.title,
    file: "me/goals.json",
    stage: "active",
    domain: null,
    progress: null,
    resultCount: goal.results,
    // The existing plans view carries text but no completion date or trustworthy actor.
    last: goal.lastResult ? { date: null, text: goal.lastResult, by: "unknown" } : null,
    next: goal.next
      ? {
          id: goal.next.id,
          title: goal.next.title,
          due: goal.next.due,
          file: "task",
          precondition: { kind: "task", expectedRev: goal.next.rev },
        }
      : null,
  }));
  for (const project of projects) {
    if (project.stage !== "active" && project.stage !== "idea") continue;
    const raw = project.next.find((item) => item.status === "todo");
    const statusNext = raw
      ? (statusByFile
          .get(project.file)
          ?.data.next?.filter(
            (item) => item.id === raw.id && item.title === raw.title && item.status === "todo",
          ) ?? [])
      : [];
    const tasks = raw ? (projectTasks.get(JSON.stringify([project.slug, raw.id, raw.title])) ?? []) : [];
    const unique = statusNext.length + tasks.length === 1;
    const recent = project.recentLog;
    const date = day(recent?.date, overview.timeZone, overview.today);
    threads.push({
      key: `project:${project.slug}`,
      id: project.slug,
      kind: "project",
      title: project.title,
      file: project.file,
      stage: project.stage,
      domain: null,
      progress: project.progress,
      resultCount: null,
      // log.md does not identify who authored the entry; sync can be genuine progress too.
      last: date && recent ? { date, text: recent.text, by: "unknown" } : null,
      next: raw
        ? {
            id: raw.id,
            file: unique ? (tasks.length ? "task" : project.file) : null,
            title: raw.title,
            due: raw.due ?? null,
            precondition: unique
              ? tasks.length
                ? typeof tasks[0]?.rev === "number" && Number.isInteger(tasks[0].rev) && tasks[0].rev >= 1
                  ? { kind: "task", expectedRev: tasks[0].rev }
                  : null
                : { kind: "status", expectedNext: statusNext[0] as NextItem }
              : null,
          }
        : null,
    });
  }
  for (const status of statuses) {
    if (!/^learning\/[^/]+\/STATUS\.md$/.test(status.file)) continue;
    const details = status.data as typeof status.data & { title?: string; stage?: string };
    if (details.stage === "paused" || details.stage === "done" || details.stage === "archived") continue;
    const stage = details.stage === "active" || details.stage === "idea" ? details.stage : "unknown";
    const id = status.file.split("/")[1] ?? "";
    const title = details.title?.trim() || status.body.match(/^#\s+(.+)$/m)?.[1]?.trim() || id;
    const next = details.next?.find((item) => item.status === "todo");
    threads.push({
      key: `learning:${id}`,
      id,
      kind: "learning",
      title,
      file: status.file,
      stage,
      domain: null,
      progress: details.progress ?? null,
      resultCount: null,
      last: null,
      next: next
        ? {
            id: next.id,
            file: status.file,
            title: next.title,
            due: next.due ?? null,
            precondition: { kind: "status", expectedNext: next },
          }
        : null,
    });
  }
  threads.sort(
    (a, b) =>
      (b.last?.date ?? "").localeCompare(a.last?.date ?? "") ||
      a.title.localeCompare(b.title) ||
      a.id.localeCompare(b.id),
  );
  const threshold = dateThreshold(overview.today, 13);
  const traces: HomeTrace[] = [];
  for (const project of projects) {
    if ((project.stage !== "active" && project.stage !== "idea") || !project.metricFiles.length) continue;
    for (const entry of project.recent7.daily) {
      const date = day(entry.date, overview.timeZone, overview.today);
      if (!date || date < threshold) continue;
      for (const [unit, value] of [
        ["words", entry.words],
        ["commits", entry.commits],
      ] as const) {
        if (value === null || value === 0) continue;
        traces.push({
          key: `project:${project.slug}:${date}:${unit}`,
          date,
          kind: "project-metric",
          label: project.title,
          value,
          unit,
          estimated: false,
          sourceFiles: project.metricFiles,
        });
      }
    }
  }
  for (const metric of overview.metrics) {
    const date = day(metric.latest, overview.timeZone, overview.today);
    if (!date || date < threshold || metric.value === null || !metric.sources.length) continue;
    traces.push({
      key: `metric:${metric.key}`,
      date,
      kind: "metric",
      label: metric.label,
      value: metric.value,
      unit: metric.unit,
      estimated: metric.estimated,
      sourceFiles: [...new Set(metric.sources.map((source) => source.file))],
    });
  }
  for (const version of overview.versions) {
    if (version.source !== "agent" && version.source !== "cloud") continue;
    const date = day(version.time, overview.timeZone, overview.today);
    if (!date || date < threshold) continue;
    traces.push({
      key: `version:${version.oid}`,
      date,
      kind: "version",
      label: version.text,
      value: null,
      unit: null,
      estimated: false,
      sourceFiles: [],
    });
  }
  traces.sort((a, b) => b.date.localeCompare(a.date) || a.key.localeCompare(b.key));
  const sources = new Set<string>();
  const recentTraces = traces.filter((trace) => {
    const source = trace.kind === "project-metric" ? trace.key.split(":").slice(0, 2).join(":") : trace.key;
    if (sources.has(source)) return false;
    sources.add(source);
    return true;
  });
  return {
    today: overview.today,
    lastAuthored: null,
    threads,
    traces: recentTraces.slice(0, 3),
    pending: overview.proposedTasks.slice(0, 2).map(({ id, title }) => ({ id, title })),
    atlas: null,
  };
}
