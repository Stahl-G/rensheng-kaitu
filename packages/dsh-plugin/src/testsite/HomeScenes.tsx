import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import type { Locale } from "../client/i18n.js";
import ui from "./preview.module.css";
import * as store from "./store.js";

export type DemoMode = "new" | "data" | "pending";
type Translate = (zh: string, en: string) => string;
type Panel = "capture" | "health" | "package" | "answer" | "pending" | "complete" | null;

function Dialog({ title, close, children }: { title: string; close: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className={ui.dialog}
      aria-labelledby={id}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <div className={ui.dialogHead}>
        <h2 id={id}>{title}</h2>
        <button type="button" onClick={close} aria-label="关闭 / Close">
          ×
        </button>
      </div>
      {children}
    </dialog>
  );
}

// Original inline SVG artwork from the Opus home-scenes v2 design, 842d1b8.
function SceneArt({ kind, muted }: { kind: "meal" | "body" | "path"; muted: boolean }) {
  return (
    <svg viewBox="0 0 360 128" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      {kind === "meal" ? (
        <>
          <rect width="360" height="128" fill="var(--meal)" />
          <ellipse cx="180" cy="68" rx="78" ry="44" fill="var(--plate)" />
          <ellipse cx="180" cy="68" rx="58" ry="31" fill="var(--plate2)" />
          <g opacity={muted ? 0.55 : 1}>
            <circle cx="160" cy="60" r="16" fill="#C9A27A" />
            <rect x="178" y="54" width="34" height="20" rx="8" fill="#8FAF8F" />
            <circle cx="196" cy="82" r="9" fill="#E3B26B" />
          </g>
        </>
      ) : kind === "body" ? (
        <>
          <rect width="360" height="128" fill="var(--body)" />
          <g fill="var(--bar)" opacity={muted ? 0.45 : 1}>
            {[40, 54, 28, 62, 48, 70, 52].map((height, i) => (
              <rect key={height} x={28 + i * 34} y={110 - height} width="14" height={height} rx="3" />
            ))}
          </g>
          {!muted && (
            <polyline
              points="20,44 70,40 120,46 170,36 220,38 270,30 340,32"
              fill="none"
              stroke="var(--route)"
              strokeWidth="2.5"
            />
          )}
        </>
      ) : (
        <>
          <rect width="360" height="128" fill="var(--map)" />
          <g opacity={muted ? 0.4 : 1}>
            <path
              d="M40 98 C 100 90, 120 50, 180 56 S 260 40, 320 30"
              fill="none"
              stroke="var(--route)"
              strokeWidth="3"
            />
            <path
              d="M180 56 C 220 80, 260 96, 320 100"
              fill="none"
              stroke="var(--route)"
              strokeWidth="2.5"
              strokeDasharray="6 6"
            />
            {!muted && (
              <>
                <circle cx="180" cy="56" r="7" fill="var(--route)" />
                <circle
                  cx="320"
                  cy="100"
                  r="5"
                  fill="var(--surface)"
                  stroke="var(--route)"
                  strokeWidth="2.5"
                />
              </>
            )}
          </g>
        </>
      )}
    </svg>
  );
}

