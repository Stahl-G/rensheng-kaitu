import { KaituError } from "./errors.js";
import { parseFrontmatter, stringifyFrontmatter } from "./frontmatter.js";
import { snapshot } from "./history.js";
import { listModules } from "./modules.js";
import { type NewsFeedback, readNewsFeedback } from "./news-feedback.js";
import { type StoredRecord, readRecords, updateRecord } from "./records.js";
import { schemas } from "./schema.js";
import { isoInZone, localDate, parseTs } from "./time.js";
import { ulid } from "./ulid.js";
import type { Workspace } from "./workspace.js";

export type NewsVia = "rss" | "grok" | "dot" | "codex" | "agent" | "user";
export interface NewsPost {
  author?: string;
  handle?: string;
  text?: string;
  url: string;
  media?: string[];
  likes?: number;
  reposts?: number;
  replies?: number;
  posted_at?: string;
}
export interface NewsDiscussion {
  stance: string;
  quote: string;
  who: string;
}
export interface NewsContent {
  kind?: "article" | "x_post" | "paper" | "release" | "video" | "podcast" | "rss";
  author?: string;
  quote?: string;
  authors?: string[];
  venue?: string;
  repo?: string;
  version?: string;
  channel?: string;
  duration?: string;
  highlights?: { time: string; text: string }[];
  sources?: { name: string; url: string }[];
  details?: string[];
  post?: NewsPost;
  discussion?: NewsDiscussion[];
  comment?: string;
  title: string;
  url: string;
  source: string;
  via: NewsVia;
  summary?: string;
  image?: string;
  published_at?: string;
  relevance?: { module: string; ref?: string; reason: string };
  status: "new" | "tried" | "dismissed";
}
export interface NewsItem extends StoredRecord, NewsContent {}
export interface TrendContent {
  summary?: string;
  samples?: NewsPost[];
  discussion?: NewsDiscussion[];
  topic: string;
  posts?: number;
  url?: string;
  image?: string;
  via: NewsVia;
}
export interface Trend extends StoredRecord, TrendContent {}
export interface NewsData {
  feedback: Record<string, NewsFeedback>;
  date: string;
  picked: NewsItem[];
  trends: Trend[];
  others: NewsItem[];
  sources: Partial<Record<NewsVia, number>>;
  keywords: string[] | null;
  feedCount: number | null;
  moduleNames: Record<string, string>;
}

function newsUrl(value: string): string {
  const url = new URL(value);
  for (const name of [...url.searchParams.keys()]) {
    if (name.toLowerCase().startsWith("utm_")) url.searchParams.delete(name);
  }
  url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString().replace(/\/$/, "");
}

export function mergeNewsRecord(
  type: string,
  record: StoredRecord,
  existing: StoredRecord[],
  timeZone: string,
): StoredRecord {
  if (type === "news_item") record.url = newsUrl(record.url as string);
  const urls = (row: StoredRecord) =>
    [row.url as string, ...((row.sources as NewsItem["sources"]) ?? []).map((source) => source.url)].map(
      newsUrl,
    );
  const current = existing.find((row) =>
    type === "news_item"
      ? urls(row).some((url) => urls(record).includes(url))
      : row.topic === record.topic &&
        localDate(parseTs(row.ts), timeZone) === localDate(parseTs(record.ts), timeZone),
  );
  if (!current) return record;
  const { id: _id, ts: _ts, by: _by, rev: _rev, ...fields } = record;
  const patch = Object.fromEntries(
    Object.entries(fields).filter(
      ([key, value]) =>
        (type === "trend" || current[key] === undefined || current[key] === null || current[key] === "") &&
        JSON.stringify(current[key]) !== JSON.stringify(value),
    ),
  );
  if (type === "news_item" && (record.sources || current.sources || record.url !== current.url)) {
    const combined = [
      { name: current.source as string, url: current.url as string },
      ...((current.sources as NewsItem["sources"]) ?? []),
      { name: record.source as string, url: record.url as string },
      ...((record.sources as NewsItem["sources"]) ?? []),
    ];
    const sources = [...new Map(combined.map((source) => [newsUrl(source.url), source])).values()];
    if (JSON.stringify(sources) !== JSON.stringify(current.sources)) patch.sources = sources;
  }
  if (!Object.keys(patch).length) return current;
  return { ...current, ...patch, by: record.by, rev: (current.rev ?? 1) + 1 };
}

