import { useCallback, useEffect, useRef, useState } from "react";
import type {
  NewsAction,
  NewsData,
  NewsDiscussion,
  NewsItem,
  NewsPost,
  NewsTrend,
  NewsVia,
} from "../types.js";
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
function webUrl(value?: string): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : undefined;
  } catch {
    return undefined;
  }
}
function NewsImage({ src, className, source = "X" }: { src?: string; className?: string; source?: string }) {
  const [failed, setFailed] = useState<string | null>(null);
  const url = webUrl(src);
  return url && url !== failed ? (
    <img
      src={url}
      className={className}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(url)}
    />
  ) : (
    <span className={`${className ?? ""} ${css.placeholder}`} role="img" aria-label={`${source} · 暂无图片`}>
      {Array.from(source)[0]?.toUpperCase() ?? "?"}
    </span>
  );
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
  const href = webUrl(url);
  return href ? (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ) : (
    <span>{children}</span>
  );
}

function PostCard({ post }: { post: NewsPost }) {
  const author = post.author || post.handle || "X";
  return (
    <article className={css.post} aria-label="X 原帖">
      <header className={css.postHeader}>
        <span className={css.avatar} aria-hidden="true">
          {Array.from(author)[0]}
        </span>
        <span>
          <strong>{author}</strong>
          {post.handle && <span className={css.meta}> {post.handle}</span>}
        </span>
      </header>
      {post.text && <p className={css.postText}>{post.text}</p>}
      {!!post.media?.length && (
        <div className={css.mediaGrid}>
          {post.media.map((src) => (
            <NewsImage key={src} src={src} className={css.postImage} source={author} />
          ))}
        </div>
      )}
      <footer className={css.postFooter}>
        <span className={css.meta}>
          {post.likes !== undefined && <span>点赞 {post.likes.toLocaleString("zh-CN")} </span>}
          {post.reposts !== undefined && <span>转发 {post.reposts.toLocaleString("zh-CN")} </span>}
          {post.replies !== undefined && <span>回复 {post.replies.toLocaleString("zh-CN")} </span>}
        </span>
        {post.posted_at && (
          <time className={css.meta} dateTime={post.posted_at}>
            {new Date(post.posted_at).toLocaleString("zh-CN")}
          </time>
        )}
        <NewsLink url={post.url}>查看原帖 ↗</NewsLink>
      </footer>
    </article>
  );
}
function Discussion({ rows }: { rows?: NewsDiscussion[] }) {
  if (!rows?.length) return null;
  return (
    <section className={css.discussion} aria-label="讨论">
      <h4>讨论</h4>
      {rows.slice(0, 3).map((row) => (
        <div key={`${row.who}-${row.quote}`}>
          <p>{row.stance}</p>
          <blockquote>
            「{row.quote}」<cite> — {row.who}</cite>
          </blockquote>
        </div>
      ))}
    </section>
  );
}
function NewsDetails({ item }: { item: NewsItem }) {
  const metadata = [
    item.author,
    item.authors?.join("、"),
    item.venue,
    item.version,
    item.channel,
    item.duration,
  ].filter(Boolean);
  return (
    <details className={css.rich}>
      <summary className={css.cardLead}>
        <NewsImage src={item.image} className={css.image} source={item.source} />
        <span className={css.body}>
          <strong className={css.title}>{item.title}</strong>
          {item.summary && <span className={css.summary}>{item.summary}</span>}
          <Source item={item} />
          <span className={css.expandHint}>展开内容</span>
        </span>
      </summary>
      <div className={css.expanded}>
        {!!item.details?.length && (
          <ul className={css.points}>
            {item.details.map((point) => (
              <li key={point}>{point}</li>
            ))}
          </ul>
        )}
        {item.post && <PostCard post={item.post} />}
        <Discussion rows={item.discussion} />
        {item.comment && (
          <section className={css.analysis}>
            <h4>
              开图的看法 <span className={css.ai}>AI 分析</span>
            </h4>
            <p>{item.comment}</p>
          </section>
        )}
        {metadata.length > 0 && <p className={css.meta}>{metadata.join(" · ")}</p>}
        {item.quote && (
          <blockquote>
            「{item.quote}」{item.author && <cite> — {item.author}</cite>}
          </blockquote>
        )}
        {!!item.highlights?.length && (
          <ul className={css.points}>
            {item.highlights.map((point) => (
              <li key={`${point.time}-${point.text}`}>
                <strong>{point.time}</strong> {point.text}
              </li>
            ))}
          </ul>
        )}
        <div className={css.sourceLinks}>
          <NewsLink url={item.url}>阅读原文 ↗</NewsLink>
          {item.repo && <NewsLink url={item.repo}>代码仓库 ↗</NewsLink>}
          {item.sources?.map((source) => (
            <NewsLink key={source.url} url={source.url}>
              {source.name}
            </NewsLink>
          ))}
          {item.published_at && (
            <time className={css.meta} dateTime={item.published_at}>
              {new Date(item.published_at).toLocaleString("zh-CN")}
            </time>
          )}
        </div>
      </div>
    </details>
  );
}
function TrendDetails({ trend }: { trend: NewsTrend }) {
  return (
    <details className={css.rich}>
      <summary className={css.trendLead}>
        <NewsImage src={trend.image ?? trend.samples?.[0]?.media?.[0]} className={css.trendImage} />
        <strong className={css.title}>{trend.topic}</strong>
        {trend.summary && <span className={css.summary}>{trend.summary}</span>}
        <span className={css.meta}>
          {trend.posts === undefined ? "X 热门" : `${trend.posts.toLocaleString("zh-CN")} 条讨论`}
        </span>
        <span className={css.expandHint}>展开原帖与讨论</span>
      </summary>
      <div className={css.expanded}>
        {trend.samples?.map((post) => (
          <PostCard key={post.url} post={post} />
        ))}
        <Discussion rows={trend.discussion} />
        {trend.url && <NewsLink url={trend.url}>查看话题 ↗</NewsLink>}
      </div>
    </details>
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
            发现
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
                      <NewsDetails item={item} />
                      <div className={css.body}>
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
              <details aria-label="热门话题">
                <summary className={css.link}>更多热门话题</summary>
                <div className={css.heading}>
                  <h2>X 热门</h2>
                </div>
                <div className={css.trends}>
                  {data.trends.map((trend) => (
                    <article className={css.trend} key={trend.id}>
                      <TrendDetails trend={trend} />
                    </article>
                  ))}
                </div>
                {!data.trends.length && (
                  <p className={css.empty}>暂无记录。可以请 Agent 整理你关注的话题。</p>
                )}
              </details>
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
                    <NewsDetails item={item} />
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
