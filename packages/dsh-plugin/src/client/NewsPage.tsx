import { directionText } from "@kaitu/core/direction-copy";
import { useCallback, useEffect, useState } from "react";
import type { NewsAction, NewsData, NewsFeedback, NewsItem, NewsVia } from "../types.js";
import { NewsExtra, TrendDetails } from "./NewsContent.js";
import css from "./NewsPage.module.css";
import { NewsRules } from "./NewsRules.js";
import { useLocale, useT } from "./i18n.js";

export interface NewsPageProps {
  loadNews: () => Promise<NewsData>;
  subscribe?: (refresh: () => void) => () => void;
  tryNews: (id: string) => Promise<NewsAction>;
  dismissNews: (id: string) => Promise<NewsAction>;
  feedbackNews: (id: string, value: NewsFeedback | null) => Promise<Record<string, NewsFeedback>>;
  saveNewsKeywords: (keywords: string[]) => Promise<string[]>;
  suggestNewsKeywords?: () => Promise<string[]>;
  onPrompt: (text: string) => void;
  onLearn?: (item: NewsItem) => void;
}

const viaNames: Record<NewsVia, string> = {
  rss: "RSS",
  grok: "Grok",
  dot: "Dot",
  codex: "Codex",
  agent: "AI",
  user: "你",
};

function safeLink(value: string) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function dayOf(item: NewsItem) {
  const raw = item.published_at ?? (item as { ts?: string }).ts ?? "";
  return raw.slice(0, 10);
}

function Source({ item }: { item: NewsItem }) {
  const t = useT();
  const locale = useLocale();
  return (
    <span className={css.source}>
      <span className={css.initial} data-via={item.via} aria-hidden="true">
        {Array.from(item.source)[0]?.toUpperCase() ?? "?"}
      </span>
      {item.source} · {item.via === "user" ? t("你", "You") : viaNames[item.via]}
      {item.published_at ? ` · ${new Date(item.published_at).toLocaleDateString(locale)}` : ""}
    </span>
  );
}

