import { useEffect, useState } from "react";
import type { LearningCheckinInput, LearningTopic, LibraryData, StartLearningInput } from "../types.js";
import { DocumentBody } from "./DocumentBody.js";
import styles from "./LearningPage.module.css";
import css from "./Prototype.module.css";
import { useT } from "./i18n.js";

export interface LearningServices {
  loadLearning: (topic: string) => Promise<LearningTopic>;
  startLearning: (input: StartLearningInput) => Promise<LearningTopic & { versionError?: string }>;
  saveLearning: (input: LearningCheckinInput) => Promise<LearningTopic & { versionError?: string }>;
}
export type LearningSource = NonNullable<StartLearningInput["source"]>;
export function learningPrompt(topic: LearningTopic, english = false) {
  if (english)
    return `Use learn-topic to resume “${topic.title}”. First call kaitu_learning read for topic ${topic.topic} to read sources, actual understanding, unanswered questions and next steps. Ask ONE concrete question at a time and wait for my attempt. Use gradual hints and feedback across about 3–6 steps. Use kaitu_learning_card or kaitu_learning_widget only as useful aids after my attempt. Quizzes are graded inside the card; ask me to share my reasoning. Save only understanding I actually expressed, unresolved questions and one small next step. Do not infer mastery from your explanation or visuals. No PPT by default, no openmaic_generate or classroom upload. Consider installed openmaic_slide only if I explicitly request slides. Start with one question.`;
  return `使用 learn-topic 技能继续学习「${topic.title}」。先用 kaitu_learning read 读取主题 ${topic.topic} 的来源、笔记与下一步，不要另建主题。从上次真实理解和未解决问题接上，一次只问一个问题，等我回答后再反馈或给逐级提示，每轮约 3–6 步。需要时用 kaitu_learning_card 或 kaitu_learning_widget 辅助。最后引用我实际说出的理解，保存待解问题和一个小的下一步；不要把你的讲解当成我已掌握。小测在卡片内自判，若要讨论请我把答案告诉你。默认不做 PPT，不调用 openmaic_generate，不上传材料；我明确要求幻灯片时才考虑已安装的 openmaic_slide。现在先问一个和这个主题有关的具体问题。`;
}
export function LearningPage(
  props: LearningServices & {
    data: LibraryData | null;
    topic: string;
    onTopic: (topic: string) => void;
    source?: LearningSource;
    onSourceConsumed: () => void;
    onPrompt: (text: string) => void;
    onSaved: () => void;
  },
) {
  const t = useT();
  const [detail, setDetail] = useState<LearningTopic | null>(null);
  const [compose, setCompose] = useState(false);
  const [title, setTitle] = useState("");
  const [destination, setDestination] = useState("");
  const [url, setUrl] = useState("");
  const [material, setMaterial] = useState("");
  const [understanding, setUnderstanding] = useState("");
  const [questions, setQuestions] = useState("");
  const [next, setNext] = useState("");
  const [completed, setCompleted] = useState("");
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState("");
  const [busy, setBusy] = useState(false);
  const topics = props.data?.notes.filter((item) => item.file.startsWith("learning/")) ?? [];
  useEffect(() => {
    let active = true;
    setDetail(null);
    setError("");
    setUnderstanding("");
    setQuestions("");
    setNext("");
    setCompleted("");
    if (props.topic)
      void props
        .loadLearning(props.topic)
        .then((value) => {
          if (active) setDetail(value);
        })
        .catch((err) => {
          if (active) setError(String(err));
        });
    return () => {
      active = false;
    };
  }, [props.topic, props.loadLearning]);
  useEffect(() => {
    if (!props.source) return;
    setCompose(true);
    setTitle(props.source.title);
    setUrl(props.source.url ?? "");
    setMaterial(props.source.text ?? "");
    setDestination("");
  }, [props.source]);
  const create = async () => {
    setBusy(true);
    setError("");
    setReceipt("");
    try {
      const value = await props.startLearning({
        title: title.trim(),
        ...(destination ? { topic: destination } : {}),
        ...(url.trim() || material.trim()
          ? {
              source: {
                title: title.trim(),
                ...(url.trim() ? { url: url.trim() } : {}),
                ...(material.trim() ? { text: material.trim() } : {}),
              },
            }
          : {}),
      });
      props.onTopic(value.topic);
      setDetail(value);
      setCompose(false);
      props.onSourceConsumed();
      setReceipt(
        value.versionError ??
          t("主题与来源已保存，可以开始学习。", "Topic and source saved. Ready to learn."),
      );
      props.onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  const save = async () => {
    if (!detail) return;
    setBusy(true);
    setError("");
    setReceipt("");
    try {
      const value = await props.saveLearning({
        topic: detail.topic,
        understanding,
        questions,
        next,
        ...(completed ? { completedNextId: completed } : {}),
      });
      setDetail(value);
      setUnderstanding("");
      setQuestions("");
      setNext("");
      setCompleted("");
      setReceipt(
        value.versionError ??
          t("已保存理解、疑问与下一步。下次可接着学。", "Saved. You can pick up here next time."),
      );
      props.onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  const pending = detail?.next.filter((item) => ["todo", "proposed"].includes(item.status)) ?? [];
  return (
    <section className={styles.page} aria-label={t("学习主题", "Learning topics")}>
      <div className={styles.toolbar}>
        <h2>{t("学习主题", "Learning topics")}</h2>
        <button
          type="button"
          className={css.btn}
          onClick={() => {
            setCompose(true);
            setTitle("");
            setUrl("");
            setMaterial("");
            setDestination(props.topic);
          }}
        >
          {t("开始一个主题 / 添加资料", "Start a topic / add material")}
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      {receipt && <output>{receipt}</output>}
      {compose ? (
        <form
          className={`${css.card} ${styles.form}`}
          onSubmit={(event) => {
            event.preventDefault();
            void create();
          }}
        >
          <label>
            {t("主题 / 资料标题", "Topic / source title")}
            <input
              required
              maxLength={500}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <label>
            {t("保存到", "Save to")}
            <select value={destination} onChange={(event) => setDestination(event.target.value)}>
              <option value="">{t("新主题（同名会接着保存）", "New topic (same title resumes)")}</option>
              {topics.map((item) => (
                <option key={item.file} value={item.file.split("/")[1]}>
                  {item.title}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("来源链接（可选）", "Source URL (optional)")}
            <input type="url" value={url} onChange={(event) => setUrl(event.target.value)} />
          </label>
          <label>
            {t("已有摘要或粘贴的材料（可选）", "Existing summary or pasted material (optional)")}
            <textarea
              rows={5}
              maxLength={128 * 1024}
              value={material}
              onChange={(event) => setMaterial(event.target.value)}
            />
          </label>
          <p className={css.small}>
            {t(
              "保存到你的学习资料。链接不会自动下载；开始对话时，材料由你当前选择的 AI 阅读。",
              "Saved with your learning notes. Links are not downloaded automatically; your selected AI reads the material when you start a conversation.",
            )}
          </p>
          <div className={styles.toolbar}>
            <button className={css.btn} type="submit" disabled={busy}>
              {busy ? t("保存中…", "Saving…") : t("保存主题与资料", "Save topic and source")}
            </button>
            <button
              type="button"
              className={css.link}
              onClick={() => {
                setCompose(false);
                props.onSourceConsumed();
              }}
            >
              {t("取消", "Cancel")}
            </button>
          </div>
        </form>
      ) : (
        <>
          <div className={styles.topics}>
            {topics.map((item) => (
              <button
                type="button"
                className={css.btn}
                key={item.file}
                aria-pressed={props.topic === item.file.split("/")[1]}
                onClick={() => {
                  setReceipt("");
                  props.onTopic(item.file.split("/")[1] ?? "");
                }}
              >
                {item.title}
              </button>
            ))}
          </div>
          {!props.topic && (
            <p className={css.small}>
              {t(
                "选一个主题继续，或从文章开始。先回答，再用自己的话留下理解。",
                "Pick a topic to resume, or start from an article. Answer first, then save what you understand in your own words.",
              )}
            </p>
          )}
          {detail && (
            <div className={`${css.card} ${styles.form}`}>
              <h3>{detail.title}</h3>
              {!!pending.length && (
                <div>
                  <b>{t("接下来", "Next")}</b>
                  <ul>
                    {pending.map((item) => (
                      <li key={item.id}>{item.title}</li>
                    ))}
                  </ul>
                </div>
              )}
              <button
                type="button"
                className={css.btn}
                onClick={() => props.onPrompt(learningPrompt(detail, t("zh", "en") === "en"))}
              >
                {t("接着学：让 AI 问我一个问题", "Continue: ask me one question")}
              </button>
              <p className={css.small}>
                {t(
                  "可用概念卡、小测和互动模拟辅助；PPT 按需。",
                  "Concept cards, quizzes and simulations are available; slides are optional.",
                )}
              </p>
              <details>
                <summary>
                  {t(`来源资料（${detail.sources.length}）`, `Sources (${detail.sources.length})`)}
                </summary>
                {detail.sources.map((source) => (
                  <article key={source.file} className={styles.document}>
                    {source.url && (
                      <p>
                        <a href={source.url} target="_blank" rel="noreferrer">
                          {t("打开来源", "Open source")}
                        </a>
                      </p>
                    )}
                    <DocumentBody content={source.text} />
                  </article>
                ))}
              </details>
              <details open={!!detail.notes}>
                <summary>{t("上次留下的理解与问题", "Saved understanding and questions")}</summary>
                <article className={styles.document}>
                  <DocumentBody content={detail.notes || t("还没有学习记录。", "No learning notes yet.")} />
                </article>
              </details>
              <form
                className={styles.form}
                onSubmit={(event) => {
                  event.preventDefault();
                  void save();
                }}
              >
                <label>
                  {t("用自己的话：我现在怎么理解", "In my own words: what I understand")}
                  <textarea
                    rows={3}
                    maxLength={16384}
                    value={understanding}
                    onChange={(event) => setUnderstanding(event.target.value)}
                  />
                </label>
                <label>
                  {t("还没弄懂 / 想核实的问题", "Questions I still have")}
                  <textarea
                    rows={2}
                    maxLength={16384}
                    value={questions}
                    onChange={(event) => setQuestions(event.target.value)}
                  />
                </label>
                <label>
                  {t("一个小的下一步", "One small next step")}
                  <input maxLength={500} value={next} onChange={(event) => setNext(event.target.value)} />
                </label>
                {!!pending.length && (
                  <label>
                    {t("这次实际完成了（可选）", "Completed this time (optional)")}
                    <select value={completed} onChange={(event) => setCompleted(event.target.value)}>
                      <option value="">{t("暂不标完成", "Leave unchanged")}</option>
                      {pending.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.title}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <button
                  type="submit"
                  className={css.btn}
                  disabled={busy || !(understanding.trim() || questions.trim() || next.trim() || completed)}
                >
                  {busy ? t("保存中…", "Saving…") : t("保存这次学习", "Save this learning note")}
                </button>
              </form>
            </div>
          )}
        </>
      )}
    </section>
  );
}
