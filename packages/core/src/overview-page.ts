import { driveStatus } from "./drive.js";
import { history } from "./history.js";
import { inboxNotes } from "./inbox-notes.js";
import { findRecordType, recordFileFor } from "./modules.js";
import { latestDaily } from "./overview.js";
import type { StoredRecord } from "./records.js";
import { summarizeStatus } from "./status.js";
import { localDate, localMonth, parseTs } from "./time.js";
import { readWorkbench } from "./workbench.js";
import type { Workspace } from "./workspace.js";

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
  const dailyValues = (records: StoredRecord[], field: string, dateField = "ts", divisor = 1) =>
    dates.map((date) => {
      const values = records.filter((r) => day(r[dateField]) === date && typeof r[field] === "number");
      return {
        date,
        value: values.length ? values.reduce((sum, r) => sum + Number(r[field]), 0) / divisor : null,
      };
    });
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
  const next = status.modules.flatMap((module) =>
    (module.next ?? [])
      .filter((item) => item.status === "todo" || item.status === "proposed")
      .slice(0, 5)
      .map((item) => ({ ...item, module: module.module, file: module.file })),
  );
  return {
    root: data.root,
    timeZone: data.timeZone,
    today: data.today,
    cutoff,
    drive: driveStatus(ws).mode === "drive",
    empty:
      !Object.values(data.records).some((r) => r.length) &&
      !data.now.data.blocks.length &&
      !next.length &&
      !data.projects.length &&
      !data.memories.length &&
      !daily &&
      !data.inboxNotes,
    blocks: status.now.blocks,
    next: next.map((item) => ({
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
    })),
    versions: (await history(ws))
      .filter(
        (v) =>
          !/开图升级到|重新生成了?\s*AGENTS\.md|文件夹有改动|初始化(?:了)?(?:开图|工作区)|更新了?内置模板/i.test(
            v.message,
          ),
      )
      .slice(0, 10)
      .map((v) => ({
        ...v,
        source: versionSource(v.message),
        actor: /Drive 收件箱[：:]\s*([^）)]+)/.exec(v.message)?.[1]?.trim() ?? null,
      })),
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
        value: workouts.length
          ? new Set(workouts.map((r) => `${day(r.ts)}:${r.session_id ?? r.id}`)).size
          : null,
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
            value: sessions.length ? new Set(sessions.map((r) => r.session_id ?? r.id)).size : null,
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
    ],
    pending: status.now.pending,
    inboxNotes: data.inboxNotes,
    notes: inboxNotes(ws).map((note) => ({ file: note.path, text: note.content })),
    warnings: data.warnings,
  };
}
