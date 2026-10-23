import { useState } from "react";
import type { NewsDiscussion, NewsItem, NewsPost, NewsTrend } from "../types.js";
import css from "./NewsPage.module.css";
import { useLocale, useT } from "./i18n.js";
function webUrl(value?: string): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : undefined;
  } catch {
    return undefined;
  }
}
export function NewsImage({
  src,
  className,
  source = "X",
}: { src?: string; className?: string; source?: string }) {
  const t = useT();
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
    <span
      className={`${className ?? ""} ${css.placeholder}`}
      role="img"
      aria-label={t(`${source} · 暂无图片`, `${source} · No image`)}
    >
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
  const t = useT();
  const locale = useLocale();
  const author = post.author || post.handle || "X";
  return (
    <article className={css.post} aria-label={t("X 原帖", "Original X post")}>
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
          {post.likes !== undefined && (
            <span>
              {t("点赞", "Likes")} {post.likes.toLocaleString(locale)}{" "}
            </span>
          )}
          {post.reposts !== undefined && (
            <span>
              {t("转发", "Reposts")} {post.reposts.toLocaleString(locale)}{" "}
            </span>
          )}
          {post.replies !== undefined && (
            <span>
              {t("回复", "Replies")} {post.replies.toLocaleString(locale)}{" "}
            </span>
          )}
        </span>
        {post.posted_at && (
          <time className={css.meta} dateTime={post.posted_at}>
            {new Date(post.posted_at).toLocaleString(locale)}
          </time>
        )}
        <NewsLink url={post.url}>{t("查看原帖 ↗", "View post ↗")}</NewsLink>
      </footer>
    </article>
  );
}
function Discussion({ rows }: { rows?: NewsDiscussion[] }) {
  const t = useT();
  if (!rows?.length) return null;
  return (
    <section className={css.discussion} aria-label={t("讨论", "Discussion")}>
      <h4>{t("讨论", "Discussion")}</h4>
      {rows.slice(0, 3).map((row) => (
        <div key={`${row.who}-${row.quote}`}>
          <p>{row.stance}</p>
          <blockquote>
            {t("「", "“")}
            {row.quote}
            {t("」", "”")}
            <cite> — {row.who}</cite>
          </blockquote>
        </div>
      ))}
    </section>
  );
}

export function NewsExtra({ item }: { item: NewsItem }) {
  const t = useT();
  const metadata = [
    item.author,
    item.authors?.join(t("、", ", ")),
    item.venue,
    item.version,
    item.channel,
    item.duration,
  ].filter(Boolean);
  return (
    <details className={css.rich}>
      <summary className={css.expandHint}>{t("来源与详情", "Sources and details")}</summary>
      <div className={css.expanded}>
        {item.image && <NewsImage src={item.image} className={css.image} source={item.source} />}
        {item.summary && <p>{item.summary}</p>}
        {item.comment && <p>{item.comment}</p>}
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
          <NewsLink url={item.url}>{t("阅读原文 ↗", "Read source ↗")}</NewsLink>
          {item.repo && <NewsLink url={item.repo}>{t("代码仓库 ↗", "Repository ↗")}</NewsLink>}
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
  const t = useT();
  const locale = useLocale();
  return (
    <details className={css.rich}>
      <summary className={css.trendLead}>
        <NewsImage src={trend.image ?? trend.samples?.[0]?.media?.[0]} className={css.trendImage} />
        <strong className={css.title}>{trend.topic}</strong>
        {trend.summary && <span className={css.summary}>{trend.summary}</span>}
        <span className={css.meta}>
          {trend.posts === undefined
            ? t("X 热门", "Trending on X")
            : t(
                `${trend.posts.toLocaleString(locale)} 条讨论`,
                `${trend.posts.toLocaleString(locale)} ${trend.posts === 1 ? "post" : "posts"}`,
              )}
        </span>
        <span className={css.expandHint}>{t("展开原帖与讨论", "Open posts and discussion")}</span>
      </summary>
      <div className={css.expanded}>
        {trend.samples?.map((post) => (
          <PostCard key={post.url} post={post} />
        ))}
        <Discussion rows={trend.discussion} />
        {trend.url && <NewsLink url={trend.url}>{t("查看话题 ↗", "View topic ↗")}</NewsLink>}
      </div>
    </details>
  );
}
