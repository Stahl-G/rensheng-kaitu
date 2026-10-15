import { useCallback, useEffect, useRef, useState } from "react";
import type { NewsAction, NewsData, NewsItem, NewsVia } from "../types.js";
import css from "./NewsPage.module.css";

export interface NewsPageProps {
  loadNews: () => Promise<NewsData>;
  tryNews: (id: string) => Promise<NewsAction>;
  dismissNews: (id: string) => Promise<NewsAction>;
  onPrompt: (text: string) => void;
}
const viaNames: Record<NewsVia, string> = {
  rss: "RSS",
  grok: "Grok",
  dot: "Dot",
  codex: "Codex",
  agent: "Agent",
  user: "你",
};
const areas: Record<string, string> = {
  today: "今天",
  health: "健康",
  projects: "在做的事",
  feed: "资讯",
  me: "关于我",
};
const focusPrompt = "我想调整资讯关注点：";
function NewsImage({ src, className }: { src?: string; className?: string }) {
  const [failed, setFailed] = useState<string | null>(null);
  return src && src !== failed ? (
    <img src={src} className={className} alt="" loading="lazy" onError={() => setFailed(src)} />
  ) : null;
}
function Source({ item }: { item: NewsItem }) {
  return (
    <span className={css.source}>
      <span className={css.initial} data-via={item.via} aria-hidden="true">
        {Array.from(item.source)[0]?.toUpperCase() ?? "?"}
      </span>
      {item.source || "暂无记录"} · {viaNames[item.via]}
    </span>
  );
}
function NewsLink({ url, children }: { url?: string; children: string }) {
  return url ? (
    <a href={url} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ) : (
    <span>{children}</span>
  );
}

