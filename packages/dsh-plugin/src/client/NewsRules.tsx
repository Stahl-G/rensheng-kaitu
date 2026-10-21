import { useState } from "react";
import css from "./NewsPage.module.css";
import { useT } from "./i18n.js";

export interface NewsRulesProps {
  keywords: string[];
  save: (keywords: string[]) => Promise<string[]>;
  suggest?: () => Promise<string[]>;
  onPrompt: (text: string) => void;
  onSaved: (keywords: string[]) => void;
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
    <section className={css.rules} aria-label={t("关注方向", "Interests")}>
      <h3>{t("关注方向", "Interests")}</h3>
      <p className={css.meta}>
        {baseline.length
          ? t(`当前关注：${baseline.join("、")}`, `Current interests: ${baseline.join(", ")}`)
          : t(
              "还没有关注方向。写下你想持续了解的主题。",
              "No interests yet. Add topics you want to keep up with.",
            )}
      </p>
      <label className={css.editor}>
        {t("每行一个方向，可增删改", "One interest per line; add, edit or remove any")}
        <textarea
          aria-label={t("关注方向，每行一个", "Interests, one per line")}
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
      <p className={css.meta}>
        {t(
          "资讯反馈会在生成下一版时一起参考，确认保存后用于后续采集。",
          "Your feedback helps shape the next news collection. Review and save these interests to use them.",
        )}
      </p>
      <div className={css.actions}>
        <button
          type="button"
          className={css.button}
          disabled={busy}
          onClick={() => {
            if (!props.suggest) {
              props.onPrompt(
                t(
                  "请按开图 feed/COLLECT.md 的采集规则，读取我的目标、项目、方向、所在地、当前关注方向和资讯反馈，提出 5–10 个关注关键词。只在对话里给草稿，不修改采集规则。我会复制到资讯的采集规则，查看差异后确认保存。",
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
          {!changed && <p>{t("与当前关注方向相同", "No changes to your interests")}</p>}
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
                  ? t("确认保存并清空关注方向", "Save and clear interests")
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
      {saved && <output className={css.saved}>{t("已保存关注方向", "Interests saved")}</output>}
    </section>
  );
}
