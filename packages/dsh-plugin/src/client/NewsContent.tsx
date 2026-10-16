import { useState } from "react";
import type { NewsDiscussion, NewsItem, NewsPost, NewsTrend } from "../types.js";
import css from "./NewsPage.module.css";
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

export function NewsExtra({ item }: { item: NewsItem }) {
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
      <summary className={css.expandHint}>来源与详情</summary>
      <div className={css.expanded}>
        {item.details?.map((detail) => (
          <p key={detail}>{detail}</p>
        ))}
        {item.post && <PostCard post={item.post} />}
        <Discussion rows={item.discussion} />
        {metadata.length > 0 && <p className={css.meta}>{metadata.join(" · ")}</p>}
        {item.quote && (
          <blockquote>
            {item.quote}
            <cite>{item.author}</cite>
          </blockquote>
        )}
        {item.highlights?.map((point) => (
          <p key={point.time}>
            <b>{point.time}</b> {point.text}
          </p>
        ))}
        <div className={css.sourceLinks}>
          <NewsLink url={item.url}>阅读原文 ↗</NewsLink>
          {item.repo && <NewsLink url={item.repo}>代码仓库 ↗</NewsLink>}
          {item.sources?.map((source) => (
            <NewsLink key={source.url} url={source.url}>
              {source.name}
            </NewsLink>
          ))}
        </div>
      </div>
    </details>
  );
}
export function TrendDetails({ trend }: { trend: NewsTrend }) {
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