export function NewsPage({ loadNews, tryNews, dismissNews, onPrompt }: NewsPageProps) {
  const [data, setData] = useState<NewsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [actions, setActions] = useState<Record<string, NewsAction["status"]>>({});
  const [pending, setPending] = useState<string[]>([]);
  const inFlight = useRef(new Set<string>());
  const sequence = useRef(0);
  const refresh = useCallback(async () => {
    const seq = ++sequence.current;
    setError(null);
    try {
      const result = await loadNews();
      if (seq === sequence.current) {
        setData(result);
        setActions({});
      }
    } catch (err) {
      if (seq === sequence.current) setError(err instanceof Error ? err.message : String(err));
    }
  }, [loadNews]);
  useEffect(() => {
    void refresh();
    return () => {
      sequence.current++;
    };
  }, [refresh]);
  const ask = () => {
    try {
      onPrompt(focusPrompt);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };
  const act = async (item: NewsItem, status: NewsAction["status"]) => {
    if (inFlight.current.has(item.id)) return;
    inFlight.current.add(item.id);
    setPending([...inFlight.current]);
    setError(null);
    setActions((current) => ({ ...current, [item.id]: status }));
    try {
      await (status === "tried" ? tryNews(item.id) : dismissNews(item.id));
    } catch (err) {
      setActions((current) => {
        const next = { ...current };
        delete next[item.id];
        return next;
      });
      setError(`操作没成功，已恢复这条资讯：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      inFlight.current.delete(item.id);
      setPending([...inFlight.current]);
    }
  };
  const sources = data ? (Object.entries(data.sources) as [NewsVia, number][]) : [];
  const names = sources.filter(([, count]) => count > 0).map(([via]) => viaNames[via]);
  const organizers =
    names.length > 1
      ? `${names.slice(0, -1).join("、")} 和 ${names.at(-1)} 一起整理`
      : names.length
        ? `${names[0]} 整理`
        : "来源暂无记录";
  const picked = data?.picked.filter((item) => actions[item.id] !== "dismissed") ?? [];
  return (
    <div className={css.page} aria-busy={!data && !error}>
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
                )} · ${organizers} · 读了 ${sources.reduce((sum, [, count]) => sum + count, 0)} 条，挑出 ${data.picked.length} 条和你有关`
              : "正在读取资讯…"}
          </p>
        </div>
        <button type="button" className={css.button} onClick={ask}>
          换个关注点
        </button>
      </header>
      {error && (
        <p className={css.notice} role="alert">
          {error}
          {!data && (
            <button type="button" className={css.link} onClick={() => void refresh()}>
              重新读取
            </button>
          )}
        </p>
      )}
      {!data ? (
        <p className={css.empty}>{error ? "资讯读取失败，请重试。" : "正在整理资讯…"}</p>
      ) : (
        <>
          <div className={css.columns}>
            <div className={css.main}>
              <section aria-label="和你有关">
                <div className={css.heading}>
                  <h2>和你有关的 {picked.length} 条</h2>
                </div>
                <div className={css.picked}>
                  {picked.map((item) => (
                    <article key={item.id} className={css.card} aria-busy={pending.includes(item.id)}>
                      <NewsImage src={item.image} className={css.image} />
                      <div className={css.body}>
                        <Source item={item} />
                        <h3>
                          <NewsLink url={item.url}>{item.title}</NewsLink>
                        </h3>
                        <p className={css.reason}>{item.relevance?.reason || "暂无记录"}</p>
                        <div className={css.cardFooter}>
                          <span className={css.meta}>
                            和你有关：
                            {item.relevance
                              ? `${areas[item.relevance.module] ?? data.moduleNames[item.relevance.module] ?? "暂无记录"}${item.relevance.ref ? ` · ${item.relevance.ref}` : ""}`
                              : "暂无记录"}
                          </span>
                          {actions[item.id] === "tried" ? (
                            <output className={css.saved}>
                              {pending.includes(item.id) ? "正在加入下一步…" : "已加入下一步"}
                            </output>
                          ) : (
                            <span className={css.actions}>
                              <button
                                type="button"
                                className={`${css.button} ${css.primary}`}
                                onClick={() => void act(item, "tried")}
                              >
                                试一下
                              </button>
                              <button
                                type="button"
                                className={css.button}
                                onClick={() => void act(item, "dismissed")}
                              >
                                不相关
                              </button>
                            </span>
                          )}
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
                {!picked.length && (
                  <p className={css.empty}>暂无记录。和开图聊聊你最近关注的事，再请它整理资讯。</p>
                )}
              </section>
              <section aria-label="X 热门">
                <div className={css.heading}>
                  <h2>X 热门</h2>
                  {data.trends.some((trend) => trend.via === "grok") && (
                    <span className={css.meta}>Grok 每 2 小时更新</span>
                  )}
                </div>
                <div className={css.trends}>
                  {data.trends.map((trend) => (
                    <article className={css.trend} key={trend.id}>
                      <NewsImage src={trend.image} className={css.trendImage} />
                      <h3>
                        <NewsLink url={trend.url}>{trend.topic}</NewsLink>
                      </h3>
                      <span className={css.meta}>
                        {trend.posts === undefined
                          ? "讨论数暂无记录"
                          : `${trend.posts.toLocaleString("zh-CN")} 条讨论`}
                      </span>
                    </article>
                  ))}
                </div>
                {!data.trends.length && (
                  <p className={css.empty}>暂无记录。可以请 Agent 整理你关注的话题。</p>
                )}
              </section>
              <section aria-label="其他新闻">
                <div className={css.heading}>
                  <h2>其他新闻</h2>
                  {data.others.length > 4 && (
                    <button
                      type="button"
                      className={css.link}
                      aria-expanded={expanded}
                      onClick={() => setExpanded(!expanded)}
                    >
                      {expanded ? "收起" : `全部 ${data.others.length} 条`}
                    </button>
                  )}
                </div>
                {(expanded ? data.others : data.others.slice(0, 4)).map((item) => (
                  <article key={item.id} className={css.other}>
                    <NewsImage src={item.image} className={css.thumbnail} />
                    <div>
                      <h3>
                        <NewsLink url={item.url}>{item.title}</NewsLink>
                      </h3>
                      <Source item={item} />
                    </div>
                  </article>
                ))}
                {!data.others.length && (
                  <p className={css.empty}>暂无记录。请开图读取订阅源，整理最新消息。</p>
                )}
              </section>
            </div>
            <aside className={css.aside}>
              <section className={css.sideCard} aria-label="你关注的">
                <div className={css.heading}>
                  <h2>你关注的</h2>
                  <button type="button" className={css.link} onClick={ask}>
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
                {!data.keywords?.length && (
                  <p className={css.empty}>暂无记录。点「编辑」告诉开图你想关注什么。</p>
                )}
              </section>
              <section className={css.sideCard} aria-label="新闻从哪来">
                <div className={css.heading}>
                  <h2>新闻从哪来</h2>
                </div>
                <dl className={css.sources}>
                  <div>
                    <dt>订阅源</dt>
                    <dd>{data.feedCount === null ? "暂无记录" : `${data.feedCount} 个`}</dd>
                  </div>
                  {sources.map(([via, count]) => (
                    <div key={via}>
                      <dt>{viaNames[via]}</dt>
                      <dd>{count} 条</dd>
                    </div>
                  ))}
                </dl>
                {!sources.length && <p className={css.empty}>暂无记录。请开图整理订阅源或收件箱。</p>}
                <p className={css.inbox}>
                  任何 Agent：随时投递{" "}
                  <button
                    type="button"
                    className={css.link}
                    onClick={() => {
                      try {
                        onPrompt("请帮我查看资讯收件箱，整理 Agent 投递的新闻。");
                      } catch (err) {
                        setError(err instanceof Error ? err.message : String(err));
                      }
                    }}
                  >
                    收件箱
                  </button>
                </p>
              </section>
            </aside>
          </div>
          <footer className={css.footnote}>
            「试一下」会把这条变成对应板块的下一步；「不相关」会让以后少推这类内容。
          </footer>
        </>
      )}
    </div>
  );
}
