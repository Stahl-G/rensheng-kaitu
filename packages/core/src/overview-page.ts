import { readdirSync } from "node:fs";
import { driveStatus } from "./drive.js";
import { committedExperiences, pendingExperienceImports } from "./experience-imports.js";
import { type TimedExperience, experienceLayer } from "./experience-time.js";
import { history } from "./history.js";
import { inboxNotes, noteMetadata } from "./inbox-notes.js";
import { findRecordType, recordFileFor } from "./modules.js";
import { latestDaily } from "./overview.js";
import type { StoredRecord } from "./records.js";
import { dailyRecordTotals, summarizeStatus, workoutSessions } from "./status.js";
import { localDate, localMonth, parseTs } from "./time.js";
import { readWorkbench } from "./workbench.js";
import type { Workspace } from "./workspace.js";

const RECORD_NAMES: Record<string, string> = {
  meal: "记录了一餐",
  workout: "记录了一次训练",
  sleep: "记录了睡眠",
  metric: "记录了身体数据",
  activity: "记录了活动",
  task: "加了一条待办",
};

/** 把版本说明改写成用户看得懂的一句话；系统维护类返回 null（不显示）。 */
function friendlyVersion(message: string): string | null {
  if (
    /开图升级到|AGENTS\.md|文件夹有改动|初始化|内置模板|恢复点|消息处理|转为待整理笔记|整理了一条收件箱笔记|同步了 0 条|同步了项目进度|移出 Drive|开启 Google Drive/.test(
      message,
    )
  )
    return null;
  const written = /对话写入[：:]\s*(\w+)/.exec(message);
  if (written) return RECORD_NAMES[written[1] ?? ""] ?? "记了一条记录";
  const text = message
    .replace(/^Agent\s*（Drive 收件箱[：:][^）]*）\s*/, "")
    .replace(/^(Agent|你)\s*/, "")
    .replace(/（快捷指令）$/, "")
    .replace(/(新建了|更新了)项目[：:]\s*(.+)$/, "$1项目「$2」")
    .replace(/^留了一条待整理笔记$/, "留了一条笔记，等你整理");
  return text || null;
}

function versionSource(message: string): "user" | "agent" | "cloud" | "unknown" {
  if (/Drive 收件箱|云端|cloud-agent/i.test(message)) return "cloud";
  if (/DeepSeek 对话|Agent|agent/i.test(message)) return "agent";
  if (/^你|^手动/.test(message)) return "user";
  return "unknown";
}

