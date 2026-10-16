import { useCallback, useEffect, useState } from "react";
import type { NewsAction, NewsData, NewsFeedback, NewsItem } from "../types.js";
import { NewsExtra, NewsImage, TrendDetails } from "./NewsContent.js";
import { NewsRules } from "./NewsRules.js";
import css from "./Prototype.module.css";

export interface NewsPageProps {
  loadNews: () => Promise<NewsData>;
  subscribe?: (refresh: () => void) => () => void;
  tryNews: (id: string) => Promise<NewsAction>;
  dismissNews: (id: string) => Promise<NewsAction>;
  feedbackNews: (id: string, value: NewsFeedback | null) => Promise<Record<string, NewsFeedback>>;
  saveNewsKeywords: (keywords: string[]) => Promise<string[]>;
  suggestNewsKeywords?: () => Promise<string[]>;
  onPrompt: (text: string) => void;
}
const labels = { rss: "RSS", grok: "Grok", dot: "Dot", codex: "Codex", agent: "AI", user: "你" };
const kinds = {
  article: "文章",
  x_post: "X 帖子",
  paper: "论文",
  release: "发布",
  video: "视频",
  podcast: "播客",
  rss: "RSS",
};
function safeLink(value: string) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : undefined;
  } catch {
    return undefined;
  }
}
export function NewsPage(props: NewsPageProps) {
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
      const feedback = await props.feedbackNews(id, value);
      setData((current) => (current ? { ...current, feedback } : current));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };
  const card = (item: NewsItem) => {
    const vote = data?.feedback[item.id];
    const related = item.relevance?.ref || item.relevance?.reason;
    return (
      <article className={`${css.news} ${css.card}`} key={item.id}>
        <NewsImage src={item.image} className={css.thumb} source={kinds[item.kind ?? "article"]} />
        <div className={css.stack} style={{ gap: 6, minWidth: 0 }}>
          <span className={css.small}>
            {item.source} · {labels[item.via]} 采集
            {item.published_at ? ` · ${new Date(item.published_at).toLocaleDateString("zh-CN")}` : ""}
          </span>
          <h3>
            <a href={safeLink(item.url)} target="_blank" rel="noreferrer">
              {item.title}
            </a>
          </h3>
          <p>{item.summary || "这条资讯还没有摘要"}</p>
          <p className={css.comment}>{item.comment || "还没有对你的点评"}</p>
          <div className={css["news-foot"]}>
            <span className={css.chip}>和你有关：{related || "尚未标明具体关联"}</span>
            <button
              type="button"
              className={css.link}
              disabled={busy !== null || added.includes(item.id)}
              onClick={async () => {
                setBusy(item.id);
                setError("");
                try {
                  await props.tryNews(item.id);
                  setAdded((list) => [...list, item.id]);
                } catch (err) {
                  setError(err instanceof Error ? err.message : String(err));
                } finally {
                  setBusy(null);
                }
              }}
            >
              {added.includes(item.id) ? "已加到下一步 · 等你确认" : "加到下一步"}
            </button>
            {vote ? (
              <span className={css.small}>
                已记为{vote === "useful" ? "有用" : "不相关"}，下次生成关注方案时参考 ·{" "}
                <button
                  type="button"
                  className={css.link}
                  disabled={busy !== null}
                  onClick={() => void feedback(item.id, null)}
                >
                  撤销
                </button>
              </span>
            ) : (
              <span className={css["news-acts"]}>
                <button
                  type="button"
                  className={css.act}
                  disabled={busy !== null}
                  onClick={() => void feedback(item.id, "useful")}
                >
                  有用
                </button>
                <button
                  type="button"
                  className={css.act}
                  disabled={busy !== null}
                  onClick={() => void feedback(item.id, "irrelevant")}
                >
                  不相关
                </button>
              </span>
            )}
          </div>
          <NewsExtra item={item} />
        </div>
      </article>
    );
  };
  return (
    <section className={css.sec} aria-label="资讯">
      <div className={css["sec-head"]}>
        <h2 className={css.eyebrow}>AI 帮你找来的</h2>
        <button
          type="button"
          className={css.link}
          aria-expanded={rules}
          onClick={() => setRules((open) => !open)}
        >
          采集规则
        </button>
      </div>
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
        <p className={css.error} role="alert">
          {error}
          <button type="button" className={css.link} onClick={() => void refresh()}>
            重新读取
          </button>
        </p>
      )}
      {added.length > 0 && <output className={css.small}>已加到下一步，等你确认</output>}
      {!data ? (
        <p className={css.small}>正在读取资讯…</p>
      ) : !data.picked.length && !data.others.length ? (
        <p className={css.emptyState}>还没有采集到资讯。可在设置中开启资讯搜索，或让你连接的 AI 帮你找。</p>
      ) : (
        [...data.picked, ...data.others].map(card)
      )}
      {!!data?.trends.length && (
        <details>
          <summary className={css.link}>讨论与热门</summary>
          {data.trends.map((trend) => (
            <TrendDetails key={trend.id} trend={trend} />
          ))}
        </details>
      )}
    </section>
  );
}
