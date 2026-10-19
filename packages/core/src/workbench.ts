import { readdirSync, statSync } from "node:fs";
import { publicRecords } from "./agent-tools.js";
import { normalizeDocument } from "./doc-input.js";
import { KaituError } from "./errors.js";
import { type Frontmatter, parseFrontmatter, stringifyFrontmatter } from "./frontmatter.js";
import { snapshot } from "./history.js";
import { inboxNotes } from "./inbox-notes.js";
import { listMemories } from "./memory.js";
import { listModules, listRecordTypes, recordFilePattern } from "./modules.js";
import { listProjects, projectStatusFiles } from "./projects.js";
import { readRecords } from "./records.js";
import { formatErrors, schemas } from "./schema.js";
import { listTasks, tasksForToday } from "./tasks.js";
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
  /** 在 iPhone 上确认、由手机写进 Apple 日历；电脑不再写系统日历。 */
  calendar?: "phone";
}
export interface TodayPlan {
  date: string | null;
  blocks: PlanBlock[];
  attention?: { kind: string; title: string; ref?: string }[];
}
export interface NextItem {
  id: string;
  ref?: string;
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

export function statusFiles(ws: Workspace): { file: string; module: string }[] {
  const out: { file: string; module: string }[] = [];
  const recordDirectories = new Set(listRecordTypes(ws).map((ref) => recordFilePattern(ref).dir));
  function walk(dir: string, module: string): void {
    for (const entry of readdirSync(ws.resolve(dir), { withFileTypes: true })) {
      if (entry.isSymbolicLink() || entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const file = `${dir}/${entry.name}`;
      if (ws.conflictCopy(file)) continue;
      // 模块的附件与已声明的记录目录不含状态文档；保留自建模块的任意层级主题。
      if (entry.isDirectory()) {
        if (entry.name !== "files" && !recordDirectories.has(file)) walk(file, module);
      } else if (entry.name === "STATUS.md") out.push({ file, module });
    }
  }
  for (const module of listModules(ws)) {
    if (module.dir !== "projects") walk(module.dir, module.def.name);
    else if (ws.exists("projects/STATUS.md"))
      out.push({ file: "projects/STATUS.md", module: module.def.name });
  }
  out.push(...projectStatusFiles(ws));
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
  const data = normalizeDocument(schema, parsed.data) as T;
  if (!schemas().builtin(schema)(data)) throw new KaituError("文档格式不合法", "INVALID_DOCUMENT");
  return { ...parsed, data };
}

export function readWorkbench(ws: Workspace, now = new Date(), remote = false) {
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
        () => {
          const rows = readRecords(ws, type);
          return remote ? publicRecords(ws, type, rows) : rows;
        },

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
    projects: read("项目", () => listProjects(ws, { now }), []),
    statuses: statusFiles(ws).flatMap(({ file, module }) =>
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
    warnings: [...warnings, ...ws.pendingDownloads().map((file) => `还没从云盘下载：${file}`)],
  };
}
export type WorkbenchData = ReturnType<typeof readWorkbench>;

async function editFrontmatter<T>(ws: Workspace, file: string, schema: string, edit: (data: T) => string) {
  const raw = parseFrontmatter<T>(ws.readText(file));
  const parsed = { ...raw, data: normalizeDocument(schema, raw.data) as T };
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
  return { version: await snapshot(ws, message) };
}

export function decideProposal(ws: Workspace, id: string, decision: "confirmed" | "rejected") {
  if (!["confirmed", "rejected"].includes(decision)) throw new KaituError("无效的确认操作", "BAD_ARGS");
  return editFrontmatter<TodayPlan>(ws, "NOW.md", "now.schema.json", (data) => {
    const block = data.blocks.find((item) => item.id === id && ["proposal", "task"].includes(item.kind));
    if (!block || !["pending", "confirmed", "rejected"].includes(block.status))
      throw new KaituError("这条建议已处理或不存在，请刷新", "CONFLICT");
    block.status = decision;
    return `你${decision === "confirmed" ? "确认" : "拒绝"}了日程建议：${block.title}`;
  });
}

/**
 * 手机交来的确认或拒绝：只改今天的状态。确认的日程由手机写进 Apple 日历（经 iCloud 同步到电脑），
 * 这里标明日历归手机，电脑不再写系统日历，所以收件箱文件伪造不出一条写进你日历的日程。
 */
export function decidePhoneProposal(ws: Workspace, id: string, decision: "confirmed" | "rejected") {
  return editFrontmatter<TodayPlan>(ws, "NOW.md", "now.schema.json", (data) => {
    const block = data.blocks.find(
      (item) => item.id === id && item.kind === "proposal" && item.status === "pending",
    );
    if (!block) throw new KaituError("日程建议已处理或不存在", "CONFLICT");
    block.status = decision;
    if (decision === "confirmed") block.calendar = "phone";
    return `你在 iPhone 上${decision === "confirmed" ? "确认" : "拒绝"}了日程建议：${block.title}`;
  });
}

/** located：这台电脑能改到日历里的这条事件（已找到、同步开着、有日历执行器），iPhone 写入的那条也能跟着改。 */
export function editCalendarBlock(ws: Workspace, id: string, start: string, end: string, located = false) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(start) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(end) || end <= start)
    throw new KaituError("请填写当天有效的起止时间，结束须晚于开始", "BAD_ARGS");
  return editFrontmatter<TodayPlan>(ws, "NOW.md", "now.schema.json", (data) => {
    const block = data.blocks.find(
      (row) => row.id === id && ["proposal", "task"].includes(row.kind) && row.status === "confirmed",
    );
    if (!block) throw new KaituError("找不到已确认的时间段", "NOT_FOUND");
    // 手机写进日历的那条，只有这台电脑在日历里找到了它才能跟着改，否则会和日历对不上。
    if (block.calendar === "phone" && !located)
      throw new KaituError(
        "这条日程由 iPhone 写进了日历，这里改不到日历里的那条，请在 iPhone 上改时间",
        "CONFLICT",
      );
    Object.assign(block, { start, end });
    return `你调整了日程：${block.title}`;
  });
}

