import type { HandoverPack } from "@kaitu/core";
import { useEffect, useState } from "react";
import css from "./Prototype.module.css";
import { type Locale, useLocale, useT } from "./i18n.js";

function compose(pack: HandoverPack, include: string[]) {
  const body = pack.sections
    .filter((section) => include.includes(section.id) && section.lines.length)
    .map((section) => `## ${section.title}\n${section.lines.join("\n")}`);
  return [pack.header, ...body, pack.footer].join("\n\n");
}

async function copyText(text: string, fallback: HTMLTextAreaElement | null) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    fallback?.select();
    return false;
  }
}

/**
 * 「在原来的 AI 里继续」：手动接续，不需要 API Key。
 * 1. 预览、删减后复制资料包，粘贴到任意 AI；2. 把 AI 按格式回复的内容贴回来核对。
 */
export function HandoverPanel({
  loadHandover,
  onAnswer,
}: {
  loadHandover: (locale?: Locale) => Promise<HandoverPack>;
  onAnswer: (answer: string) => Promise<void>;
}) {
  const t = useT();
  const locale = useLocale();
  const [pack, setPack] = useState<HandoverPack | null>(null);
  const [include, setInclude] = useState<string[]>([]);
  const [text, setText] = useState("");
  const [answer, setAnswer] = useState("");
  const [copied, setCopied] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [area, setArea] = useState<HTMLTextAreaElement | null>(null);
  const [pending, setPending] = useState<{ id: string; on: boolean } | null>(null);
  useEffect(() => {
    let active = true;
    void loadHandover(locale)
      .then((value) => {
        if (!active) return;
        const ids = value.sections.filter((section) => section.defaultOn).map((section) => section.id);
        setPack(value);
        setInclude(ids);
        setText(compose(value, ids));
      })
      .catch((err) => active && setError(err instanceof Error ? err.message : String(err)));
    return () => {
      active = false;
    };
  }, [loadHandover, locale]);
  // 用户删改过文字后，换勾选不能悄悄按原始资料重写：删掉的私人内容会回来。
  const edited = !!pack && text !== compose(pack, include);
  const apply = (id: string, on: boolean) => {
    if (!pack) return;
    const next = on ? [...include, id] : include.filter((item) => item !== id);
    setInclude(next);
    setText(compose(pack, next));
    setCopied("");
    setPending(null);
  };
  const toggle = (id: string, on: boolean) => {
    if (edited) setPending({ id, on });
    else apply(id, on);
  };
  return (
    <section className={`${css.card} ${css["sub-form"]} ${css.handover}`} aria-labelledby="handover-title">
      <span className={css.eyebrow}>{t("在原来的 AI 里继续", "Keep going in your own AI")}</span>
      <h2 id="handover-title">
        {t("把近况带给你常用的 AI", "Bring where you are to the AI you already use")}
      </h2>
      <p className={css.small}>
        {t(
          "复制下面的资料包，粘贴到 ChatGPT、豆包、Kimi、DeepSeek 等任何 AI 的对话里。聊完对它说「整理给开图」，再把回答贴回来。不需要 API Key。",
          'Copy the context pack below into a chat with ChatGPT, Claude, Gemini or any other AI. When you are done, say "update Kaitu" and paste its answer back here. No API key needed.',
        )}
      </p>
      {error && (
        <p role="alert" className={css.error}>
          {error}
        </p>
      )}
      {!pack ? (
        !error && <p className={css.small}>{t("正在整理资料包…", "Putting the pack together…")}</p>
      ) : (
        <>
          <b>{t("1 · 选要带上的内容", "1 · Choose what to bring")}</b>
          <fieldset className={css.handoverSections}>
            <legend className={css.sr}>{t("资料包内容", "Pack contents")}</legend>
            {pack.sections.map((section) => (
              <label key={section.id} data-empty={!section.lines.length}>
                <input
                  type="checkbox"
                  checked={include.includes(section.id)}
                  disabled={!section.lines.length}
                  onChange={(event) => toggle(section.id, event.target.checked)}
                />
                {section.title}
                <span className={css.small}>
                  {section.lines.length
                    ? t(` · ${section.lines.length} 条`, ` · ${section.lines.length}`)
                    : t(" · 还没有", " · none yet")}
                </span>
              </label>
            ))}
          </fieldset>
          {pending && (
            <div role="alertdialog" aria-labelledby="handover-rebuild" className={css["sub-form"]}>
              <p id="handover-rebuild" className={css.small}>
                {t(
                  "你改过下面的文字。换勾选会按勾选重新生成资料包，你的删改会丢掉。",
                  "You edited the text below. Changing what to bring rebuilds the pack from your choices and drops your edits.",
                )}
              </p>
              <div className={css["dialog-foot"]}>
                <button type="button" className={css.link} onClick={() => setPending(null)}>
                  {t("保留我的修改", "Keep my edits")}
                </button>
                <button
                  type="button"
                  className={`${css.btn} ${css["btn-quiet"]}`}
                  onClick={() => apply(pending.id, pending.on)}
                >
                  {t("重新生成", "Rebuild")}
                </button>
              </div>
            </div>
          )}
          <p className={css.small}>{pack.excluded}</p>
          <label htmlFor="handover-text" className={css.small}>
            {t("可以在这里删改后再复制", "You can edit it here before copying")}
          </label>
          <textarea
            id="handover-text"
            ref={setArea}
            rows={10}
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              setCopied("");
            }}
          />
          <div className={css["dialog-foot"]}>
            {copied && <output className={css.small}>{copied}</output>}
            <button
              type="button"
              className={`${css.btn} ${css["btn-primary"]}`}
              onClick={() =>
                void copyText(text, area).then((ok) =>
                  setCopied(
                    ok
                      ? t("已复制，去你的 AI 里粘贴", "Copied. Paste it into your AI")
                      : t("已选中，请按复制", "Selected. Copy it now"),
                  ),
                )
              }
            >
              {t("复制资料包", "Copy the pack")}
            </button>
          </div>
          <b>{t("2 · 把 AI 的回答贴回来", "2 · Paste the AI's answer back")}</b>
          <textarea
            aria-label={t("AI 的回答", "The AI's answer")}
            rows={5}
            value={answer}
            placeholder={t(
              "粘贴 AI 按【目标】【现状】【下一步】回复的内容",
              "Paste what the AI replied with [Goal], [Now] and [Next]",
            )}
            onChange={(event) => setAnswer(event.target.value)}
          />
          <div className={css["dialog-foot"]}>
            <button
              type="button"
              className={`${css.btn} ${css["btn-quiet"]}`}
              disabled={busy || !answer.trim()}
              onClick={() => {
                setBusy(true);
                setError("");
                void onAnswer(answer)
                  .then(() => setAnswer(""))
                  .catch((err) => setError(err instanceof Error ? err.message : String(err)))
                  .finally(() => setBusy(false));
              }}
            >
              {busy ? t("正在读取…", "Reading…") : t("读取回答并核对", "Read and review")}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
