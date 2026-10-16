import { readdirSync, statSync } from "node:fs";
import { KaituError } from "./errors.js";
import { type Frontmatter, parseFrontmatter, stringifyFrontmatter } from "./frontmatter.js";
import { snapshot } from "./history.js";
import { inboxNotes } from "./inbox-notes.js";
import { listMemories } from "./memory.js";
import { listModules, listRecordTypes } from "./modules.js";
import { listProjects, projectStatusFiles, projectVersion, publicProject } from "./projects.js";
import { readRecords } from "./records.js";
import { formatErrors, schemas } from "./schema.js";
import { tasksForToday } from "./tasks.js";
import { templateOutdated } from "./template-version.js";
import { isoInZone, localDate } from "./time.js";
import type { Workspace } from "./workspace.js";

export interface PlanBlock {
  id: string;
  title: string;
  kind: "event" | "proposal" | "task";
  status: "confirmed" | "pending" | "done" | "skipped" | "rejected";
  start?: string;
  end?: string;
  module?: string;
  ref?: string;
}
export interface TodayPlan {
  date: string | null;
  blocks: PlanBlock[];
  attention?: { kind: string; title: string; ref?: string }[];
}
export interface NextItem {
  id: string;
  title: string;
  status: "todo" | "proposed" | "done" | "skipped";
  priority?: "high" | "normal" | "low";
  due?: string | null;
  estimate?: string | null;
  when?: string | null;
}
export interface ModuleStatus {
  updated: string | null;
  progress?: { label: string; current: number; target: number; unit?: string } | null;
  next?: NextItem[];
}
export interface Rules {
  timezone: string;
  sleep?: { start: string; end: string };
  work_hours?: { start: string; end: string };
  no_tasks_after?: string;
  training?: { pattern?: string; duration_min?: number; preferred?: string };
  nutrition?: { protein_g?: number[]; deficit_kcal_max?: number };
}
export interface Goal {
  id: string;
  title: string;
  status: string;
  area?: string;
  metric?: string;
  target?: string;
  due?: string;
}
export interface Lab {
  date: string;
  items: { name: string; value: string | number; unit: string; ref_range?: string; flag?: string }[];
}

