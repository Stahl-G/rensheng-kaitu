import { readdirSync } from "node:fs";
import { readAutomation } from "./automation.js";
import { driveStatus } from "./drive.js";
import { readWarning } from "./errors.js";
import { committedExperiences, pendingExperienceImports } from "./experience-imports.js";
import { type TimedExperience, experienceLayer } from "./experience-time.js";
import { history } from "./history.js";
import { inboxNotes } from "./inbox-notes.js";
import { findRecordType, recordFileFor } from "./modules.js";
import { organizerStatus } from "./organizer.js";
import { latestDaily } from "./overview.js";
import { readPlans } from "./plans.js";
import type { StoredRecord } from "./records.js";
import { dailyRecordTotals, summarizeStatus, workoutSessions } from "./status.js";
import { localDate, localMonth, parseTs } from "./time.js";
import { type WorkbenchData, readWorkbench } from "./workbench.js";
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

function organizerOn(ws: Workspace): boolean {
  try {
    const automation = readAutomation(ws);
    return automation.asked && automation.tasks.organizer;
  } catch {
    return false;
  }
}

/** 总览只做查询与投影，文件和记录均通过现有 core 接口读取。 */
export async function readOverviewPage(ws: Workspace, now = new Date(), loaded?: WorkbenchData) {
  const data = loaded ?? readWorkbench(ws, now);
  const status = summarizeStatus(data);
  const cutoff = now.toISOString();
  const localDays = new Map<string, string>();
  const day = (ts: unknown) => {
    const key = String(ts);
    let date = localDays.get(key);
    if (date === undefined) {
      date = localDate(parseTs(key), data.timeZone);
      localDays.set(key, date);
    }
    return date;
  };
  // 先按时间粗筛（任何时区的当地零点都不早于 UTC 零点前 14 小时），只给近几天的记录换算当地日期。
  const earliest = Date.parse(`${status.recent7.from}T00:00:00Z`) - 14 * 3600000;
  const rows = (type: string, field = "ts") =>
    (data.records[type] ?? []).filter((row) => {
      const at = Date.parse(String(row[field]));
      return at >= earliest && at <= now.getTime() && day(row[field]) >= status.recent7.from;
    });
  const sources = (type: string, records: StoredRecord[]) => {
    const ref = records.length ? findRecordType(ws, type) : null;
    return records.map((row) => ({
      file: recordFileFor(ref as NonNullable<typeof ref>, localMonth(parseTs(row.ts), data.timeZone)),
      text: JSON.stringify(row, null, 2),
    }));
  };
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
  // 暂停或已完成的项目不再给今天出下一步；想法和进行中的照常。
  const shelved = new Set(
    status.projects.filter((p) => p.stage === "paused" || p.stage === "done").map((p) => p.file),
  );
  const next = status.modules
    .filter((module) => !shelved.has(module.file))
    .flatMap((module) =>
      (module.next ?? [])
        .filter((item) => item.status === "todo" || item.status === "proposed")
        .map((item) => ({ ...item, module: module.module, file: module.file })),
    )
    .concat(
      (data.records.task ?? [])
        .filter((task) => task.status === "open")
        .map((task) => ({
          id: task.id,
          title: String(task.title),
          status: "todo" as const,
          due: typeof task.due === "string" ? task.due : undefined,
          module: "me",
          file: "task",
        })),
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
    ref: item.ref,
    ...("source" in item && typeof item.source === "string" ? { source: item.source } : {}),
    ...("by" in item && typeof item.by === "string" ? { by: item.by } : {}),
    proposed: item.status === "proposed",
    module: item.module,
    file: item.file,
    section: item.file.startsWith("health/")
      ? "health"
      : /^projects\//.test(item.file)
        ? "projects"
        : item.file.startsWith("feed/")
          ? "feed"
          : item.file.startsWith("me/")
            ? "me"
            : "today",
  }));
  const capturedNotes = [...inboxNotes(ws), ...inboxNotes(ws, "inbox/notes/done")];
  const capturedWeek = capturedNotes.filter(
    (note) =>
      note.kind === "capture" &&
      typeof note.date === "string" &&
      note.date >= status.recent7.from &&
      note.date <= data.today,
  ).length;
  const notes = capturedNotes
    .filter((note) => !note.path.startsWith("inbox/notes/done/"))
    .map((note) => ({
      file: note.path,
      text: note.content,
      status: note.kind === "capture" ? ("received" as const) : ("needs_review" as const),
    }));
  const directionSuggestions = (data.records.direction ?? []).filter(
    (row) => row.status === "suggested",
  ).length;
  const mapPendingImports = pendingExperienceImports(ws).length;
  const experiences = committedExperiences(ws, {
    onError: (error) => data.warnings.push(readWarning(error)),
  });
  const mapNeedsReview = experiences.filter(
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
  // 只看最近的版本：最近变化最多显示 30 条，不必每次读完整个版本历史。
  const versions = (await history(ws, { limit: 100 }))
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
  const directionState: Record<string, string> = {
    suggested: "还没探索",
    active: "在试",
    paused: "已暂停",
    archived: "已归档",
    dismissed: "已忽略",
  };
  const recordTitle = (row: { [key: string]: unknown }) => {
    for (const key of ["title", "name", "text", "summary", "topic"] as const) {
      const value = row[key];
      if (typeof value === "string" && value.trim()) return value.trim().replace(/\s+/g, " ");
    }
    return "";
  };
  const topicTitle = (topic: (typeof data.statuses)[number]) => {
    const titled = (topic.data as { title?: string }).title?.trim();
    if (titled) return titled;
    const heading = topic.body.match(/^#\s+(.+)$/m)?.[1]?.trim();
    if (heading) return heading;
    if (topic.data.progress?.label) return topic.data.progress.label;
    const parts = topic.file.split("/");
    return parts.length >= 2 ? (parts[parts.length - 2] ?? topic.file) : topic.file;
  };
  const keepPreview = (list: { at: number; line: string }[], at: number, line: string) => {
    if (!line) return;
    list.push({ at, line });
    list.sort((a, b) => b.at - a.at);
    if (list.length > 2) list.length = 2;
  };
  const bumpLatest = (current: { latest: string | null; at: number }, value: string | null | undefined) => {
    const at = value ? Date.parse(value) : Number.NaN;
    if (Number.isFinite(at) && at > current.at) {
      current.latest = value as string;
      current.at = at;
    }
  };
  const sections = data.modules.flatMap(({ dir, def }) => {
    const typed = Object.keys(def.records ?? {}).flatMap((type) => {
      if (["experience_batch", "experience_source", "finance_fx_rate"].includes(type)) return [];
      const rows = (type === "experience" ? experiences : (data.records[type] ?? [])) as Array<
        StoredRecord & { [key: string]: unknown }
      >;
      return rows.map((row) => ({ type, row }));
    });
    const records = typed.map((item) => item.row);
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
    // 扫一遍：最新时间 + 最近两条标题（财务与敏感记忆不进预览）。
    const latestState = { latest: null as string | null, at: Number.NEGATIVE_INFINITY };
    const previewRows: { at: number; line: string }[] = [];
    for (const record of records) bumpLatest(latestState, record.ts);
    for (const topic of topics) bumpLatest(latestState, topic.data.updated);
    if (def.id === "me") {
      for (const memory of data.memories) bumpLatest(latestState, memory.updated);
    }
    if (def.id !== "finance") {
      for (const { type, row } of typed) {
        const at = Date.parse(row.ts);
        if (!Number.isFinite(at)) continue;
        let line = recordTitle(row);
        if (!line) continue;
        if (type === "direction") {
          const state = directionState[String(row.status)] ?? "";
          line = state ? `${line} · ${state}` : line;
        } else if (type === "news_item" && typeof row.source === "string" && row.source.trim()) {
          line = `${line} · ${row.source.trim()}`;
        }
        keepPreview(previewRows, at, line);
      }
      for (const topic of topics) {
        const at = topic.data.updated ? Date.parse(topic.data.updated) : Number.NaN;
        keepPreview(previewRows, Number.isFinite(at) ? at : 0, topicTitle(topic));
      }
      if (def.id === "me") {
        for (const goal of data.goals) {
          const at = goal.due ? Date.parse(goal.due) : Number.NaN;
          keepPreview(previewRows, Number.isFinite(at) ? at : 0, goal.title.trim());
        }
        for (const memory of data.memories) {
          if (memory.sensitive) continue;
          const at = Date.parse(memory.updated);
          if (!Number.isFinite(at)) continue;
          keepPreview(previewRows, at, memory.name.trim() || memory.text.trim().slice(0, 40));
        }
      }
      if (def.id === "feed") {
        for (const digest of data.digests) {
          const stamp = digest.file.match(/(\d{4}-\d{2}-\d{2})/)?.[1];
          const at = stamp ? Date.parse(stamp) : Number.NaN;
          bumpLatest(latestState, stamp ?? null);
          const heading = digest.body.match(/^#\s+(.+)$/m)?.[1]?.trim();
          const name = digest.file.split("/").pop()?.replace(/\.md$/, "") ?? digest.file;
          keepPreview(previewRows, Number.isFinite(at) ? at : 0, heading || name);
        }
      }
    }
    return [
      {
        id: def.id,
        label: def.name,
        count,
        latest: latestState.latest,
        preview: previewRows.map((row) => row.line),
      },
    ];
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
    proposedTasks: (data.records.task ?? [])
      .filter((task) => task.status === "proposed")
      .map(({ id, title }) => ({ id, title: String(title) })),
    blocks: status.now.blocks,
    next: allNext.slice(0, 3),
    allNext,
    versions,
    plans: readPlans(data),
    capturedWeek,
    sync: {
      cloudOrganizer: organizerStatus(ws),
      received: pendingFiles + notes.filter((note) => note.status === "received").length,
      // 只有开了每日整理才说「等待整理」；没开时原文就是已保存，不暗示后台在处理。
      organizer: organizerOn(ws),
      needsReview:
        mapNeedsReview +
        mapPendingImports +
        directionSuggestions +
        notes.filter((note) => note.status === "needs_review").length,
      directionSuggestions,
      mapPendingImports,
      mapNeedsReview,
      updatedAt:
        versions.find((v) => !/保存了一条原文记录|等待整理|待整理笔记/.test(v.message))?.time ?? null,
    },
    daily: daily ? { ...daily, unresolved: dailyItems.length } : null,
    projects: status.projects
      .filter((p) => p.stage === "active")
      .map((p) => ({
        slug: p.slug,
        title: p.title,
        kind: p.kind,
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
