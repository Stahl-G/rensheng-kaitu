import type { OverviewNext } from "../types.js";
import type { Locale } from "./i18n.js";

const paths = /(?<![\w:/.-])(?:[A-Za-z]:[\\/]|~?\/|[\w.-]+\/)[^\s（）(),，;；、。！？]*\.[a-z][a-z0-9]*\b/gi;
const technicalField = /\b(?:source|ref|record_?id)\s*[:=：]\s*[^\s,，;；()（）]+/gi;
const recordID = /\b[0-9A-HJKMNP-TV-Z]{26}\b/i;

/** Display only: actions and Agent context keep the original item. */
export function nextPresentation(
  item: Pick<OverviewNext, "title" | "source" | "by" | "ref">,
  locale: Locale = "zh-CN",
) {
  const files = item.title.match(paths) ?? [];
  const origins = [item.source, item.by, item.ref, ...files];
  let actor: string | undefined;
  for (const [index, value] of origins.entries()) {
    if (!value) continue;
    actor =
      (index < 2 && /^[A-Za-z][\w -]*$/.test(value) && !/^(user|agent|unknown)$/i.test(value)
        ? value
        : undefined) ??
      /(?:^|[/\\])([\w-]+)-\d{8}T\d+/i.exec(value)?.[1] ??
      (/^grok(?:[- ]?bot)?$/i.test(value) ? value : undefined);
    if (actor) break;
  }
  if (actor && /^grok(?:[- ]?bot)?$/i.test(actor)) actor = "Grokbot";
  if (actor && /^chatgpt$/i.test(actor)) actor = "ChatGPT";
  const source = actor ? (locale === "en" ? `Provided by ${actor}` : `${actor} 提供`) : undefined;
  const processingOnly = /^本机处理(?:中\d+条和?)+只有日期的待核实资讯[。.!！]?$/;
  if (source && files.length && processingOnly.test(item.title.replace(paths, "").replace(/\s/g, "")))
    return { title: source, source };
  const title = item.title
    .replace(/（[^（）]*）|\([^()]*\)/g, (note) => {
      if (note.search(paths) < 0 && !recordID.test(note) && note.search(technicalField) < 0) return note;
      const content = note
        .slice(1, -1)
        .replace(technicalField, "")
        .replace(recordID, "")
        .replace(paths, locale === "en" ? "notes" : "资料")
        .replace(/^[\s,，;；]+|[\s,，;；]+$/g, "");
      if (!content) return "";
      return `${note[0]}${content}${note.at(-1)}`;
    })
    .replace(paths, locale === "en" ? "notes" : "资料")
    .trim();
  return { title, source };
}

/** Display choices keep the original next step and never invent a duration. */
export function todayChoices(data: import("../types.js").OverviewData, energy: number) {
  if (energy === 5) return [];
  return data.allNext
    .flatMap((item) => {
      if (item.proposed) return [];
      const goal =
        data.plans.goals.find((goal) => goal.next?.id === item.id)?.title ??
        Object.values(data.plans.sources).find((entry) => entry.taskId === item.id)?.goalTitle;
      if (!goal) return [];
      const match = /(\d+)\s*(分钟|小时|minutes?|mins?|hours?|hrs?)/i.exec(item.title);
      const minutes = match ? Number(match[1]) * (/小时|hours?|hrs?/i.test(match[2] ?? "") ? 60 : 1) : null;
      return [{ item, goal, minutes, opening: energy === 10 && (minutes === null || minutes > 10) }];
    })
    .slice(0, 3);
}

/** Use the workspace's already-resolved local day, including near UTC midnight. */
export function todayDate(day: string, locale: Locale, short = false) {
  return new Intl.DateTimeFormat(locale, {
    timeZone: "UTC",
    month: short ? "numeric" : "long",
    day: "numeric",
    ...(short ? {} : { weekday: "long" as const }),
  })
    .format(new Date(`${day}T12:00:00Z`))
    .replace(/日(星期)/, "日 $1");
}

export function todaySourceGroups(
  metric: import("../types.js").OverviewMetric,
  timeZone: string,
  locale: Locale,
) {
  const groups = new Map<string, { day: string; label: string; rows: Record<string, unknown>[] }>();
  const dayFormat = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  try {
    for (const entry of metric.sources) {
      const row = JSON.parse(entry.text) as Record<string, unknown>;
      const at = new Date(String(metric.key === "sleep" ? row.end : row.ts));
      if (!Number.isFinite(at.getTime()) || typeof row.id !== "string") return [];
      const parts = Object.fromEntries(dayFormat.formatToParts(at).map((part) => [part.type, part.value]));
      const day = `${parts.year}-${parts.month}-${parts.day}`;
      const key = metric.key === "workouts" ? `${day}:${row.session_id ?? row.id}` : day;
      const group = groups.get(key) ?? { day, label: todayDate(day, locale, true), rows: [] };
      group.rows.push(row);
      groups.set(key, group);
    }
  } catch {
    return [];
  }
  const result = [...groups.values()];
  if (metric.key === "workouts" && result.length !== metric.value) return [];
  return result.map((group) => ({
    ...group,
    label: `${group.label} · ${metric.key === "workouts" ? [...new Set(group.rows.map((row) => String(row.exercise ?? "")))].filter(Boolean).join("、") : metric.key === "sleep" ? (locale === "en" ? "Sleep" : "睡眠") : metric.key === "protein" ? (locale === "en" ? "Meals" : "饮食") : locale === "en" ? "Weight" : "体重"}`,
  }));
}

/** Only dated, nonempty past log entries can become a project fact. */
export function todayProjectFacts(projects: import("../types.js").DoingProject[], today: string) {
  return projects
    .filter((project): project is typeof project & { recentLog: { date: string; text: string } } => {
      const log = project.recentLog;
      return (
        project.stage === "active" &&
        !!log?.text.trim() &&
        /^\d{4}-\d{2}-\d{2}$/.test(log.date) &&
        Number.isFinite(Date.parse(`${log.date}T12:00:00Z`)) &&
        new Date(`${log.date}T12:00:00Z`).toISOString().slice(0, 10) === log.date &&
        log.date <= today
      );
    })
    .sort((a, b) => b.recentLog.date.localeCompare(a.recentLog.date))
    .slice(0, 1);
}
