import { useCallback, useEffect, useState } from "react";
import type { NewsAction, NewsData, NewsFeedback, NewsItem, NewsVia } from "../types.js";
import { NewsExtra, NewsImage, TrendDetails } from "./NewsContent.js";
import css from "./NewsPage.module.css";
import { NewsRules } from "./NewsRules.js";
import { useT } from "./i18n.js";

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
  return (
    <span className={css.source}>
      <span className={css.initial} data-via={item.via} aria-hidden="true">
        {Array.from(item.source)[0]?.toUpperCase() ?? "?"}
      </span>
      {item.source} · {viaNames[item.via]}
      {item.published_at ? ` · ${new Date(item.published_at).toLocaleDateString("zh-CN")}` : ""}
    </span>
  );
}

export function NewsPage(props: NewsPageProps) {
  const t = useT();
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
    const related = item.relevance?.ref || item.relevance?.reason;
    return (
      <article key={item.id} className={css.card}>
        <NewsImage src={item.image} className={css.image} source={item.kind ?? "article"} />
        <div className={css.body}>
          <Source item={item} />
          <h3>
            <a href={safeLink(item.url)} target="_blank" rel="noreferrer">
              {item.title}
            </a>
          </h3>
          {item.summary && <p className={css.reason}>{item.summary}</p>}
          {item.comment && <p className={css.reason}>{item.comment}</p>}
          <div className={css.cardFooter}>
            {related && <span className={css.meta}>和你有关：{related}</span>}
            <span className={css.actions}>
              {props.onLearn && (
                <button type="button" className={css.button} onClick={() => props.onLearn?.(item)}>
                  {t("开始学习", "Start learning")}
                </button>
              )}
              <button
                type="button"
                className={`${css.button} ${css.primary}`}
                disabled={busy !== null || added.includes(item.id)}
                onClick={() => void tryItem(item.id)}
              >
                {added.includes(item.id) ? "已加到下一步" : "加到下一步"}
              </button>
              {vote ? (
                <button
                  type="button"
                  className={css.link}
                  disabled={busy !== null}
                  onClick={() => void feedback(item.id, null)}
                >
                  撤销{vote === "useful" ? "有用" : "不相关"}
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    className={css.button}
                    disabled={busy !== null}
                    onClick={() => void feedback(item.id, "useful")}
                  >
                    有用
                  </button>
                  <button
                    type="button"
                    className={css.button}
                    disabled={busy !== null}
                    onClick={() => void feedback(item.id, "irrelevant")}
                  >
                    不相关
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
      <NewsImage src={item.image} className={css.thumbnail} source={item.kind ?? "article"} />
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
    <div className={css.page} aria-label="资讯">
      <header className={css.header}>
        <div>
          <h1>
            <span className={css.dot} aria-hidden="true" />
            资讯
          </h1>
          <p className={css.subtitle}>
            {data
              ? `${new Intl.DateTimeFormat("zh-CN", {
                  month: "long",
                  day: "numeric",
                  timeZone: "UTC",
                }).format(
                  new Date(`${data.date}T12:00:00Z`),
                )} · 今日 ${todayItems.length + data.trends.length} 条${earlierItems.length ? ` · 更早 ${earlierItems.length} 条已收起` : ""}`
              : "正在读取资讯…"}
          </p>
        </div>
        <button
          type="button"
          className={css.button}
          aria-expanded={rules}
          onClick={() => setRules((open) => !open)}
        >
          采集规则
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
            重新读取
          </button>
        </p>
      )}
      {added.length > 0 && <output className={css.saved}>已加到下一步，等你确认</output>}
      {!data ? (
        <p className={css.empty}>正在整理资讯…</p>
      ) : !data.picked.length && !data.others.length && !data.trends.length ? (
        <p className={css.empty}>还没有采集到资讯。可在设置中开启资讯搜索，或让你连接的 AI 帮你找。</p>
      ) : (
        <div className={css.columns}>
          <div className={css.main}>
            {!!todayPicked.length && (
              <section aria-label="和你有关">
                <div className={css.heading}>
                  <h2>和你有关的 {todayPicked.length} 条</h2>
                </div>
                <div className={css.picked}>{todayPicked.map(pickedCard)}</div>
              </section>
            )}
            {!!data.trends.length && (
              <section aria-label="讨论与热门">
                <div className={css.heading}>
                  <h2>讨论与热门</h2>
                  <span className={css.meta}>原帖与讨论点开再看</span>
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
              <section aria-label="今日其他">
                <div className={css.heading}>
                  <h2>今日其他</h2>
                </div>
                {todayOthers.map(row)}
              </section>
            )}
            {!!earlierItems.length && (
              <details>
                <summary className={css.link}>昨日及更早 · {earlierItems.length}</summary>
                {earlierItems.map(row)}
              </details>
            )}
          </div>
          <aside className={css.aside}>
            <section className={css.sideCard} aria-label="你关注的">
              <div className={css.heading}>
                <h2>你关注的</h2>
                <button type="button" className={css.link} onClick={() => setRules(true)}>
                  编辑
                </button>
              </div>
              <div className={css.tags}>
                {data.keywords?.map((word) => (
                  <span key={word} className={css.tag}>
                    {word}
                  </span>
                ))}
              </div>
              {!data.keywords?.length && <p className={css.empty}>还没有关注方向。</p>}
            </section>
            <section className={css.sideCard} aria-label="新闻从哪来">
              <div className={css.heading}>
                <h2>新闻从哪来</h2>
              </div>
              <dl className={css.sources}>
                <div>
                  <dt>订阅源</dt>
                  <dd>{data.feedCount === null ? "—" : `${data.feedCount} 个`}</dd>
                </div>
                {sources.map(([via, count]) => (
                  <div key={via}>
                    <dt>{viaNames[via]}</dt>
                    <dd>{count} 条</dd>
                  </div>
                ))}
              </dl>
            </section>
          </aside>
        </div>
      )}
    </div>
  );
}
