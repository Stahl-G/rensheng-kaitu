import type {
  OnboardingAi,
  OnboardingChoices,
  OnboardingStart,
  OnboardingStatus,
  OnboardingTarget,
} from "@kaitu/core";
import { useEffect, useRef, useState } from "react";
import css from "./Onboarding.module.css";
import { OnboardingMatter } from "./OnboardingMatter.js";
import { OnboardingFileImport, OnboardingSetup } from "./OnboardingSources.js";
import v2 from "./Prototype.module.css";
import { useLocale, useT } from "./i18n.js";
import type { OnboardingServices } from "./onboarding-services.js";

type Destination = "today" | "ask" | "connections";
type Panel = "apple-health" | "chatgpt-conversations" | "projects" | "news";
interface Props extends OnboardingServices {
  status: OnboardingStatus;
  step: number;
  builtin: boolean;
  initialSource?: string;
  setStep: (step: number) => void;
  onStatus: (status: OnboardingStatus) => void;
  refresh: () => Promise<void>;
  onComplete: (destination: Destination) => void;
  openSource: (source: string) => void;
  onPrompt: (text: string) => void;
}
const primary = `${v2.btn} ${v2["btn-primary"]}`;
const quiet = `${v2.btn} ${v2["btn-quiet"]}`;
const focusHeading = (element: HTMLHeadingElement | null) => element?.focus();

