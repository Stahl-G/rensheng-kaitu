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
