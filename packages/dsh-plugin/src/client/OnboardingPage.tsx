import type { OnboardingAi, OnboardingChoices, OnboardingStart, OnboardingStatus } from "@kaitu/core";
import { useEffect, useRef, useState } from "react";
import css from "./Onboarding.module.css";
import { OnboardingFileImport, OnboardingSetup } from "./OnboardingSources.js";
import v2 from "./Prototype.module.css";
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
}
const primary = `${v2.btn} ${v2["btn-primary"]}`;
const quiet = `${v2.btn} ${v2["btn-quiet"]}`;
const focusHeading = (element: HTMLHeadingElement | null) => element?.focus();

export function OnboardingPage(props: Props) {
  const { status, step } = props;
  const { content, choices } = status;
  const firstAi = content.ais.find((ai) => ai.id === choices?.memoryAi) ?? content.ais[0];
  const [ai, setAi] = useState(firstAi?.id ?? "chatgpt");
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<Awaited<ReturnType<Props["previewOnboardingMemory"]>> | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
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
      setCopyState("已复制");
    } catch {
      if (prompt.current) {
        const range = document.createRange();
        range.selectNodeContents(prompt.current);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        prompt.current.focus();
      }
      setCopyState("已选中提示词，请复制");
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
    } else if (step === 1) {
      if (!preview) {
        const result = await props.previewOnboardingMemory(text, ai as OnboardingAi);
        token.current = result.token;
        if (!alive.current) {
          await props.cancelOnboarding(result.token);
          return;
        }
        setPreview(result);
        setSelected(result.candidates.map((candidate) => candidate.id));
      } else {
        confirming.current = true;
        try {
          await props.confirmOnboardingMemory(preview.token, selected);
          token.current = null;
          setPreview(null);
        } finally {
          confirming.current = false;
        }
        await save({ memoryAi: ai as OnboardingAi, skipped: skip(["memory"], false) });
        move(2);
        await props.refresh();
      }
    } else if (step === 2) {
      await save({ starts });
      move(3);
    } else if (step === 3) {
      setPanel(null);
      move(4);
    } else {
      const choice = !props.builtin && aiChoice === "builtin" ? "mine" : aiChoice;
      await save({ seen: true, aiChoice: choice, skipped: skip(["ai"], choice === "none") });
      finish(choice === "builtin" ? "ask" : choice === "mine" ? "connections" : "today");
    }
  };
  const skipStep = async () => {
    if (step === 0) {
      await save({ seen: true });
      finish("today");
    } else if (step === 1) {
      await clearPreview();
      await save({ memoryAi: ai as OnboardingAi, skipped: skip(["memory"], true) });
      move(2);
    } else if (step === 2) {
      setStarts([]);
      await save({ starts: [] });
      move(3);
    } else if (step === 3) {
      await save({
        skipped: skip(
          status.sources
            .filter((source) => !status.checklist.items.find((item) => item.id === source.id)?.done)
            .map((source) => source.id),
          true,
        ),
      });
      setPanel(null);
      move(4);
    } else {
      await save({ seen: true, aiChoice: "none", skipped: skip(["ai"], true) });
      finish("today");
    }
  };
  const back = async () => {
    setError("");
    if (panel) setPanel(null);
    else if (preview) await clearPreview();
    else move(Math.max(0, step - 1));
  };
  const open = (source: string) => {
    if (source === "health") setPanel("apple-health");
    else if (source === "projects" || source === "news") setPanel(source);
    else props.openSource(source);
  };
  const footer = (label: string, skipLabel: string, disabled = false) => (
    <div className={css.footer}>
      {step > 0 ? (
        <button type="button" className={quiet} disabled={busy} onClick={() => void run(back)}>
          上一步
        </button>
      ) : (
        <span />
      )}
      <div className={css.footerActions}>
        <button type="button" className={v2.link} disabled={busy} onClick={() => void run(skipStep)}>
          {skipLabel}
        </button>
        <button type="button" className={primary} disabled={busy || disabled} onClick={() => void run(next)}>
          {busy ? "处理中…" : label}
        </button>
      </div>
    </div>
  );
  if (step === 0)
    return (
      <section className={`${v2.welcome} ${css.welcome}`} aria-label="欢迎来到人生开图" aria-busy={busy}>
        <span className={v2.eyebrow}>欢迎来到人生开图</span>
        <h1 key={`${step}-${!!preview}`} ref={focusHeading} tabIndex={-1}>
          把你的生活交给 AI 打理，你只看结果、做决定
        </h1>
        <div className={css.how}>
          <div>
            <b>1 · 资料放进开图</b>
            <span>记忆、日历、健康、账单、项目，都存在你自己的文件夹里</span>
          </div>
          <div>
            <b>2 · AI 每天整理</b>
            <span>早上排好今天，晚上整理当天，有变动先问你</span>
          </div>
          <div>
            <b>3 · 你只确认</b>
            <span>换哪个 AI 都能接着用，人生进度不会丢</span>
          </div>
        </div>
        {error && (
          <p role="alert" className={v2.error}>
            {error}
          </p>
        )}
        <p className={v2.small}>大约 5 分钟，每一步都能跳过</p>
        {footer("开始", "先随便看看")}
      </section>
    );
  return (
    <section className={`${css.flow} ${v2.card}`} aria-label="开始使用" aria-busy={busy}>
      <ol className={css.steps} aria-label="开始使用的步骤">
        {content.steps.map((title, index) => (
          <li
            key={title}
            data-current={step === index + 1}
            data-done={step > index + 1}
            aria-current={step === index + 1 ? "step" : undefined}
          >
            <span>{step > index + 1 ? "✓" : index + 1}</span>
            {title}
          </li>
        ))}
      </ol>
      {error && (
        <p role="alert" className={v2.error}>
          {error}
        </p>
      )}
      {step === 1 && (
        <>
          <h1 className={css.title} key={`${step}-${!!preview}`} ref={focusHeading} tabIndex={-1}>
            {preview
              ? `开图从 ${aiInfo?.name} 那里认出了 ${preview.candidates.length} 件事`
              : "先让开图认识你"}
          </h1>
          <p className={css.lead}>
            {preview
              ? "看一眼，不对的取消勾选。确认后在「个人档案」里每条都能改，也能看到来自哪里。"
              : "你常用的 AI 已经记住了不少关于你的事。复制下面这段话发给它，再把回答粘贴回来，不用从头填档案。"}
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
              {!preview.candidates.length && <p className={v2.small}>这些内容已经记住了，可以继续下一步。</p>}
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
                        {candidate.raw && <span className={css.raw}>格式没对上，原样保留</span>}
                      </span>
                    </label>
                  ))}
                </section>
              ))}
            </div>
          ) : (
            <>
              <fieldset className={css.ais} disabled={busy}>
                <legend className={v2.sr}>你最常用的 AI</legend>
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
                  <b>复制这段话，发给 {aiInfo?.name}</b>
                  <div className={css.prompt}>
                    <pre ref={prompt} tabIndex={-1} aria-label="记忆导出提示词">
                      {content.prompt}
                    </pre>
                    <button type="button" className={quiet} onClick={() => void copy()}>
                      复制
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
                    <b>把它的回答粘贴到这里</b>
                  </label>
                  <textarea
                    id="onboarding-memory"
                    rows={7}
                    value={text}
                    disabled={busy}
                    onChange={(event) => setText(event.target.value)}
                    placeholder="[工作] 独立开发者……"
                  />
                  <span className={v2.small}>
                    想连完整聊天记录一起搬：
                    <button
                      type="button"
                      className={v2.link}
                      onClick={() => setPanel("chatgpt-conversations")}
                    >
                      导入 ChatGPT 数据导出包
                    </button>
                  </span>
                </div>
              </div>
            </>
          )}
          {!panel &&
            footer(
              preview ? (selected.length ? `记下这 ${selected.length} 条` : "继续下一步") : "看看认出了什么",
              "我没有常用的 AI，跳过",
              !preview && !text.trim(),
            )}
        </>
      )}
      {step === 2 && (
        <>
          <h1 className={css.title} key={`${step}-${!!preview}`} ref={focusHeading} tabIndex={-1}>
            你最想先管好哪几件事？
          </h1>
          <p className={css.lead}>选几个就行，下一步只请你接这几件需要的数据。以后随时能加。</p>
          <fieldset className={css.options} disabled={busy}>
            <legend className={v2.sr}>先管哪些事情，可多选</legend>
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
          {footer("下一步", "先随便看看")}
        </>
      )}
      {step === 3 && (
        <>
          <h1 className={css.title} key={`${step}-${!!preview}`} ref={focusHeading} tabIndex={-1}>
            把数据接进来
          </h1>
          <p className={css.lead}>只接你选的事需要的数据。没准备好的先跳过，以后在「资料」里接。</p>
          <div className={css.sources}>
            {!status.sources.length && <p className={v2.small}>你选的事不需要先接数据，直接下一步。</p>}
            {status.sources.map((source) => {
              const item = status.checklist.items.find((row) => row.id === source.id);
              return (
                <div className={css.source} key={source.id}>
                  <div className={css.sourceText}>
                    <b>{source.title}</b>
                    <span className={v2.small}>{source.description}</span>
                  </div>
                  {item?.done ? (
                    <span className={css.complete}>已接上</span>
                  ) : (
                    <>
                      {item?.skipped && <span className={v2.small}>已跳过</span>}
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
                        {item?.skipped ? "撤回跳过" : "跳过"}
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
          {!panel && footer("下一步", "都先跳过")}
        </>
      )}
      {step === 4 && (
        <>
          <h1 className={css.title} key={`${step}-${!!preview}`} ref={focusHeading} tabIndex={-1}>
            选一个 AI 帮你整理
          </h1>
          <p className={css.lead}>开图负责把资料存好，AI 负责每天整理、排计划。AI 随时能换，资料都在。</p>
          <fieldset className={css.options} disabled={busy}>
            <legend className={v2.sr}>用哪个 AI</legend>
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
            aiChoice === "none" ? "完成" : aiChoice === "builtin" ? "去填 API Key" : "去连接",
            "先不用 AI，完成",
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
  if (!status.checklist.visible) return null;
  return (
    <section className={`${v2.card} ${css.checklist}`} aria-labelledby="onboarding-checklist">
      <div className={v2["sec-head"]}>
        <h2 id="onboarding-checklist">
          开始使用 · {status.checklist.completed}/{status.checklist.total}
        </h2>
        <button type="button" className={v2.link} onClick={restart}>
          重新走一遍
        </button>
      </div>
      <progress
        className={css.progress}
        aria-label="开始使用进度"
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
              {item.done ? "已完成" : item.skipped ? "先跳过，随时能继续" : "还没完成"}
            </span>
          </div>
          {!item.done && (
            <button type="button" className={quiet} onClick={() => go(item)}>
              {item.action.label}
            </button>
          )}
        </div>
      ))}
    </section>
  );
}