/** 总览只做查询与投影，文件和记录均通过现有 core 接口读取。 */
export async function readOverviewPage(ws: Workspace, now = new Date()) {
  const data = readWorkbench(ws, now);
  const status = summarizeStatus(data);
  const cutoff = now.toISOString();
  const day = (ts: unknown) => localDate(parseTs(String(ts)), data.timeZone);
  const rows = (type: string, field = "ts") =>
    (data.records[type] ?? []).filter(
      (row) => day(row[field]) >= status.recent7.from && Date.parse(String(row[field])) <= now.getTime(),
    );
  const sources = (type: string, records: StoredRecord[]) =>
    records.map((row) => ({
      file: recordFileFor(findRecordType(ws, type), localMonth(parseTs(row.ts), data.timeZone)),
      text: JSON.stringify(row, null, 2),
    }));
  const metric = (
    key: string,
    label: string,
    unit: string,
    type: string,
    field: string,
    dateField = "ts",
  ) => {
    const records = rows(type, dateField).filter((r) => typeof r[field] === "number");
    const days = new Set(records.map((r) => day(r[dateField]))).size;
    const total = records.reduce((sum, r) => sum + Number(r[field]), 0);
    const value = records.length ? total / days / (type === "sleep" ? 60 : 1) : null;
    return {
      key,
      label,
      unit,
      value,
      days,
      estimated: records.some((r) => Number(r.uncertainty) > 0 || /估算|estimate/i.test(String(r.source))),
      from: status.recent7.from,
      to: data.today,
      cutoff,
      latest: records.at(-1) ? String(records.at(-1)?.[dateField]) : null,
      sources: sources(type, records),
      daily: dailyValues(records, field, dateField, type === "sleep" ? 60 : 1),
      target: type === "sleep" ? (sleepTarget ? [sleepTarget] : null) : (proteinTarget ?? null),
    };
  };
  const dates = Array.from({ length: 7 }, (_, i) =>
    new Date(Date.parse(`${status.recent7.from}T12:00:00Z`) + i * 86400000).toISOString().slice(0, 10),
  );
  const dailyValues = (records: StoredRecord[], field: string, dateField = "ts", divisor = 1) => {
    const totals = dailyRecordTotals(records, data.timeZone, field, dateField, divisor);
    return dates.map((date) => ({ date, value: totals.get(date) ?? null }));
  };
  const sleepRule = data.rules.data.sleep;
  const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
  const sleepTarget = sleepRule
    ? ((minutes(sleepRule.end) - minutes(sleepRule.start) + 1440) % 1440) / 60
    : null;
  const proteinTarget = data.rules.data.nutrition?.protein_g;
  const workouts = rows("workout");
  const weight = (data.records.metric ?? [])
    .filter((r) => r.kind === "weight" && Date.parse(r.ts) <= now.getTime())
    .at(-1);
  const daily = latestDaily(ws);
  const unresolved = daily?.body.split(/^##\s+未决事项[^\n]*\r?\n/m)[1]?.split(/^##\s/m)[0] ?? "";
  const dailyItems = [...unresolved.matchAll(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[([ xX])\]\s*)?(.+)$/gm)].filter(
    (m) =>
      m[1]?.toLowerCase() !== "x" && !/^(?:无|暂无|没有|无未决事项)[。.!！\s]*$/.test(m[2]?.trim() ?? ""),
  );
  const next = status.modules
    .flatMap((module) =>
      (module.next ?? [])
        .filter((item) => item.status === "todo" || item.status === "proposed")
        .map((item) => ({ ...item, module: module.module, file: module.file })),
    )
    .sort((a, b) => {
      const overdue = (item: typeof a) => (item.due && item.due < data.today ? 0 : 1);
      const priority = (item: typeof a) => (item.priority === "high" ? 0 : item.priority === "low" ? 2 : 1);
      return (
        overdue(a) - overdue(b) ||
        priority(a) - priority(b) ||
        (a.due ?? "9999").localeCompare(b.due ?? "9999") ||
        Number(a.status === "proposed") - Number(b.status === "proposed")
      );
    });
  const allNext = next.map((item) => ({
    id: item.id,
    title: item.title,
    proposed: item.status === "proposed",
    module: item.module,
    file: item.file,
    section: item.file.startsWith("health/")
      ? "health"
      : /^(?:projects|\.kaitu\/local-projects)\//.test(item.file)
        ? "projects"
        : item.file.startsWith("feed/")
          ? "feed"
          : item.file.startsWith("me/")
            ? "me"
            : "today",
  }));
  const notes = inboxNotes(ws).map((note) => ({
    file: note.path,
    text: note.content,
    status: noteMetadata(note.content).kind === "capture" ? ("received" as const) : ("needs_review" as const),
  }));
  const directionSuggestions = (data.records.direction ?? []).filter(
    (row) => row.status === "suggested",
  ).length;
  const mapPendingImports = pendingExperienceImports(ws).length;
  const mapNeedsReview = committedExperiences(ws).filter(
    (row) => row.review || !experienceLayer(row as unknown as TimedExperience, data.today),
  ).length;
  const pendingFiles = ["inbox/agents", "inbox/health"].reduce(
    (count, directory) =>
      count +
      (ws.exists(directory)
        ? readdirSync(ws.resolve(directory), { withFileTypes: true }).filter(
            (entry) => entry.isFile() && !entry.name.startsWith("."),
          ).length
        : 0),
    0,
  );
  const versions = (await history(ws))
    .flatMap((v) => {
      const text = friendlyVersion(v.message);
      return text
        ? [
            {
              ...v,
              text,
              source: versionSource(v.message),
              actor: /Drive 收件箱[：:]\s*([^）)]+)/.exec(v.message)?.[1]?.trim() ?? null,
            },
          ]
        : [];
    })
    .slice(0, 30);
  const sections = data.modules.flatMap(({ dir, def }) => {
    const records = Object.keys(def.records ?? {}).flatMap<{ ts: string }>((type) => {
      if (["experience_batch", "experience_source", "finance_fx_rate"].includes(type)) return [];
      return type === "experience" ? committedExperiences(ws) : (data.records[type] ?? []);
    });
    const topics = data.statuses.filter(
      (item) => item.file.startsWith(`${dir}/`) && item.file !== `${dir}/STATUS.md`,
    );
    const count =
      def.id === "projects"
        ? data.projects.length
        : def.id === "health"
          ? records.length + data.labs.length
          : def.id === "feed"
            ? records.length + data.digests.length
            : def.id === "me"
              ? data.memories.length + data.goals.length
              : records.length + topics.length;
    if (!count) return [];
    const timestamps = [
      ...records.map((record) => record.ts),
      ...topics.map((topic) => topic.data.updated),
    ].filter((value): value is string => !!value && Number.isFinite(Date.parse(value)));
    timestamps.sort((a, b) => Date.parse(b) - Date.parse(a));
    return [{ id: def.id, label: def.name, count, latest: timestamps[0] ?? null }];
  });
  return {
    root: data.root,
    timeZone: data.timeZone,
    today: data.today,
    cutoff,
    drive: driveStatus(ws).mode === "drive",
    sections,
    empty:
      !sections.length &&
      !Object.values(data.records).some((r) => r.length) &&
      !data.now.data.blocks.length &&
      !next.length &&
      !data.projects.length &&
      !data.memories.length &&
      !daily &&
      !data.inboxNotes,
    blocks: status.now.blocks,
    next: allNext.slice(0, 3),
    allNext,
    versions,
    sync: {
      received: pendingFiles + notes.filter((note) => note.status === "received").length,
      needsReview:
        mapNeedsReview +
        mapPendingImports +
        directionSuggestions +
        notes.filter((note) => note.status === "needs_review").length,
      directionSuggestions,
      mapPendingImports,
      mapNeedsReview,
      updatedAt: versions.find((v) => !/等待整理|待整理笔记/.test(v.message))?.time ?? null,
    },
    daily: daily ? { ...daily, unresolved: dailyItems.length } : null,
    projects: status.projects
      .filter((p) => p.stage === "active")
      .map((p) => ({
        slug: p.slug,
        title: p.title,
        file: p.file,
        metricFiles: p.metricFiles,
        next: p.next.filter((n) => n.status === "todo" || n.status === "proposed").map((n) => n.title),
        words: p.recent7.words,
        commits: p.recent7.commitsRecorded ? p.recent7.commits : null,
        daily: p.recent7.daily,
        from: status.recent7.from,
        to: data.today,
      })),
    metrics: [
      {
        key: "workouts",
        label: "训练",
        unit: "次",
        value: workouts.length ? workoutSessions(workouts, data.timeZone).length : null,
        days: new Set(workouts.map((r) => day(r.ts))).size,
        estimated: false,
        from: status.recent7.from,
        to: data.today,
        cutoff,
        latest: workouts.at(-1)?.ts ?? null,
        sources: sources("workout", workouts),
        daily: dates.map((date) => {
          const sessions = workouts.filter((r) => day(r.ts) === date);
          return {
            date,
            value: sessions.length ? workoutSessions(sessions, data.timeZone).length : null,
          };
        }),
        target: null,
      },
      metric("sleep", "日均睡眠", "小时", "sleep", "duration_min", "end"),
      metric("protein", "日均蛋白质", "g", "meal", "protein_g"),
      {
        key: "weight",
        label: "体重",
        unit: weight ? String(weight.unit) : "kg",
        value: weight ? Number(weight.value) : null,
        days: weight ? 1 : 0,
        estimated: weight ? /估算|estimate/i.test(String(weight.source)) : false,
        from: weight ? day(weight.ts) : null,
        to: weight ? day(weight.ts) : null,
        cutoff,
        latest: weight?.ts ?? null,
        sources: sources("metric", weight ? [weight] : []),
        daily: [],
        target: null,
      },
    ].filter((item) => item.value !== null),
    pending: status.now.pending,
    inboxNotes: notes.filter((note) => note.status === "needs_review").length,
    notes,
    warnings: data.warnings,
  };
}