export function scheduleNext(ws: Workspace, file: string, id: string, start: string, end: string) {
  if (file !== "task" && !statusFiles(ws).some((item) => item.file === file))
    throw new KaituError("找不到模块状态", "NOT_FOUND");
  const item =
    file === "task"
      ? listTasks(ws).find((row) => row.id === id)
      : // 和今天页看到的一样先补齐 id，Agent 手写没有 id 的下一步也能排时间。
        (
          normalizeDocument(
            "status.schema.json",
            parseFrontmatter(ws.readText(file)).data,
          ) as unknown as ModuleStatus
        ).next?.find((row) => row.id === id && row.status === "todo");
  if (!item) throw new KaituError("找不到待办的下一步", "NOT_FOUND");
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(start) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(end) || end <= start)
    throw new KaituError("请填写当天有效的起止时间，结束须晚于开始", "BAD_ARGS");
  return editFrontmatter<TodayPlan>(ws, "NOW.md", "now.schema.json", (data) => {
    if (!data.date || !data.blocks.length) data.date = localDate(new Date(), ws.timeZone());
    const blockId = `next-${id}`;
    const existing = data.blocks.find((block) => block.id === blockId);
    const block: PlanBlock = {
      id: blockId,
      title: item.title,
      kind: "task",
      status: "confirmed",
      start,
      end,
      ref: id,
    };
    if (existing) Object.assign(existing, block);
    else data.blocks.push(block);
    return `你确认了下一步的时间段：${item.title}`;
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
    file === "phone" ||
    file.startsWith("phone/") ||
    file === ".kaitu/inbox-state.json" ||
    file === ".kaitu/organizer.json" ||
    file === ".kaitu/feishu.json" ||
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