export function NewsPage(props: NewsPageProps) {
  const t = useT();
  const locale = useLocale();
  const [data, setData] = useState<NewsData | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [rules, setRules] = useState(false);
  const [added, setAdded] = useState<string[]>([]);
  const refresh = useCallback(async () => {
    try {
      setData(await props.loadNews());
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [props.loadNews]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => props.subscribe?.(() => void refresh()), [props.subscribe, refresh]);

  const feedback = async (id: string, value: NewsFeedback | null) => {
    setBusy(id);
    setError("");
    try {
      const next = await props.feedbackNews(id, value);
      setData((current) => (current ? { ...current, feedback: next } : current));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const tryItem = async (id: string) => {
    setBusy(id);
    setError("");
    try {
      await props.tryNews(id);
      setAdded((list) => [...list, id]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const pickedCard = (item: NewsItem) => {
    const vote = data?.feedback[item.id];
    const related = directionText(item.relevance?.reason || item.relevance?.ref, 180);
    return (
      <article key={item.id} className={css.card}>
        <div className={css.body}>
          <h3>
            <a href={safeLink(item.url)} target="_blank" rel="noreferrer">
              {item.title}
            </a>
          </h3>
          {item.summary && <p className={css.reason}>{item.summary.split(/(?<=[。！？!?])\s*/)[0]}</p>}
          <Source item={item} />
          <div className={css.cardFooter}>
            {related && (
              <span className={css.meta}>
                {t("和你有关：", "Relevant to you: ")}
                {related}
              </span>
            )}
            <span className={css.actions}>
              {props.onLearn && (
                <button type="button" className={css.button} onClick={() => props.onLearn?.(item)}>
                  {t("开始学习", "Start learning")}
                </button>
              )}
              <button
                type="button"
                className={css.button}
                disabled={busy !== null || added.includes(item.id)}
                onClick={() => void tryItem(item.id)}
              >
                {added.includes(item.id)
                  ? t("已加入 AI 建议", "Added as an AI suggestion")
                  : t("加到下一步", "Add to next steps")}
              </button>
              {vote ? (
                <button
                  type="button"
                  className={css.link}
                  disabled={busy !== null}
                  onClick={() => void feedback(item.id, null)}
                >
                  {vote === "useful" ? t("撤销有用", "Undo useful") : t("撤销不相关", "Undo not relevant")}
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    className={css.button}
                    disabled={busy !== null}
                    onClick={() => void feedback(item.id, "useful")}
                  >
                    {t("有用", "Useful")}
                  </button>
                  <button
                    type="button"
                    className={css.button}
                    disabled={busy !== null}
                    onClick={() => void feedback(item.id, "irrelevant")}
                  >
                    {t("不相关", "Not relevant")}
                  </button>
                </>
              )}
            </span>
          </div>
          <NewsExtra item={item} />
        </div>
      </article>
    );
  };

  const row = (item: NewsItem) => (
    <article key={item.id} className={css.other}>
      <div>
        <h3>
          <a href={safeLink(item.url)} target="_blank" rel="noreferrer">
            {item.title}
          </a>
        </h3>
        <Source item={item} />
        {props.onLearn && (
          <button type="button" className={css.button} onClick={() => props.onLearn?.(item)}>
            {t("开始学习", "Start learning")}
          </button>
        )}
      </div>
    </article>
  );

  const sources = data ? (Object.entries(data.sources) as [NewsVia, number][]) : [];
  const todayItems = data
    ? [...data.picked, ...data.others].filter((item) => {
        const day = dayOf(item);
        return !day || day >= data.date;
      })
    : [];
  const earlierItems = data
    ? [...data.picked, ...data.others].filter((item) => {
        const day = dayOf(item);
        return day && day < data.date;
      })
    : [];
  const todayPicked = todayItems.filter((item) => data?.picked.some((row) => row.id === item.id));
  const todayOthers = todayItems.filter((item) => !data?.picked.some((row) => row.id === item.id));

  return (
    <div className={css.page} aria-label={t("资讯", "News")}>
      <header className={css.header}>
        <div>
          <h1>
            <span className={css.dot} aria-hidden="true" />
            {t("资讯", "News")}
          </h1>
          <p className={css.subtitle}>
            {data
              ? `${new Intl.DateTimeFormat(locale, {
                  month: "long",
                  day: "numeric",
                  timeZone: "UTC",
                }).format(
                  new Date(`${data.date}T12:00:00Z`),
                )} · ${t(`今日 ${todayItems.length + data.trends.length} 条`, `${todayItems.length + data.trends.length} today`)}${earlierItems.length ? t(` · 更早 ${earlierItems.length} 条已收起`, ` · ${earlierItems.length} earlier, collapsed`) : ""}`
              : t("正在读取资讯…", "Loading news…")}
          </p>
        </div>
        <button
          type="button"
          className={css.button}
          aria-expanded={rules}
          onClick={() => setRules((open) => !open)}
        >
          {t("采集规则", "Collection rules")}
        </button>
      </header>
      {rules && data && (
        <NewsRules
          keywords={data.keywords ?? []}
          save={props.saveNewsKeywords}
          suggest={props.suggestNewsKeywords}
          onPrompt={props.onPrompt}
          onSaved={(keywords) => setData((current) => (current ? { ...current, keywords } : current))}
        />
      )}
      {error && (
        <p className={css.notice} role="alert">
          {error}
          <button type="button" className={css.link} onClick={() => void refresh()}>
            {t("重新读取", "Reload")}
          </button>
        </p>
      )}
      {added.length > 0 && (
        <output className={css.saved}>
          {t("已加入 AI 建议，去今天页采纳", "Added as an AI suggestion. Adopt it in Today.")}
        </output>
      )}
      {!data ? (
        <p className={css.empty}>{t("正在整理资讯…", "Loading news…")}</p>
      ) : (
        <div className={css.columns}>
          <div className={css.main}>
            {!data.picked.length && !data.others.length && !data.trends.length && (
              <section className={css.sideCard}>
                <h2>{t("从你关心的话题开始", "Start with what interests you")}</h2>
                <p className={css.empty}>
                  {t(
                    "这里留下你关心的资讯和原始来源。先添加一个关注话题。",
                    "Keep news you care about and its original sources here. Add an interest to get started.",
                  )}
                </p>
                <button type="button" className={css.button} onClick={() => setRules(true)}>
                  {t("添加关注话题", "Add an interest")}
                </button>
              </section>
            )}
            {!!todayPicked.length && (
              <section aria-label={t("和你有关", "Relevant to you")}>
                <div className={css.heading}>
                  <h2>
                    {t(`和你有关的 ${todayPicked.length} 条`, `Relevant to you · ${todayPicked.length}`)}
                  </h2>
                </div>
                <div className={css.picked}>{todayPicked.map(pickedCard)}</div>
              </section>
            )}
            {!!data.trends.length && (
              <section aria-label={t("讨论与热门", "Discussions and trends")}>
                <div className={css.heading}>
                  <h2>{t("讨论与热门", "Discussions and trends")}</h2>
                  <span className={css.meta}>
                    {t("原帖与讨论点开再看", "Open an item to see posts and discussions")}
                  </span>
                </div>
                <div className={css.trends}>
                  {data.trends.map((trend) => (
                    <div className={css.trend} key={trend.id}>
                      <TrendDetails trend={trend} />
                    </div>
                  ))}
                </div>
              </section>
            )}
            {!!todayOthers.length && (
              <section aria-label={t("今日其他", "More today")}>
                <div className={css.heading}>
                  <h2>{t("今日其他", "More today")}</h2>
                </div>
                {todayOthers.map(row)}
              </section>
            )}
            {!!earlierItems.length && (
              <details>
                <summary className={css.link}>
                  {t("昨日及更早", "Yesterday and earlier")} · {earlierItems.length}
                </summary>
                {earlierItems.map(row)}
              </details>
            )}
          </div>
          <aside className={css.aside}>
            <section className={css.sideCard} aria-label={t("你关注的", "Your interests")}>
              <div className={css.heading}>
                <h2>{t("你关注的", "Your interests")}</h2>
                <button type="button" className={css.link} onClick={() => setRules(true)}>
                  {t("编辑", "Edit")}
                </button>
              </div>
              <div className={css.tags}>
                {data.keywords?.map((word) => (
                  <span key={word} className={css.tag}>
                    {word}
                  </span>
                ))}
              </div>
              {!data.keywords?.length && (
                <p className={css.empty}>{t("还没有关注方向。", "No interests yet.")}</p>
              )}
            </section>
            <section className={css.sideCard} aria-label={t("新闻从哪来", "News sources")}>
              <div className={css.heading}>
                <h2>{t("新闻从哪来", "News sources")}</h2>
              </div>
              <p className={css.meta}>
                {sources.length
                  ? t(
                      `来自${sources.map(([via]) => (via === "user" ? "你保存的内容" : viaNames[via])).join("、")}，保留原始来源。`,
                      `From ${sources.map(([via]) => (via === "user" ? "your saved items" : viaNames[via])).join(", ")}, with original sources.`,
                    )
                  : t(
                      "你保存的文章和已连接来源的资讯会出现在这里。",
                      "Articles you save and news from connected sources appear here.",
                    )}
              </p>
              <details>
                <summary className={css.link}>{t("来源统计", "Source counts")}</summary>
                <dl className={css.sources}>
                  <div>
                    <dt>{t("订阅源", "Subscriptions")}</dt>
                    <dd>
                      {data.feedCount === null ? "—" : t(`${data.feedCount} 个`, String(data.feedCount))}
                    </dd>
                  </div>
                  {sources.map(([via, count]) => (
                    <div key={via}>
                      <dt>{via === "user" ? t("你", "You") : viaNames[via]}</dt>
                      <dd>{t(`${count} 条`, String(count))}</dd>
                    </div>
                  ))}
                </dl>
              </details>
            </section>
          </aside>
        </div>
      )}
    </div>
  );
}