export function OnboardingPage(props: Props) {
  const t = useT();
  const locale = useLocale();
  const { status, step } = props;
  const { content, choices } = status;
  const [entry, setEntry] = useState<"matter" | "memory">("matter");
  const memoryMode = step === 5 || (step === 1 && entry === "memory");
  const firstAi = content.ais.find((ai) => ai.id === choices?.memoryAi) ?? content.ais[0];
  const [ai, setAi] = useState(firstAi?.id ?? "chatgpt");
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<Awaited<ReturnType<Props["previewOnboardingMemory"]>> | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [targets, setTargets] = useState<Record<string, OnboardingTarget>>({});
  const [starts, setStarts] = useState<OnboardingStart[]>(choices?.starts ?? []);
  const [aiChoice, setAiChoice] = useState(
    !props.builtin && choices?.aiChoice === "builtin"
      ? "mine"
      : (choices?.aiChoice ?? (props.builtin ? "builtin" : "mine")),
  );
  const [panel, setPanel] = useState<Panel | null>(
    props.initialSource === "health"
      ? "apple-health"
      : props.initialSource === "projects" || props.initialSource === "news"
        ? props.initialSource
        : null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copyState, setCopyState] = useState("");
  const prompt = useRef<HTMLPreElement>(null);
  const token = useRef<string | null>(null);
  const confirming = useRef(false);
  const alive = useRef(true);
  const aiInfo = content.ais.find((item) => item.id === ai) ?? firstAi;
  const groups = new Map<string, NonNullable<typeof preview>["candidates"]>();
  for (const candidate of preview?.candidates ?? []) {
    groups.set(candidate.category, [...(groups.get(candidate.category) ?? []), candidate]);
  }
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (token.current && !confirming.current) void props.cancelOnboarding(token.current).catch(() => {});
    };
  }, [props.cancelOnboarding]);
  const run = async (operation: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await operation();
    } catch (err) {
      if (alive.current) setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  const save = async (input: OnboardingChoices) => {
    const result = await props.chooseOnboarding(input);
    if (alive.current) props.onStatus(result.status);
  };
  const skip = (ids: string[], value: boolean) => {
    const next = new Set(status.choices?.skipped ?? []);
    for (const id of ids) {
      if (value) next.add(id as NonNullable<OnboardingChoices["skipped"]>[number]);
      else next.delete(id as NonNullable<OnboardingChoices["skipped"]>[number]);
    }
    return [...next];
  };
  const clearPreview = async () => {
    if (token.current) await props.cancelOnboarding(token.current);
    token.current = null;
    setPreview(null);
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(content.prompt);
      setCopyState(t("已复制", "Copied"));
    } catch {
      if (prompt.current) {
        const range = document.createRange();
        range.selectNodeContents(prompt.current);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        prompt.current.focus();
      }
      setCopyState(t("已选中提示词，请复制", "Prompt selected. Copy it now"));
    }
  };
  const move = (nextStep: number) => {
    if (alive.current) props.setStep(nextStep);
  };
  const finish = (destination: Destination) => {
    if (alive.current) props.onComplete(destination);
  };
  const next = async () => {
    if (step === 0) {
      await save({ seen: true });
      move(1);
    } else if (memoryMode) {
      if (!preview) {
        const result = await props.previewOnboardingMemory(text, ai as OnboardingAi, locale);
        token.current = result.token;
        if (!alive.current) {
          await props.cancelOnboarding(result.token);
          return;
        }
        setPreview(result);
        setSelected(result.candidates.map((candidate) => candidate.id));
        setTargets(
          Object.fromEntries(result.candidates.map((candidate) => [candidate.id, candidate.target])),
        );
      } else {
        confirming.current = true;
        try {
          await props.confirmOnboardingMemory(
            preview.token,
            selected,
            Object.fromEntries(Object.entries(targets).filter(([id]) => selected.includes(id))),
          );
          token.current = null;
          setPreview(null);
        } finally {
          confirming.current = false;
        }
        await save({ memoryAi: ai as OnboardingAi, skipped: skip(["memory"], false) });
        finish("today");
        await props.refresh();
      }
    } else if (step === 2) {
      await save({ starts });
      finish("today");
    } else if (step === 3) {
      setPanel(null);
      finish("today");
    } else {
      const choice = !props.builtin && aiChoice === "builtin" ? "mine" : aiChoice;
      await save({ seen: true, aiChoice: choice, skipped: skip(["ai"], choice === "none") });
      finish(choice === "builtin" ? "ask" : choice === "mine" ? "connections" : "today");
    }
  };
  const skipStep = async () => {
    await clearPreview();
    await save({
      seen: true,
      ...(memoryMode ? { memoryAi: ai as OnboardingAi, skipped: skip(["memory"], true) } : {}),
      ...(step === 3
        ? {
            skipped: skip(
              status.sources.filter((source) => !source.done).map((source) => source.id),
              true,
            ),
          }
        : {}),
      ...(step === 4 ? { aiChoice: "none", skipped: skip(["ai"], true) } : {}),
    });
    finish("today");
  };
  const back = async () => {
    setError("");
    if (panel) setPanel(null);
    else if (preview) await clearPreview();
    else if (step >= 2) finish("today");
    else move(0);
  };
  const open = (source: string) => {
    if (source === "health") setPanel("apple-health");
    else if (source === "projects" || source === "news") setPanel(source);
    else props.openSource(source);
  };
  const footer = (label: string, skipLabel: string, disabled = false) => (
    <div className={css.footer}>
      {step === 1 ? (
        <button type="button" className={quiet} disabled={busy} onClick={() => void run(back)}>
          {t("上一步", "Back")}
        </button>
      ) : (
        <span />
      )}
      <div className={css.footerActions}>
        <button type="button" className={v2.link} disabled={busy} onClick={() => void run(skipStep)}>
          {skipLabel}
        </button>
        <button type="button" className={primary} disabled={busy || disabled} onClick={() => void run(next)}>
          {busy ? t("处理中…", "Working…") : label}
        </button>
      </div>
    </div>
  );
  if (step === 0)
    return (
      <section
        className={`${v2.welcome} ${css.welcome}`}
        aria-label={t("欢迎来到人生开图", "Welcome to Kaitu")}
        aria-busy={busy}
      >
        <span className={v2.eyebrow}>{t("欢迎来到人生开图", "Welcome to Kaitu")}</span>
        <h1 key={`${step}-${!!preview}`} ref={focusHeading} tabIndex={-1}>
          {content.welcome.title}
        </h1>
        <div className={css.how}>
          <div>
            <b>1 · {content.welcome.first}</b>
            <span>{content.welcome.firstDescription}</span>
          </div>
          <div>
            <b>{t("2 · 核对，选一个下一步", "2 · Review and pick one next step")}</b>
            <span>
              {t(
                "开图先整理出草稿，只有你确认的才算数",
                "Kaitu drafts it first; only what you confirm counts",
              )}
            </span>
          </div>
          <div>
            <b>{t("3 · 记下结果，换个 AI 也能接着", "3 · Log the result; any AI can pick it up")}</b>
            <span>
              {t(
                "资料在你自己的文件夹里，每一步有据可查",
                "Your notes live in your own folder, and every step keeps its source",
              )}
            </span>
          </div>
        </div>
        {error && (
          <p role="alert" className={v2.error}>
            {error}
          </p>
        )}
        <p className={v2.small}>
          {t("大约 3 分钟，也可以先随便看看", "About 3 minutes. You can also just look around first")}
        </p>
        {footer(t("开始", "Start"), t("先随便看看", "Look around first"))}
      </section>
    );
  return (
    <section className={`${css.flow} ${v2.card}`} aria-label={t("开始使用", "Get started")} aria-busy={busy}>
      {step >= 2 && (
        <button type="button" className={v2.link} disabled={busy} onClick={() => finish("today")}>
          {t("← 回到今天", "← Back to Today")}
        </button>
      )}
      {step === 1 && (
        <div className={css.entryTabs} role="tablist" aria-label={t("从哪里开始", "Where to start")}>
          <button
            type="button"
            role="tab"
            aria-selected={entry === "matter"}
            disabled={busy}
            onClick={() => setEntry("matter")}
          >
            {content.matter.entry}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={entry === "memory"}
            disabled={busy}
            onClick={() => setEntry("memory")}
          >
            {t("从常用的 AI 搬来记忆", "Bring memories from your AI")}
          </button>
        </div>
      )}
      {step === 1 && entry === "matter" && (
        <>
          <OnboardingMatter
            {...props}
            onBusy={setBusy}
            initial={status.draft}
            content={content.matter}
            onDone={async () => {
              await save({ seen: true });
              await props.refresh();
              finish("today");
            }}
          />
          <div className={css.footer}>
            <button type="button" className={quiet} disabled={busy} onClick={() => move(0)}>
              {t("上一步", "Back")}
            </button>
            <button type="button" className={v2.link} disabled={busy} onClick={() => void run(skipStep)}>
              {t("先随便看看", "Look around first")}
            </button>
          </div>
        </>
      )}
      {error && (
        <p role="alert" className={v2.error}>
          {error}
        </p>
      )}
      {memoryMode && (
        <>
          <h1 className={css.title} key={`${step}-${!!preview}`} ref={focusHeading} tabIndex={-1}>
            {preview
              ? t(
                  `开图从 ${aiInfo?.name} 那里认出了 ${preview.candidates.length} 件事`,
                  `Kaitu found ${preview.candidates.length} things from ${aiInfo?.name}`,
                )
              : t("先让开图认识你", "Let Kaitu get to know you")}
          </h1>
          <p className={css.lead}>
            {preview
              ? t(
                  "看一眼，不对的取消勾选。目标、在做的事和在考虑的事会放进「你带来的规划」，其余记作记忆，都能看到来自哪里。",
                  "Take a look and untick anything wrong. Goals, projects and things you're still deciding go into Your plans; the rest becomes memories. Each keeps its source.",
                )
              : t(
                  "你常用的 AI 已经记住了不少关于你的事。复制下面这段话发给它，再把回答粘贴回来，不用从头填档案。",
                  "The AI you use already remembers a lot about you. Copy the text below, send it to that AI, and paste its answer back. No need to fill in a profile from scratch.",
                )}
          </p>
          {panel === "chatgpt-conversations" ? (
            <OnboardingFileImport
              {...props}
              source={panel}
              onDone={async () => {
                setPanel(null);
                await props.refresh();
              }}
              onClose={() => setPanel(null)}
            />
          ) : preview ? (
            <div className={css.groups}>
              {!preview.candidates.length && (
                <p className={v2.small}>
                  {t("这些内容已经记住了，可以继续下一步。", "These are already saved. You can move on.")}
                </p>
              )}
              {[...groups].map(([category, candidates]) => (
                <section className={css.group} key={category}>
                  <h2 className={v2.eyebrow}>{category}</h2>
                  {candidates.map((candidate) => (
                    <label className={css.memory} key={candidate.id}>
                      <input
                        type="checkbox"
                        checked={selected.includes(candidate.id)}
                        disabled={busy}
                        onChange={(event) =>
                          setSelected((current) =>
                            event.target.checked
                              ? [...current, candidate.id]
                              : current.filter((id) => id !== candidate.id),
                          )
                        }
                      />
                      <span>
                        {candidate.content}
                        {candidate.when && <span className={v2.small}> · {candidate.when}</span>}
                        {candidate.raw && (
                          <span className={css.raw}>
                            {t("格式没对上，原样保留", "Kept as is; the format didn't match")}
                          </span>
                        )}
                      </span>
                      {candidate.target !== "memory" && (
                        <select
                          className={css.target}
                          aria-label={t("放到哪里", "Where it goes")}
                          value={targets[candidate.id] ?? candidate.target}
                          disabled={busy || !selected.includes(candidate.id)}
                          onChange={(event) =>
                            setTargets((current) => ({
                              ...current,
                              [candidate.id]: event.target.value as OnboardingTarget,
                            }))
                          }
                        >
                          <option value="goal">{t("设为目标", "Make it a goal")}</option>
                          <option value="project">{t("建为在做的事", "Make it a project")}</option>
                          <option value="direction">{t("放进在探索的方向", "Add as a direction")}</option>
                          <option value="memory">{t("只记作记忆", "Keep as a memory")}</option>
                        </select>
                      )}
                    </label>
                  ))}
                </section>
              ))}
            </div>
          ) : (
            <>
              <fieldset className={css.ais} disabled={busy}>
                <legend className={v2.sr}>{t("你最常用的 AI", "The AI you use most")}</legend>
                {content.ais.map((item) => (
                  <label key={item.id} data-checked={ai === item.id}>
                    <input
                      type="radio"
                      name="memory-ai"
                      value={item.id}
                      checked={ai === item.id}
                      onChange={() => setAi(item.id)}
                    />
                    <span>{item.name}</span>
                  </label>
                ))}
              </fieldset>
              <div className={css.instruction}>
                <span className={css.number}>1</span>
                <div className={css.instructionBody}>
                  <b>{t(`复制这段话，发给 ${aiInfo?.name}`, `Copy this and send it to ${aiInfo?.name}`)}</b>
                  <div className={css.prompt}>
                    <pre ref={prompt} tabIndex={-1} aria-label={t("记忆导出提示词", "Memory export prompt")}>
                      {content.prompt}
                    </pre>
                    <button type="button" className={quiet} onClick={() => void copy()}>
                      {t("复制", "Copy")}
                    </button>
                  </div>
                  {copyState && <output className={v2.small}>{copyState}</output>}
                  <span className={v2.small}>{aiInfo?.hint}</span>
                </div>
              </div>
              <div className={css.instruction}>
                <span className={css.number}>2</span>
                <div className={css.instructionBody}>
                  <label htmlFor="onboarding-memory">
                    <b>{t("把它的回答粘贴到这里", "Paste its answer here")}</b>
                  </label>
                  <textarea
                    id="onboarding-memory"
                    rows={7}
                    value={text}
                    disabled={busy}
                    onChange={(event) => setText(event.target.value)}
                    placeholder={t("[工作] 独立开发者……", "[Work] Indie developer…")}
                  />
                  <span className={v2.small}>
                    {t("想连完整聊天记录一起搬：", "Bring your full chat history too: ")}
                    <button
                      type="button"
                      className={v2.link}
                      onClick={() => setPanel("chatgpt-conversations")}
                    >
                      {t("导入 ChatGPT 数据导出包", "Import a ChatGPT data export")}
                    </button>
                  </span>
                </div>
              </div>
            </>
          )}
          {!panel &&
            footer(
              preview
                ? selected.length
                  ? t(`记下这 ${selected.length} 条`, `Save these ${selected.length}`)
                  : t("完成", "Done")
                : t("看看认出了什么", "See what it found"),
              t("我没有常用的 AI，跳过", "I don't use an AI regularly, skip"),
              !preview && !text.trim(),
            )}
        </>
      )}
      {step === 2 && (
        <>
          <h1 className={css.title} key={`${step}-${!!preview}`} ref={focusHeading} tabIndex={-1}>
            {t("你最想先管好哪几件事？", "What do you want to focus on first?")}
          </h1>
          <p className={css.lead}>
            {t(
              "选几个就行。清单里只请你接这几件需要的数据，以后随时能加。",
              "Pick a few. The checklist only asks for the data these need, and you can add more anytime.",
            )}
          </p>
          <fieldset className={css.options} disabled={busy}>
            <legend className={v2.sr}>{t("先管哪些事情，可多选", "What to focus on; pick several")}</legend>
            {content.starts.map((item) => (
              <label
                className={css.option}
                key={item.id}
                data-checked={starts.includes(item.id as OnboardingStart)}
              >
                <input
                  type="checkbox"
                  checked={starts.includes(item.id as OnboardingStart)}
                  onChange={(event) =>
                    setStarts((current) =>
                      event.target.checked
                        ? [...current, item.id as OnboardingStart]
                        : current.filter((id) => id !== item.id),
                    )
                  }
                />
                <b>{item.title}</b>
                <span>{item.summary}</span>
              </label>
            ))}
          </fieldset>
          {footer(t("完成", "Done"), t("暂时不选", "Not now"))}
        </>
      )}
      {step === 3 && (
        <>
          <h1 className={css.title} key={`${step}-${!!preview}`} ref={focusHeading} tabIndex={-1}>
            {t("把数据接进来", "Connect your data")}
          </h1>
          <p className={css.lead}>
            {t(
              "只接你选的事需要的数据。没准备好的先跳过，以后在「资料」里接。",
              "Only the data your choices need. Skip what isn't ready and connect it later in Library.",
            )}
          </p>
          <div className={css.sources}>
            {!status.sources.length && (
              <p className={v2.small}>
                {t(
                  "你选的事不需要先接数据，点完成回到今天。",
                  "Your choices don't need any data yet. Tap Done to go back to Today.",
                )}
              </p>
            )}
            {status.sources.map((source) => {
              const item = source;
              return (
                <div className={css.source} key={source.id}>
                  <div className={css.sourceText}>
                    <b>{source.title}</b>
                    <span className={v2.small}>{source.description}</span>
                  </div>
                  {item?.done ? (
                    <span className={css.complete}>{t("已接上", "Connected")}</span>
                  ) : (
                    <>
                      {item?.skipped && <span className={v2.small}>{t("已跳过", "Skipped")}</span>}
                      <button
                        type="button"
                        className={quiet}
                        disabled={busy || !!panel}
                        onClick={() => open(source.id)}
                      >
                        {source.action}
                      </button>
                      <button
                        type="button"
                        className={v2.link}
                        disabled={busy || !!panel}
                        onClick={() => void run(() => save({ skipped: skip([source.id], !item?.skipped) }))}
                      >
                        {item?.skipped ? t("撤回跳过", "Undo skip") : t("跳过", "Skip")}
                      </button>
                    </>
                  )}
                </div>
              );
            })}
          </div>
          {panel === "apple-health" && (
            <OnboardingFileImport
              {...props}
              source={panel}
              onDone={async () => {
                setPanel(null);
                await props.refresh();
              }}
              onClose={() => setPanel(null)}
            />
          )}
          {(panel === "projects" || panel === "news") && (
            <OnboardingSetup
              {...props}
              source={panel}
              onDone={async () => {
                setPanel(null);
                await props.refresh();
              }}
              onClose={() => setPanel(null)}
            />
          )}
          {!panel && footer(t("完成", "Done"), t("都先跳过", "Skip all for now"))}
        </>
      )}
      {step === 4 && (
        <>
          <h1 className={css.title} key={`${step}-${!!preview}`} ref={focusHeading} tabIndex={-1}>
            {t("选一个 AI 帮你整理", "Choose an AI to help you organize")}
          </h1>
          <p className={css.lead}>
            {t(
              "开图负责把资料存好，AI 负责每天整理、排计划。AI 随时能换，资料都在。",
              "Kaitu keeps your notes; the AI organizes and plans. You can switch AIs anytime and keep everything.",
            )}
          </p>
          <fieldset className={css.options} disabled={busy}>
            <legend className={v2.sr}>{t("用哪个 AI", "Which AI")}</legend>
            {content.aiChoices
              .filter((item) => props.builtin || item.id !== "builtin")
              .map((item) => (
                <label className={css.option} key={item.id} data-checked={aiChoice === item.id}>
                  <input
                    type="radio"
                    name="onboarding-ai"
                    checked={aiChoice === item.id}
                    onChange={() => setAiChoice(item.id as NonNullable<OnboardingChoices["aiChoice"]>)}
                  />
                  <b>{item.title}</b>
                  <span>{item.description}</span>
                </label>
              ))}
          </fieldset>
          {footer(
            aiChoice === "none"
              ? t("完成", "Done")
              : aiChoice === "builtin"
                ? t("去填 API Key", "Add an API key")
                : t("去复制资料包", "Get the context pack"),
            t("先不用 AI，完成", "No AI for now"),
          )}
        </>
      )}
    </section>
  );
}

