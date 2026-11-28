type Group = "goal" | "background" | "history" | "context";
export interface ReadingEntry {
  group: Group;
  text: string;
  date?: string;
}

const labelGroups: Record<string, Group> = {
  当前目标: "goal",
  目标: "goal",
  下一步: "goal",
  goal: "goal",
  "current goal": "goal",
  "next step": "goal",
  背景: "background",
  相关背景: "background",
  已知现状: "background",
  现状: "background",
  background: "background",
  context: "background",
  "known context": "background",
  now: "background",
  历史: "history",
  历史想法: "history",
  历史考虑: "history",
  过去想法: "history",
  history: "history",
  "earlier ideas": "history",
  "past considerations": "history",
};
const date = "(\\d{4}-\\d{2}-\\d{2})";
const marker = new RegExp(
  `(?:【([^】\\r\\n]+)】|\\[([^\\]\\r\\n]+)\\]|(^|[\\r\\n])\\s*(${Object.keys(labelGroups).join("|")})\\s*[:：])`,
  "giu",
);

function classify(text: string, group: Group): Group {
  if (
    /^(?:(?:之前|过去|曾经|以前|当时)(?:想|考虑|设想|计划)|formerly\b|(?:previously|earlier)\s+(?:(?:i|we)\s+)?(?:considered|thought|planned)\b)/iu.test(
      text,
    )
  )
    return "history";
  if (
    /^(?:前提|条件|尚未|仍需|只有|除非|未确认|如果|only if\b|provided that\b|pending\b|subject to\b|if\b|unless\b)/iu.test(
      text,
    )
  )
    return "background";
  return group;
}

/** Keep the original wording; only interpret explicit labels and conservative time/condition prefixes. */
export function planReading(raw: string, initial: Group = "context"): ReadingEntry[] {
  const result: ReadingEntry[] = [];
  const seen = new Set<string>();
  let group = initial;
  let stamp: string | undefined;
  function append(chunk: string) {
    let currentDate = stamp;
    const statements = chunk.split(/(?<=[。！？；!?;])\s*|(?<=\.)\s+|\n+/u);
    for (const [index, statement] of statements.entries()) {
      const line = statement
        .trim()
        .replace(/^\s*(?:[-*•]\s+|[0-9]+[.)、]\s*)/u, "")
        .trim();
      const dated = new RegExp(`^${date}(?:\\s*[：:]\\s*|\\s+)(?=\\S)`, "u").exec(line);
      const text = (dated ? line.slice(dated[0].length) : line).trim();
      if (!text) continue;
      if (dated) currentDate = dated[1];
      const localDate = currentDate;
      // Unlabelled trailing statements are notes, not additional adopted goals.
      const kind = classify(text, group === "goal" && index > 0 ? "context" : group);
      const key = `${kind}\x1f${localDate ?? ""}\x1f${text.replace(/\s+/gu, " ").replace(/[。！？；.!?;]+$/u, "")}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push({ group: kind, text, ...(localDate ? { date: localDate } : {}) });
    }
  }
  let cursor = 0;
  for (const match of raw.matchAll(marker)) {
    const label = (match[1] ?? match[2] ?? match[4] ?? "").trim();
    const prefix = new RegExp(`^${date}\\s+`, "u").exec(label);
    const labelKey = (prefix ? label.slice(prefix[0].length) : label).toLowerCase();
    const next = Object.hasOwn(labelGroups, labelKey) ? labelGroups[labelKey] : undefined;
    if (!next) continue;
    append(raw.slice(cursor, match.index));
    group = next;
    stamp = prefix?.[1];
    cursor = match.index + match[0].length;
  }
  append(raw.slice(cursor));
  return result;
}

/** A compact exact quotation, not an AI summary or a changed instruction. */
export function planHeadline(raw: string, max = 64) {
  // Scan only a bounded amount of legacy paste for list/card display. Details keep every character.
  const entries = planReading(raw.slice(0, 4096), "goal");
  const text = (entries.find((entry) => entry.group === "goal") ?? entries[0])?.text ?? raw.trim();
  const clean = text.replace(/\s+/gu, " ");
  if (clean.length <= max) return clean;
  const clauses = clean.split(/(?<=[，、,:：])\s*/u);
  const lead = clauses[0]?.replace(/[，、,:：]$/u, "") ?? "";
  // Prefer the first complete statement. Otherwise use a word boundary or grapheme boundary.
  if (lead.length >= max / 3 && lead.length <= max) return lead;
  const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  let end = 0;
  for (const part of segmenter.segment(clean)) {
    if (part.index >= max) break;
    end = part.index + part.segment.length;
  }
  const excerpt = clean.slice(0, end);
  const wordBreak = /^(.*)\s+\S*$/u.exec(excerpt)?.[1];
  return `${wordBreak && wordBreak.length > max * 0.75 ? wordBreak : excerpt}…`;
}