function feedSettings(ws: Workspace) {
  return ws.exists("feed/feeds.json")
    ? ws.readJson<{ feeds?: unknown[]; keywords?: string[]; muted?: string[] }>("feed/feeds.json")
    : {};
}

export function readNews(ws: Workspace, now = new Date()): NewsData {
  const zone = ws.timeZone();
  const date = localDate(now, zone);
  const from = new Date(`${date}T00:00:00Z`);
  from.setUTCDate(from.getUTCDate() - 2);
  const firstDay = from.toISOString().slice(0, 10);
  const recent = (readRecords(ws, "news_item") as NewsItem[])
    .filter((row) => {
      const published = parseTs(row.published_at ?? row.ts);
      return localDate(published, zone) >= firstDay && published <= now;
    })
    .sort((a, b) => Date.parse(b.published_at ?? b.ts) - Date.parse(a.published_at ?? a.ts));
  const settings = feedSettings(ws);
  const muted = (settings.muted ?? []).map((word) => word.trim().toLowerCase()).filter(Boolean);
  const fresh = recent.filter((row) => row.status === "new");
  const picked = fresh
    .filter(
      (row) =>
        row.relevance &&
        !muted.some(
          (word) => row.source.toLowerCase().includes(word) || row.title.toLowerCase().includes(word),
        ),
    )
    .slice(0, 3);
  const chosen = new Set(picked.map((row) => row.id));
  const sources: NewsData["sources"] = {};
  for (const row of recent) sources[row.via] = (sources[row.via] ?? 0) + 1;
  return {
    date,
    feedback: readNewsFeedback(ws),
    picked,
    trends: (readRecords(ws, "trend", { from: date, to: date }) as Trend[]).reverse(),
    others: fresh.filter((row) => !chosen.has(row.id)),
    sources,
    keywords: settings.keywords ?? null,
    feedCount: settings.feeds?.length ?? null,
    moduleNames: Object.fromEntries(
      listModules(ws).flatMap(({ dir, def }) => [
        [dir, def.name],
        [def.id, def.name],
      ]),
    ),
  };
}

function findNews(ws: Workspace, id: string): NewsItem {
  const item = (readRecords(ws, "news_item") as NewsItem[]).find((row) => row.id === id);
  if (!item) throw new KaituError("找不到这条新闻", "NOT_FOUND");
  return item;
}

export async function tryNews(ws: Workspace, id: string) {
  const item = findNews(ws, id);
  const moduleId = item.relevance?.module ?? "me";
  const module = listModules(ws).find((entry) => entry.def.id === moduleId || entry.dir === moduleId);
  if (!module) throw new KaituError(`找不到模块「${moduleId}」`, "NOT_FOUND");
  const file = `${module.dir}/STATUS.md`;
  const { data, body } = ws.exists(file)
    ? parseFrontmatter(ws.readText(file))
    : { data: { updated: null } as Record<string, unknown>, body: "" };
  const validate = schemas().builtin("status.schema.json");
  if (!validate(data)) throw new KaituError("模块现状格式不合法", "BAD_STATUS");
  const next = (data.next ?? []) as { id: string; ref?: string }[];
  if (!next.some((step) => step.ref === id)) {
    data.next = [...next, { id: ulid(), title: item.title, status: "proposed", ref: id }];
    data.updated = isoInZone(new Date(), ws.timeZone());
    ws.writeText(file, stringifyFrontmatter(data, body));
  }
  const result =
    item.status === "tried"
      ? { record: item }
      : updateRecord(ws, "news_item", id, { status: "tried" }, { by: "user" });
  const version = await snapshot(ws, `你把资讯加到下一步，等待确认：${item.title}`);
  return { ...result, version };
}

export async function dismissNews(ws: Workspace, id: string) {
  const item = findNews(ws, id);
  const result =
    item.status === "dismissed"
      ? { record: item }
      : updateRecord(ws, "news_item", id, { status: "dismissed" }, { by: "user" });
  const version = await snapshot(ws, `你标记了不相关：${item.title}`);
  return { ...result, version };
}