export function OnboardingChecklist({
  status,
  restart,
  go,
}: {
  status: OnboardingStatus;
  restart: () => void;
  go: (item: OnboardingStatus["checklist"]["items"][number]) => void;
}) {
  const t = useT();
  if (!status.checklist.visible) return null;
  return (
    <section className={`${v2.card} ${css.checklist}`} aria-labelledby="onboarding-checklist">
      <div className={v2["sec-head"]}>
        <h2 id="onboarding-checklist">
          {t("开始使用", "Get started")} · {status.checklist.completed}/{status.checklist.total}
        </h2>
        <button type="button" className={v2.link} onClick={restart}>
          {t("重新走一遍", "Start over")}
        </button>
      </div>
      <progress
        className={css.progress}
        aria-label={t("开始使用进度", "Getting started progress")}
        value={status.checklist.completed}
        max={status.checklist.total}
      />
      {status.checklist.items.map((item) => (
        <div className={css.checkItem} data-done={item.done} key={item.id}>
          <span className={css.tick} aria-hidden="true">
            {item.done ? "✓" : ""}
          </span>
          <div className={v2.stack}>
            <b>{item.title}</b>
            <span className={v2.small}>
              {item.done
                ? t("已完成", "Done")
                : item.disabled
                  ? t("先选你想管的事", "Pick what to focus on first")
                  : item.skipped
                    ? t("先跳过，随时能继续", "Skipped for now; continue anytime")
                    : t("还没完成", "Not yet")}
            </span>
          </div>
          {!item.done && (
            <button type="button" className={quiet} disabled={item.disabled} onClick={() => go(item)}>
              {item.action.label}
            </button>
          )}
        </div>
      ))}
    </section>
  );
}