export function HomeScenes({
  mode,
  setMode,
  state,
  t,
  locale,
  library,
  directions,
  notice,
  error,
}: {
  mode: DemoMode;
  setMode: (mode: DemoMode) => void;
  state: ReturnType<typeof store.snapshot>;
  t: Translate;
  locale: Locale;
  library: () => void;
  directions: () => void;
  notice: (text: string) => void;
  error: (text: string) => void;
}) {
  const [panel, setPanel] = useState<Panel>(null);
  const [draft, setDraft] = useState("");
  const [context, setContext] = useState("");
  const [answer, setAnswer] = useState("");
  const [reviewing, setReviewing] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [samplePackage, setSamplePackage] = useState(false);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [handled, setHandled] = useState<number[]>([]);
  const isNew = mode === "new";
  const sampleOriginals = [
    ["今天午饭吃了牛肉饭和青菜。", "Beef rice and greens for lunch today."],
    [
      "方向想法：先去杭州短住一个周末，再决定要不要搬家。",
      "Direction idea: spend a weekend in Hangzhou before deciding whether to move.",
    ],
  ] as const;
  const pendingSamples = sampleOriginals.map(([zh, en]) => t(zh, en));
  // Keep confirmations saved before the copy update handled without rewriting their originals.
  const previousSampleOriginals = [
    [
      "合成示例 · 午饭原文：今天吃了牛肉饭和青菜。没有估算营养。",
      "Synthetic sample · lunch original: beef rice and greens today. No nutrition estimate.",
    ],
    [
      "合成示例 · 方向想法：先去杭州短住一个周末，再决定要不要搬家。",
      "Synthetic sample · direction idea: spend a weekend in Hangzhou before deciding whether to move.",
    ],
  ] as const;
  const isHandled = (index: number) =>
    handled.includes(index) ||
    state.notes.some(
      (note) =>
        sampleOriginals[index]?.some((text) => note.text === text) ||
        previousSampleOriginals[index]?.some((text) => note.text === text),
    );
  const pending = mode === "pending" ? pendingSamples.filter((_, index) => !isHandled(index)).length : 0;
  const candidates = samplePackage
    ? [
        {
          id: "profile",
          title: t("示例近况", "Sample context"),
          text: t(
            "小林在做设计，最近想重新开始训练。",
            "Lin works in design and wants to start training again.",
          ),
        },
        {
          id: "goal",
          title: t("示例下一步", "Sample next step"),
          text: t(
            "小林想每周给业余项目留一点时间。下一步是约一次用户访谈。",
            "Lin wants to make time for a side project each week. The next step is to arrange a user interview.",
          ),
        },
        {
          id: "health",
          title: t("示例健康资料（敏感）", "Sample health data (sensitive)"),
          text: t("体重：68.4 千克。", "Weight: 68.4 kg."),
        },
        {
          id: "others",
          title: t("示例访谈转写（涉及他人）", "Sample interview transcript · other people, unchecked"),
          text: t("受访者说：我通常周末才有空。", "Interviewee: I usually have time on weekends."),
        },
      ]
    : [
        ...state.notes.map((note) => ({ id: note.file, title: note.text.slice(0, 70), text: note.text })),
        ...(state.task === "open" || state.task === "done"
          ? [
              {
                id: "current-step",
                title: t("已采纳的下一步", "Adopted next step"),
                text: `${t("下一步", "Next step")}\n${store.taskTitle}`,
              },
            ]
          : []),
        ...(state.task === "done"
          ? [
              {
                id: "current-result",
                title: t("已记下的结果", "Recorded result"),
                text: state.result,
              },
            ]
          : []),
      ];
  const packageText = candidates
    .filter((item) => selected.includes(item.id))
    .map((item) => item.text)
    .join("\n\n");
  function open(next: Panel) {
    setProblem("");
    setCopied(false);
    setPanel(next);
  }
  function close() {
    if (!busy) {
      setPanel(null);
      setProblem("");
    }
  }
  function capture(kind = "note") {
    setContext(kind);
    setDraft("");
    open("capture");
  }
  function openPackage(sample = isNew) {
    setSamplePackage(sample);
    setSelected(sample ? ["profile", "goal"] : []);
    open("package");
  }
  async function save(text: string, message: string) {
    setBusy(true);
    try {
      await store.capture(text);
      if (mode === "new") setMode("data");
      setProblem("");
      error("");
      notice(message);
      return true;
    } catch (err) {
      setProblem(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setBusy(false);
    }
  }
  function act(action: () => void) {
    try {
      action();
      setProblem("");
      error("");
    } catch (err) {
      setProblem(err instanceof Error ? err.message : String(err));
    }
  }
  const cardData = [
    {
      kind: "meal" as const,
      title: t("这顿吃得怎么样", "How was this meal?"),
      fact: t("写一句吃了什么。", "Write what you ate."),
      action: t("记这顿 →", "Log this meal →"),
      click: () => capture("meal"),
    },
    {
      kind: "body" as const,
      title: t("看看训练和身体的变化", "See training and body changes"),
      fact: isNew
        ? t("训练、睡眠和体重放在一起看。", "Training, sleep and weight in one place.")
        : t(
            "最近 30 天练了 12 次，平均睡 7.1 小时，体重 68.4 → 67.9 千克。",
            "12 sessions in 30 days, 7.1 hours of sleep on average, weight 68.4 → 67.9 kg.",
          ),
      action: t("打开健康 →", "Open health →"),
      click: () => open("health"),
    },
    {
      kind: "path" as const,
      title: t("除了现在这条路，还可以怎么走", "What other paths could you try?"),
      fact: t("在试：去杭州短住一个周末。", "Trying: a weekend in Hangzhou."),
      action: t("看看方向 →", "Explore a direction →"),
      click: directions,
    },
  ];
  return (
    <div className={ui.home}>
      <div className={ui.homeHead}>
        <div>
          <p className={ui.eyebrow}>
            {isNew
              ? t("欢迎来到开图", "Welcome to Kaitu")
              : t("让每个 AI，一读就认识你", "Let every AI pick up where you left off")}
          </p>
          <h1>
            {isNew
              ? t("让每个 AI，一读就认识你", "Let every AI get to know you")
              : new Intl.DateTimeFormat(locale, { month: "long", day: "numeric", weekday: "long" }).format(
                  new Date(),
                )}
          </h1>
          {isNew && (
            <p className={ui.sub}>
              {t("写一句关于自己，就能开始。", "Start with one sentence about yourself.")}
            </p>
          )}
        </div>
      </div>
      <div className={ui.capture}>
        <button type="button" className={ui.capturePrompt} onClick={() => capture()}>
          {isNew
            ? t(
                "比如：在杭州做设计，最近想把散文集写完",
                "For example: I design in Hangzhou and want to finish my essays",
              )
            : t("随手记一句", "Write a quick note")}
        </button>
        <button type="button" className={isNew ? ui.primary : ui.secondary} onClick={() => capture()}>
          {isNew ? t("写下这一句", "Write this sentence") : t("记下", "Write a note")}
        </button>
      </div>
      {isNew && (
        <div className={ui.startLinks}>
          <button type="button" onClick={() => openPackage(true)}>
            {t("用示例试一下", "Try a sample")}
          </button>
          <button type="button" onClick={() => capture("chat")}>
            {t("带入已有聊天 →", "Bring in a conversation →")}
          </button>
        </div>
      )}
      {pending > 0 && (
        <section className={ui.pending} aria-label={t("等你确认", "Pending review")}>
          <div>
            <strong>{t(`交来 ${pending} 条，等你确认`, `${pending} items waiting for you`)}</strong>
          </div>
          <button type="button" className={ui.primary} onClick={() => open("pending")}>
            {t(`去确认 ${pending} 条`, `Review ${pending} items`)}
          </button>
        </section>
      )}
      <div className={ui.scenes}>
        {cardData.map((card) => (
          <article key={card.kind} className={ui.scene}>
            <div className={ui.art}>
              <SceneArt kind={card.kind} muted={isNew} />
            </div>
            <div className={ui.sceneBody}>
              <h2>{card.title}</h2>
              <p>{card.fact}</p>
              <div className={ui.sceneFoot}>
                <button type="button" onClick={card.click}>
                  {card.action}
                </button>
              </div>
            </div>
          </article>
        ))}
      </div>
      <section className={ui.aiCard} aria-label={t("换个 AI，接着聊", "Switch AI and continue")}>
        <div className={ui.packageIcon} aria-hidden="true">
          <svg
            aria-hidden="true"
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
          >
            <path d="M4 7h16v11H4zM8 7V4h8v3" />
          </svg>
        </div>
        <div className={ui.aiText}>
          <h2>{t("换个 AI，接着聊", "Switch AI and continue")}</h2>
          <p>
            {isNew
              ? t("看看给 AI 的资料长什么样。", "See what your AI would get.")
              : t(
                  "复制给你常用的 AI，不用重新介绍自己。",
                  "Copy it to your AI. No need to introduce yourself again.",
                )}
          </p>
        </div>
        <button
          type="button"
          className={!isNew && !pending ? ui.primary : ui.secondary}
          onClick={() => openPackage()}
        >
          {isNew ? t("用示例试一下", "Try a sample") : t("选择要带的内容", "Choose what to bring")}
        </button>
        <button
          type="button"
          className={ui.textButton}
          onClick={() => {
            setAnswer("");
            setReviewing(false);
            open("answer");
          }}
        >
          {t("贴回 AI 回答", "Paste AI answer")}
        </button>
      </section>
      {!isNew && (
        <div className={ui.changes}>
          <section>
            <div>
              <span className={ui.meta}>
                {state.task === "proposed"
                  ? t("建议的下一步", "Suggested next step")
                  : t("现在这件事", "Now")}
              </span>
              <p>
                <strong>
                  {state.task === "skipped"
                    ? t("没有已采纳的下一步", "No adopted next step")
                    : state.task === "done"
                      ? t("已完成：约一次用户访谈", "Completed: arrange a user interview")
                      : t("给业余项目约一次用户访谈", "Arrange a user interview for a side project")}
                </strong>
              </p>
              {state.task === "done" && <p className={ui.original}>{state.result}</p>}
            </div>
            {state.task === "proposed" ? (
              <button type="button" className={ui.secondary} onClick={() => act(store.adopt)}>
                {t("采纳这一步", "Adopt this step")}
              </button>
            ) : state.task === "open" ? (
              <div className={ui.tools}>
                <button
                  type="button"
                  className={ui.secondary}
                  onClick={() => {
                    setDraft("");
                    open("complete");
                  }}
                >
                  {t("完成", "Complete")}
                </button>
                <button type="button" onClick={() => openPackage()}>
                  {t("交给 AI", "Bring to AI")}
                </button>
              </div>
            ) : null}
          </section>
          <section>
            <p>{pending ? t(`等你确认 ${pending} 条`, `${pending} items to review`) : null}</p>
            <button type="button" onClick={pending ? () => open("pending") : library}>
              {pending ? t("去确认 →", "Review →") : t("看看存下的内容 →", "See what you saved →")}
            </button>
          </section>
        </div>
      )}
      {problem && !panel && (
        <p className={ui.notice} role="alert">
          {problem}
        </p>
      )}
      {panel && (
        <Dialog
          title={
            panel === "capture"
              ? context === "meal"
                ? t("记这顿", "Log a meal")
                : context === "chat"
                  ? t("带入聊天", "Bring in a conversation")
                  : t("记一句", "Write a note")
              : panel === "health"
                ? t("训练和身体的变化", "Training and body changes")
                : panel === "package"
                  ? t("选择要带的内容", "Choose what to bring")
                  : panel === "answer"
                    ? t("贴回回答", "Paste answer")
                    : panel === "complete"
                      ? t("完成并留下结果", "Complete and record a result")
                      : t("确认这几条", "Review these items")
          }
          close={close}
        >
          {panel === "capture" && (
            <form
              onSubmit={async (event) => {
                event.preventDefault();
                if (await save(draft, t("已保存", "Saved"))) {
                  setPanel(null);
                  setDraft("");
                }
              }}
            >
              <label htmlFor="capture-text">
                {context === "chat" ? t("聊天内容", "Conversation") : t("这一句", "Your sentence")}
              </label>
              <textarea
                id="capture-text"
                rows={5}
                maxLength={4000}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
              />
              <div className={ui.tools}>
                <button type="submit" className={ui.primary} disabled={busy || !draft.trim()}>
                  {t("保存", "Save")}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setDraft(
                      context === "meal"
                        ? t("午饭吃了牛肉饭和青菜。", "I had beef rice and greens for lunch.")
                        : store.sampleNote,
                    )
                  }
                >
                  {t("填入示例", "Use sample text")}
                </button>
                <button type="button" onClick={close}>
                  {t("取消", "Cancel")}
                </button>
              </div>
            </form>
          )}
          {panel === "health" && (
            <>
              <table className={ui.healthTable}>
                <caption>{t("小林 · 最近 30 天（示例）", "Lin · last 30 days (sample)")}</caption>
                <tbody>
                  <tr>
                    <th>{t("训练", "Training")}</th>
                    <td>{t("12 次", "12 sessions")}</td>
                  </tr>
                  <tr>
                    <th>{t("睡眠", "Sleep")}</th>
                    <td>{t("平均 7.1 小时", "7.1 hours on average")}</td>
                  </tr>
                  <tr>
                    <th>{t("体重", "Weight")}</th>
                    <td>{t("68.4 → 67.9 千克", "68.4 → 67.9 kg")}</td>
                  </tr>
                </tbody>
              </table>
              <button
                type="button"
                className={ui.secondary}
                onClick={() => {
                  setPanel(null);
                  library();
                }}
              >
                {t("看看存下的内容 →", "See what you saved →")}
              </button>
            </>
          )}
          {panel === "package" && (
            <>
              <div className={ui.choices}>
                {candidates.map((item) => (
                  <label key={item.id}>
                    <input
                      type="checkbox"
                      disabled={busy}
                      checked={selected.includes(item.id)}
                      onChange={(event) => {
                        setSelected(
                          event.target.checked
                            ? [...selected, item.id]
                            : selected.filter((id) => id !== item.id),
                        );
                        setCopied(false);
                        setProblem("");
                      }}
                    />
                    <span>{item.title}</span>
                  </label>
                ))}
              </div>
              {!candidates.length && <p>{t("还没有内容。", "Nothing saved yet.")}</p>}
              {!samplePackage && (
                <button type="button" onClick={() => openPackage(true)}>
                  {t("改用示例", "Use samples instead")}
                </button>
              )}
              <label htmlFor="package-preview">{t("将复制的内容", "To be copied")}</label>
              <textarea id="package-preview" rows={6} value={packageText} readOnly />
              <div className={ui.tools}>
                <button
                  type="button"
                  className={ui.primary}
                  disabled={busy || !packageText}
                  onClick={async () => {
                    setBusy(true);
                    setCopied(false);
                    setProblem("");
                    try {
                      await navigator.clipboard.writeText(packageText);
                      setCopied(true);
                    } catch {
                      setProblem(
                        t(
                          "复制失败，可以手动选中上面的内容。",
                          "Couldn't copy. Select the text above instead.",
                        ),
                      );
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {t("复制所选内容", "Copy selected content")}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAnswer("");
                    setReviewing(false);
                    open("answer");
                  }}
                >
                  {t("贴回回答", "Paste answer")}
                </button>
                <button type="button" onClick={close}>
                  {t("取消", "Cancel")}
                </button>
              </div>
              {copied && (
                <output className={ui.notice} aria-live="polite">
                  {t("已复制", "Copied")}
                </output>
              )}
            </>
          )}
          {panel === "answer" && (
            <form
              onSubmit={async (event) => {
                event.preventDefault();
                if (!reviewing) {
                  setReviewing(true);
                  return;
                }
                if (await save(answer, t("已保存", "Saved"))) {
                  setPanel(null);
                  setAnswer("");
                  setReviewing(false);
                }
              }}
            >
              <label htmlFor="answer-text">
                {reviewing ? t("确认后保存", "Save after review") : t("AI 的回答", "AI answer")}
              </label>
              <textarea
                id="answer-text"
                rows={7}
                maxLength={4000}
                value={answer}
                readOnly={reviewing}
                onChange={(event) => setAnswer(event.target.value)}
              />
              <div className={ui.tools}>
                <button type="submit" className={ui.primary} disabled={busy || !answer.trim()}>
                  {reviewing ? t("保存", "Save") : t("预览", "Preview")}
                </button>
                {reviewing ? (
                  <button type="button" onClick={() => setReviewing(false)}>
                    {t("返回修改", "Back to edit")}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() =>
                      setAnswer(
                        t(
                          "  先约一位朋友，聊聊最近一次遇到的问题。\n下次带着访谈原话接着聊。  ",
                          "  First ask a friend about a recent problem.\nBring their original words to the next conversation.  ",
                        ),
                      )
                    }
                  >
                    {t("填入示例回答", "Use sample answer")}
                  </button>
                )}
                <button type="button" onClick={close}>
                  {t("取消", "Cancel")}
                </button>
              </div>
            </form>
          )}
          {panel === "pending" && (
            <>
              {pendingSamples.map(
                (text, index) =>
                  !isHandled(index) && (
                    <section className={ui.reviewItem} key={text}>
                      <p className={ui.original}>{text}</p>
                      <div className={ui.tools}>
                        <button
                          type="button"
                          className={ui.secondary}
                          disabled={busy}
                          onClick={async () => {
                            if (
                              await save(
                                text,
                                t("已保存，可以到资料里找回。", "Saved. You can find it in Library."),
                              )
                            )
                              setHandled([...handled, index]);
                          }}
                        >
                          {t("保存", "Save")}
                        </button>
                        <button type="button" disabled={busy} onClick={() => setHandled([...handled, index])}>
                          {t("略过", "Skip")}
                        </button>
                      </div>
                    </section>
                  ),
              )}
              {!pending && <p>{t("都处理完了。", "All done.")}</p>}
              <button type="button" onClick={close}>
                {t("返回首页", "Back to Home")}
              </button>
            </>
          )}
          {panel === "complete" && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                act(() => {
                  store.complete(draft);
                  setPanel(null);
                  notice(t("已完成并保存示例结果。", "Completed and saved the sample result."));
                });
              }}
            >
              <label htmlFor="sample-result">{t("记一句结果", "Record a result")}</label>
              <textarea
                id="sample-result"
                rows={4}
                maxLength={4000}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
              />
              <div className={ui.tools}>
                <button type="submit" className={ui.primary} disabled={!draft.trim()}>
                  {t("完成并记下", "Complete and save")}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setDraft(
                      t(
                        "约好了周六和朋友聊一会，先问最近一次遇到的问题。",
                        "Arranged to talk with a friend on Saturday about a recent problem.",
                      ),
                    )
                  }
                >
                  {t("填入示例结果", "Use sample result")}
                </button>
                <button type="button" onClick={close}>
                  {t("取消", "Cancel")}
                </button>
              </div>
            </form>
          )}
          {problem && (
            <p className={ui.notice} role="alert">
              {problem}
            </p>
          )}
        </Dialog>
      )}
    </div>
  );
}
