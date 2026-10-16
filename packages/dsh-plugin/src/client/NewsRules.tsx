import { useState } from "react";
import css from "./NewsPage.module.css";

export interface NewsRulesProps {
  keywords: string[];
  save: (keywords: string[]) => Promise<string[]>;
  suggest?: () => Promise<string[]>;
  onPrompt: (text: string) => void;
  onSaved: (keywords: string[]) => void;
}
export function NewsRules(props: NewsRulesProps) {
  const [baseline, setBaseline] = useState(props.keywords);
  const [text, setText] = useState(props.keywords.join("\n"));
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const keywords = [
    ...new Set(
      text
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean),
    ),
  ];
  const added = keywords.filter((word) => !baseline.includes(word));
  const removed = baseline.filter((word) => !keywords.includes(word));
  const changed = added.length > 0 || removed.length > 0;
  const run = async (operation: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      await operation();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className={css.rules} aria-label="关注方向">
      <h3>关注方向</h3>
      <p className={css.meta}>
        {baseline.length ? `当前关注：${baseline.join("、")}` : "还没有关注方向。写下你想持续了解的主题。"}
      </p>
      <label className={css.editor}>
        每行一个方向，可增删改
        <textarea
          aria-label="关注方向，每行一个"
          rows={6}
          value={text}
          disabled={busy}
          onChange={(event) => {
            setText(event.target.value);
            setPreview(false);
            setSaved(false);
          }}
        />
      </label>
      <p className={css.meta}>资讯反馈会在生成下一版时一起参考，确认保存后用于后续采集。</p>
      <div className={css.actions}>
        <button
          type="button"
          className={css.button}
          disabled={busy}
          onClick={() => {
            if (!props.suggest) {
              props.onPrompt(
                "请按开图 feed/COLLECT.md 的采集规则，读取我的目标、项目、方向、所在地、当前关注方向和资讯反馈，提出 5–10 个关注关键词。只在对话里给草稿，不修改采集规则。我会复制到资讯的采集规则，查看差异后确认保存。",
              );
              return;
            }
            void run(async () => {
              const proposal = await props.suggest?.();
              if (proposal) {
                setText(proposal.join("\n"));
                setPreview(true);
              }
            });
          }}
        >
          {busy ? "正在整理…" : props.suggest ? "让 AI 结合反馈提议" : "在对话里生成方案"}
        </button>
        <button
          type="button"
          className={css.button}
          disabled={busy || !changed}
          onClick={() => setPreview(true)}
        >
          查看变化
        </button>
      </div>
      {preview && (
        <div className={css.diff} aria-label="方案变化">
          <h4>方案变化</h4>
          {added.length > 0 && <p>新增：{added.join("、")}</p>}
          {removed.length > 0 && <p>移除：{removed.join("、")}</p>}
          {!changed && <p>与当前关注方向相同</p>}
          {changed && (
            <div className={css.actions}>
              <button
                type="button"
                className={`${css.button} ${css.primary}`}
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const result = await props.save(keywords);
                    setBaseline(result);
                    setText(result.join("\n"));
                    setPreview(false);
                    setSaved(true);
                    props.onSaved(result);
                  })
                }
              >
                确认保存{keywords.length === 0 ? "并清空关注方向" : ""}
              </button>
              <button
                type="button"
                className={css.button}
                disabled={busy}
                onClick={() => {
                  setText(baseline.join("\n"));
                  setPreview(false);
                }}
              >
                放弃变化
              </button>
            </div>
          )}
        </div>
      )}
      {error && <p role="alert">{error}</p>}
      {saved && <output className={css.saved}>已保存关注方向</output>}
    </section>
  );
}
