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

export function todayProjectDate(day: string, today: string, locale: Locale) {
  const days = (Date.parse(`${today}T12:00:00Z`) - Date.parse(`${day}T12:00:00Z`)) / 86400000;
  if (days === 0) return locale === "en" ? "today" : "今天";
  if (days === 1) return locale === "en" ? "yesterday" : "昨天";
  if (days > 1 && days < 7) return locale === "en" ? `${days} days ago` : `${days}天前`;
  return day.slice(0, 4) === today.slice(0, 4) ? todayDate(day, locale, true) : day;
}

function pastProjectLog(log: { date: string; text: string }, today: string) {
  return (
    !!log.text.trim() &&
    /^\d{4}-\d{2}-\d{2}$/.test(log.date) &&
    Number.isFinite(Date.parse(`${log.date}T12:00:00Z`)) &&
    new Date(`${log.date}T12:00:00Z`).toISOString().slice(0, 10) === log.date &&
    log.date <= today
  );
}

/** Prefer authored progress; a sync baseline or nonpositive count is not progress. */
export function todayProjectFacts(
  projects: import("../types.js").DoingProject[],
  today: string,
  locale: Locale = "zh-CN",
) {
  return projects
    .filter((project) => project.stage === "active")
    .flatMap((project) => {
      const logs = (
        project.log === undefined
          ? project.recentLog
            ? [project.recentLog]
            : []
          : project.log
              .split(/^##\s+/m)
              .slice(1)
              .map((section) => {
                const [date = "", ...lines] = section.split(/\r?\n/);
                return { date: date.trim(), text: lines.join("\n") };
              })
      )
        .filter((log) => pastProjectLog(log, today))
        .sort((a, b) => b.date.localeCompare(a.date));
      let automatic: { date: string; text: string } | undefined;
      for (const log of logs) {
        const authored: string[] = [];
        for (const line of log.text.replace(/<!--(?!\s*sync:)[\s\S]*?-->/g, "").split(/\r?\n/)) {
          const sync = /<!--\s*sync:([^\s>]+)\s*-->/.exec(line)?.[1];
          const text = line
            .replace(/<!--[\s\S]*?-->/g, "")
            .replace(/^\s*[-*+]\s+/, "")
            .trim();
          if (!text) continue;
          if (!sync) {
            authored.push(text);
            continue;
          }
          const count =
            sync === "words"
              ? /^字数 [\d,]+（\+([\d,]+)）$/.exec(text)?.[1]
              : sync === "commits"
                ? /^(\d+) 次提交：/.exec(text)?.[1]
                : undefined;
          const increment = Number(count?.replace(/,/g, ""));
          if (!automatic && Number.isFinite(increment) && increment > 0) {
            const amount = increment.toLocaleString(locale);
            automatic = {
              date: log.date,
              text:
                sync === "words"
                  ? locale === "en"
                    ? `Wrote ${amount} more words.`
                    : `多写了 ${amount} 字。`
                  : locale === "en"
                    ? `Added ${amount} commits.`
                    : `新增了 ${amount} 次提交。`,
            };
          }
        }
        if (authored.length)
          return [{ ...project, recentLog: { date: log.date, text: authored.slice(0, 2).join(" · ") } }];
      }
      return automatic ? [{ ...project, recentLog: automatic }] : [];
    })
    .sort((a, b) => b.recentLog.date.localeCompare(a.recentLog.date))
    .slice(0, 1);
}