function files(ws: Workspace, dir: string, suffix: string): string[] {
  if (!ws.exists(dir)) return [];
  return readdirSync(ws.resolve(dir), { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(suffix))
    .map((entry) => `${dir}/${entry.name}`)
    .filter((file) => ws.scanText(file) !== undefined)
    .sort()
    .reverse();
}

export function statusFiles(ws: Workspace, publicOnly = false): { file: string; module: string }[] {
  const out: { file: string; module: string }[] = [];
  function walk(dir: string, module: string): void {
    for (const entry of readdirSync(ws.resolve(dir), { withFileTypes: true })) {
      if (entry.isSymbolicLink() || entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const file = `${dir}/${entry.name}`;
      if (ws.conflictCopy(file)) continue;
      if (entry.isDirectory()) walk(file, module);
      else if (entry.name === "STATUS.md") out.push({ file, module });
    }
  }
  for (const module of listModules(ws)) {
    if (module.dir !== "projects") walk(module.dir, module.def.name);
    else if (ws.exists("projects/STATUS.md"))
      out.push({ file: "projects/STATUS.md", module: module.def.name });
  }
  out.push(...projectStatusFiles(ws, publicOnly));
  return out;
}

function document<T>(ws: Workspace, file: string, fallback: T): Frontmatter<T> {
  if (!ws.exists(file)) return { data: fallback, body: "" };
  const parsed = parseFrontmatter<T>(ws.readText(file));
  const schema =
    file === "NOW.md"
      ? "now.schema.json"
      : file.endsWith("STATUS.md")
        ? "status.schema.json"
        : "rules.schema.json";
  if (!schemas().builtin(schema)(parsed.data)) throw new KaituError("文档格式不合法", "INVALID_DOCUMENT");
  return parsed;
}

export function readWorkbench(ws: Workspace, now = new Date(), publicOnly = false) {
  const today = localDate(now, ws.timeZone());
  const warnings: string[] = [];
  if (templateOutdated(ws)) warnings.push("内置模板有更新，运行 kaitu upgrade。");
  function read<T>(label: string, fn: () => T, fallback: T): T {
    try {
      return fn();
    } catch {
      warnings.push(`${label}暂时无法读取，请让 Agent 检查文件格式。`);
      return fallback;
    }
  }
  const modules = listModules(ws);
  const records = Object.fromEntries(
    listRecordTypes(ws).map(({ type }) => [
      type,
      read(
        type,
        () =>
          readRecords(ws, type).filter(
            (r) =>
              !publicOnly ||
              !["project_metric", "github_snapshot"].includes(type) ||
              publicProject(ws, r.project),
          ),
        [],
      ),
    ]),
  );
  const docs = (dir: string) => files(ws, dir, ".md").map((file) => ({ file, body: ws.readText(file) }));
  return {
    root: ws.root,
    today,
    inboxNotes: inboxNotes(ws).length,
    timeZone: ws.timeZone(),
    now: read("今天的计划", () => document<TodayPlan>(ws, "NOW.md", { date: null, blocks: [] }), {
      data: { date: null, blocks: [] } as TodayPlan,
      body: "",
    }),
    projects: read("项目", () => listProjects(ws, { now, publicOnly }), []),
    statuses: statusFiles(ws, publicOnly).flatMap(({ file, module }) =>
      read(file, () => [{ file, module, ...document<ModuleStatus>(ws, file, { updated: null }) }], []),
    ),
    modules,
    records,
    tasks: read("待办", () => tasksForToday(records.task ?? [], ws.timeZone(), now), []),
    profile: ws.exists("me/profile.md") ? (ws.scanText("me/profile.md") ?? "") : "",
    rules: read("作息规则", () => document<Rules>(ws, "me/rules.md", { timezone: ws.timeZone() }), {
      data: { timezone: ws.timeZone() } as Rules,
      body: "",
    }),
    goals: read("目标", () => ws.readJson<Goal[]>("me/goals.json"), []),
    feeds: read("订阅源", () => ws.readJson<{ feeds: unknown[]; keywords: string[] }>("feed/feeds.json"), {
      feeds: [],
      keywords: [],
    }),
    digests: read("动态简报", () => docs("feed/digests"), []),
    reports: read("现状报告", () => docs("me/reports"), []),
    daily: ws.exists(`reviews/daily/${today}.md`) ? (ws.scanText(`reviews/daily/${today}.md`) ?? "") : "",
    labs: files(ws, "health/data/labs", ".json").flatMap((file) =>
      read(file, () => [{ file, ...ws.readJson<Lab>(file) }], []),
    ),
    memories: read("记忆", () => listMemories(ws), []),
    warnings: [...warnings, ...ws.pendingDownloads().map((file) => `还没从 iCloud 下载：${file}`)],
  };
}
export type WorkbenchData = ReturnType<typeof readWorkbench>;

async function editFrontmatter<T>(ws: Workspace, file: string, schema: string, edit: (data: T) => string) {
  const parsed = parseFrontmatter<T>(ws.readText(file));
  const message = edit(parsed.data);
  const validate = schemas().builtin(schema);
  if (!validate(parsed.data)) {
    throw new KaituError(
      `文件格式不合法：${formatErrors(validate.errors)
        .map((e) => e.message)
        .join("，")}`,
      "INVALID_DOCUMENT",
    );
  }
  ws.writeText(file, stringifyFrontmatter(parsed.data, parsed.body), { internal: true });
  const slug = /^(?:projects|\.kaitu\/local-projects)\/([^/]+)\/STATUS\.md$/.exec(file)?.[1];
  return { version: slug ? await projectVersion(ws, slug, message) : await snapshot(ws, message) };
}

export function decideProposal(ws: Workspace, id: string, decision: "confirmed" | "rejected") {
  if (!["confirmed", "rejected"].includes(decision)) throw new KaituError("无效的确认操作", "BAD_ARGS");
  return editFrontmatter<TodayPlan>(ws, "NOW.md", "now.schema.json", (data) => {
    const block = data.blocks.find((item) => item.id === id && item.kind === "proposal");
    if (!block || block.status !== "pending")
      throw new KaituError("这条建议已处理或不存在，请刷新", "CONFLICT");
    block.status = decision;
    return `你${decision === "confirmed" ? "确认" : "拒绝"}了日程建议：${block.title}`;
  });
}

export function completeNext(ws: Workspace, file: string, id: string, now = new Date()) {
  if (!statusFiles(ws).some((item) => item.file === file))
    throw new KaituError("找不到模块状态", "NOT_FOUND");
  return editFrontmatter<ModuleStatus>(ws, file, "status.schema.json", (data) => {
    const item = data.next?.find((item) => item.id === id && item.status === "todo");
    if (!item) throw new KaituError("这一步已处理或不存在，请刷新", "CONFLICT");
    item.status = "done";
    data.updated = isoInZone(now, ws.timeZone());
    return `你完成了下一步：${item.title}`;
  });
}

export function ignoredWorkspaceChange(file: string): boolean {
  return (
    file === "OVERVIEW.md" ||
    file === ".kaitu/inbox-state.json" ||
    file === ".kaitu/channels" ||
    file.startsWith(".kaitu/channels/") ||
    file.startsWith("inbox/processed/") ||
    file.startsWith("inbox/rejected/") ||
    file.split(/[\\/]/).includes(".git") ||
    file === ".kaitu/history.git" ||
    file.startsWith(".kaitu/history.git/") ||
    file === ".kaitu/cache" ||
    file.startsWith(".kaitu/cache/") ||
    file.startsWith(".kaitu/index.sqlite") ||
    (!file.startsWith("inbox/agents/") && (file.endsWith(".tmp") || file.endsWith(".DS_Store")))
  );
}

export function workspaceFileStamps(ws: Workspace): Map<string, string> {
  const stamps = new Map<string, string>();
  function walk(dir: string): void {
    for (const entry of readdirSync(ws.resolve(dir, { internal: true }), { withFileTypes: true })) {
      const file = dir ? `${dir}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink() || ignoredWorkspaceChange(file)) continue;
      if (entry.isDirectory()) walk(file);
      else {
        const stat = statSync(ws.resolve(file, { internal: true }));
        stamps.set(file, `${stat.mtimeMs}:${stat.ctimeMs}:${stat.size}`);
      }
    }
  }
  walk("");
  return stamps;
}
