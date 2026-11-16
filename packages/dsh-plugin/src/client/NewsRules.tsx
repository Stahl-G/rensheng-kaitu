import { useState } from "react";
import css from "./NewsPage.module.css";
import { useT } from "./i18n.js";

export interface NewsRulesProps {
  keywords: string[];
  save: (keywords: string[]) => Promise<string[]>;
  suggest?: () => Promise<string[]>;
  onPrompt: (text: string) => void;
  onSaved: (keywords: string[]) => void;
  onClose: () => void;
}
export function NewsRules(props: NewsRulesProps) {
  const t = useT();
  const [baseline, setBaseline] = useState(props.keywords);
  const [text, setText] = useState(props.keywords.join("\n"));
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const keywords = [
    ...new Set(
      text
        // 一行一个，也认顿号和逗号，不靠说明文字教格式。
        .split(/[\n、，,]/)
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
    <section className={css.rules} aria-label={t("关注话题", "Interests")}>
      <div className={css.heading}>
        <h3>{t("关注话题", "Interests")}</h3>
        <button type="button" className={css.link} onClick={props.onClose}>
          {t("收起", "Close")}
        </button>
      </div>
      <label className={css.editor}>
        <textarea
          aria-label={t("关注话题，每行一个", "Interests, one per line")}
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
      <div className={css.actions}>
        <button
          type="button"
          className={css.button}
          disabled={busy}
          onClick={() => {
            if (!props.suggest) {
              props.onPrompt(
                t(
                  "请按开图 feed/COLLECT.md 的采集规则，读取我的目标、项目、方向、所在地、当前关注话题和资讯反馈，提出 5–10 个关注话题。只在对话里给草稿，不修改采集规则。我会复制到资讯的关注话题，查看变化后确认保存。",
                  "Follow the collection rules in Kaitu feed/COLLECT.md. Read my goals, projects, directions, location, current interests and news feedback, then suggest 5–10 keywords. Draft them in chat without changing the rules. I will copy them into News, review the changes and save.",
                ),
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
          {busy
            ? t("正在整理…", "Preparing…")
            : props.suggest
              ? t("让 AI 结合反馈提议", "Ask AI to suggest interests")
              : t("在对话里生成方案", "Draft in Ask")}
        </button>
        <button
          type="button"
          className={css.button}
          disabled={busy || !changed}
          onClick={() => setPreview(true)}
        >
          {t("查看变化", "Review changes")}
        </button>
      </div>
      {preview && (
        <div className={css.diff} aria-label={t("方案变化", "Proposed changes")}>
          <h4>{t("方案变化", "Proposed changes")}</h4>
          {added.length > 0 && (
            <p>
              {t("新增：", "Added: ")}
              {added.join(t("、", ", "))}
            </p>
          )}
          {removed.length > 0 && (
            <p>
              {t("移除：", "Removed: ")}
              {removed.join(t("、", ", "))}
            </p>
          )}
          {!changed && <p>{t("与当前关注话题相同", "No changes to your interests")}</p>}
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
                {keywords.length === 0
                  ? t("确认保存并清空关注话题", "Save and clear interests")
                  : t("确认保存", "Save interests")}
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
                {t("放弃变化", "Discard changes")}
              </button>
            </div>
          )}
        </div>
      )}
      {error && <p role="alert">{error}</p>}
      {saved && <output className={css.saved}>{t("已保存关注话题", "Interests saved")}</output>}
    </section>
  );
}
