import type {
  OnboardingMatter as Matter,
  OnboardingContent,
  OnboardingMatterDraft,
  OnboardingMatterSuggestion,
  OnboardingNext,
  OnboardingPath,
} from "@kaitu/core";
import { useEffect, useRef, useState } from "react";
import css from "./Onboarding.module.css";
import v2 from "./Prototype.module.css";
import { useLocale, useT } from "./i18n.js";
import type { OnboardingServices } from "./onboarding-services.js";

const primary = `${v2.btn} ${v2["btn-primary"]}`;
const quiet = `${v2.btn} ${v2["btn-quiet"]}`;
const editable = (draft: OnboardingMatterSuggestion): OnboardingMatterDraft => ({
  goal: draft.goal,
  current: draft.current,
  next: draft.next,
});

/** 不用 API Key：把整理提示词复制给自己常用的 AI，再把回答贴回来，读成同一份待核对草稿。 */
function ClipboardOrganize({
  source,
  promptOnboardingMatter,
  pasteOnboardingMatter,
  onDraft,
}: Pick<OnboardingServices, "promptOnboardingMatter" | "pasteOnboardingMatter"> & {
  source: string;
  onDraft: (matter: Matter) => void;
}) {
  const t = useT();
  const locale = useLocale();
  const [prompt, setPrompt] = useState("");
  const [answer, setAnswer] = useState("");
  const [copied, setCopied] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const area = useRef<HTMLTextAreaElement>(null);
  const copy = async () => {
    setError("");
    try {
      const text = prompt || (await promptOnboardingMatter(source, locale));
      setPrompt(text);
      try {
        await navigator.clipboard.writeText(text);
        setCopied(t("已复制，去你的 AI 里粘贴发送", "Copied. Paste it into your AI and send"));
      } catch {
        setCopied(t("已显示在下面，请全选复制", "Shown below; select all and copy"));
        requestAnimationFrame(() => area.current?.select());
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };
  return (
    <div className={css.clipboard} aria-label={t("用你常用的 AI 整理", "Organize with your own AI")}>
      <b>{t("用你常用的 AI 整理", "Organize with the AI you already use")}</b>
      <div className={css.footerActions}>
        <button type="button" className={quiet} disabled={busy} onClick={() => void copy()}>
          {t("1 · 复制整理提示词", "1 · Copy the prompt")}
        </button>
        {copied && <output className={v2.small}>{copied}</output>}
      </div>
      {prompt && (
        <textarea
          ref={area}
          readOnly
          rows={4}
          aria-label={t("整理提示词", "Organizing prompt")}
          value={prompt}
        />
      )}
      <textarea
        rows={4}
        value={answer}
        disabled={busy}
        aria-label={t("AI 的回答", "The AI's answer")}
        placeholder={t("2 · 把 AI 的回答贴到这里", "2 · Paste the AI's answer here")}
        onChange={(event) => setAnswer(event.target.value)}
      />
      {error && (
        <p role="alert" className={v2.error}>
          {error}
        </p>
      )}
      <div className={css.footerActions}>
        <button
          type="button"
          className={quiet}
          disabled={busy || !answer.trim()}
          onClick={() => {
            setBusy(true);
            setError("");
            void pasteOnboardingMatter(source, answer, locale)
              .then((matter) => {
                setAnswer("");
                onDraft(matter);
              })
              .catch((err) => setError(err instanceof Error ? err.message : String(err)))
              .finally(() => setBusy(false));
          }}
        >
          {busy ? t("正在读取…", "Reading…") : t("3 · 读取回答", "3 · Read the answer")}
        </button>
      </div>
    </div>
  );
}

export function OnboardingMatter(
  props: OnboardingServices & {
    initial: Matter | null;
    initialText?: string;
    content: OnboardingContent["matter"];
    builtin: boolean;
    onPrompt: (text: string) => void;
    onDone: () => Promise<void>;
    onBusy: (busy: boolean) => void;
  },
) {
  const t = useT();
  const locale = useLocale();
  const [text, setText] = useState(props.initialText ?? "");
  const [matter, setMatter] = useState<Matter | null>(props.initial);
  const [draft, setDraft] = useState<OnboardingMatterDraft>(
    props.initial?.draft ? editable(props.initial.draft) : { goal: "", current: "", next: "" },
  );
  const [paths, setPaths] = useState<OnboardingPath[]>(props.initial?.draft?.paths ?? []);
  const [path, setPath] = useState(-1);
  const input = useRef<HTMLTextAreaElement>(null);
  const [busy, setBusy] = useState(false);
  const [organizing, setOrganizing] = useState(false);
  const [error, setError] = useState("");
  const [raw, setRaw] = useState(false);
  const [approvalRequired, setApprovalRequired] = useState(false);
  const [externalRequested, setExternalRequested] = useState(false);
  const [noAi, setNoAi] = useState(false);
  const [manual, setManual] = useState(!props.initial?.draft);
  const applied = useRef(JSON.stringify(props.initial?.draft ?? null));
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const apply = (result: Matter) => {
    setMatter(result);
    setError("");
    setApprovalRequired(false);
    if (!result.draft) return;
    applied.current = JSON.stringify(result.draft);
    setDraft(editable(result.draft));
    setPaths(result.draft.paths ?? []);
    setPath(-1);
    setManual(false);
  };
  useEffect(() => {
    const receipt = JSON.stringify(props.initial?.draft ?? null);
    if (props.initial?.source === matter?.source && props.initial?.draft && receipt !== applied.current) {
      applied.current = receipt;
      setDraft(editable(props.initial.draft));
      setPaths(props.initial.draft.paths ?? []);
      setPath(-1);
      setManual(false);
      setError("");
      setApprovalRequired(false);
    }
  }, [props.initial, matter?.source]);
  const run = async (operation: () => Promise<void>) => {
    setBusy(true);
    props.onBusy(true);
    setError("");
    setApprovalRequired(false);
    try {
      await operation();
    } catch (err) {
      if (alive.current) {
        setError(err instanceof Error ? err.message : String(err));
        setApprovalRequired(
          !!err && typeof err === "object" && "code" in err && err.code === "AI_APPROVAL_REQUIRED",
        );
      }
    } finally {
      if (alive.current) {
        setBusy(false);
        props.onBusy(false);
      }
    }
  };
  const save = async () => {
    const saved = matter ?? (await props.saveOnboardingMatter(text));
    if (alive.current) setMatter(saved);
    return saved;
  };
  const keep = async () => {
    const saved = await save();
    await props.keepOnboardingMatter(saved.source);
    await props.onDone();
  };
  const external = (saved: Matter) => {
    props.onPrompt(
      locale === "en"
        ? `Use kaitu_onboarding matter-read to read the original ${saved.source}. Summarize the current goal and what is known. If there is a clear thing to push, give one next step; if the person doesn't know what to do, give 2–3 possible paths (why it fits, what's unclear, one low-cost experiment), without preselecting a path or next step. Call matter-draft to save a draft for me to review. Don't create tasks or adopt other suggestions. I'll review and adopt in Kaitu.`
        : `请用 kaitu_onboarding 的 matter-read 读取原文 ${saved.source}，整理当前目标和已知现状；已有明确的事时给一个下一步，不知道做什么时给 2–3 条可能路径（为什么适合、还有哪些不清楚、一个低成本小实验），不要预选路径或下一步。调用 matter-draft 保存供我核对的草稿。不要创建待办或采纳其他建议。我会回到开图核对并采纳。`,
    );
    setExternalRequested(true);
  };
  const organize = async () => {
    const saved = await save();
    if (!props.builtin) {
      external(saved);
      return;
    }
    setOrganizing(true);
    try {
      const result = await props.organizeOnboardingMatter(saved.source, locale);
      if (!alive.current) return;
      setMatter(result);
      if (result.draft) apply(result);
      else {
        setManual(true);
        setNoAi(true);
      }
    } finally {
      if (alive.current) setOrganizing(false);
    }
  };
  const conversation = matter?.kind === "conversation";
  const subject = conversation ? t("这段对话", "this conversation") : t("你写的这件事", "what you wrote");
  const hasDraft = !manual;
  const field = (key: keyof OnboardingMatterDraft, title: string) => (
    <label key={key}>
      <b>{title}</b>
      <textarea
        rows={2}
        value={draft[key]}
        disabled={busy || (key === "next" && paths.length > 0 && path < 0)}
        maxLength={key === "current" ? 4000 : 2000}
        placeholder={
          key === "next" && paths.length > 0 && path < 0
            ? t("先选一条可能路径，再修改小实验", "Pick a possible path first, then adjust its experiment")
            : undefined
        }
        onChange={(event) =>
          setDraft((current) => ({ ...current, [key]: event.target.value.replace(/[\r\n]+/g, " ") }))
        }
      />
    </label>
  );
  return (
    <div className={css.matter} aria-busy={busy}>
      <h1 className={css.title}>
        {!matter
          ? props.content.question
          : hasDraft
            ? t(`开图从${subject}里看到的`, `What Kaitu found in ${subject}`)
            : t("原文已保存，接下来由你选择", "Your text is saved. Choose what comes next")}
      </h1>
      {error && (
        <p role="alert" className={v2.error}>
          {error}
        </p>
      )}
      {approvalRequired && matter && (
        <div>
          <p className={v2.small}>
            {t(
              "原文已保留。问问会显示 Agent 请求的具体操作，由你批准或拒绝；消息会先放入输入框。",
              "Your text is saved. Ask will show the Agent's requested action for you to approve or reject; the message will first be placed in the composer.",
            )}
          </p>
          <button type="button" className={primary} disabled={busy} onClick={() => external(matter)}>
            {t("在问问继续", "Continue in Ask")}
          </button>
        </div>
      )}
      {!matter ? (
        <>
          <fieldset className={css.examples} disabled={busy}>
            <legend className={v2.sr}>{t("从一个示例开始", "Start from an example")}</legend>
            {props.content.examples.map((example) => (
              <button
                type="button"
                className={quiet}
                key={example.title}
                disabled={busy}
                onClick={() => {
                  setText(example.text);
                  input.current?.focus();
                }}
              >
                {example.title}
              </button>
            ))}
          </fieldset>
          <label htmlFor="onboarding-original">
            {t("想改变的事或 AI 对话", "What you want to change, or an AI conversation")}
          </label>
          <textarea
            ref={input}
            id="onboarding-original"
            rows={8}
            maxLength={100000}
            value={text}
            disabled={busy}
            onChange={(event) => setText(event.target.value)}
            placeholder={t(
              "写下来，或粘贴一段和 AI 的对话",
              "Write it down, or paste a conversation with an AI",
            )}
          />
          <div className={css.footerActions}>
            <button
              type="button"
              className={quiet}
              disabled={busy || !text.trim()}
              onClick={() => void run(keep)}
            >
              {t("只保存原文", "Just save the text")}
            </button>
            <button
              type="button"
              className={primary}
              disabled={busy || !text.trim()}
              onClick={() => void run(organize)}
            >
              {busy ? t("正在保存…", "Saving…") : t("保存并整理", "Save and organize")}
            </button>
          </div>
        </>
      ) : (
        <>
          <div className={css.badges}>
            <span>{t("原文已保存", "Text saved")}</span>
            <span>
              {hasDraft ? t("需要你核对", "Needs your review") : t("等你整理", "Ready to organize")}
            </span>
          </div>
          {busy && !organizing && <output className={v2.small}>{t("正在保存…", "Saving…")}</output>}
          {manual && (
            <p className={v2.small}>
              {t(
                "可以自己写目标和下一步，也可以只保留原文后结束。",
                "Write a goal and next step yourself, or finish with just your original text saved.",
              )}
            </p>
          )}
          <div className={css.footerActions}>
            <button type="button" className={quiet} disabled={busy} onClick={() => void run(keep)}>
              {t("保留原文并结束", "Keep the text and finish")}
            </button>
          </div>
          <div className={css.draftFields}>
            {field("goal", t("当前目标", "Current goal"))}
            {field("current", t("已知现状", "What's known now"))}
            {paths.length > 0 && (
              <fieldset className={css.paths} disabled={busy}>
                <legend>{t("可能的路径", "Possible paths")}</legend>
                <div className={css.pathOptions}>
                  {paths.map((item, index) => (
                    <label className={css.pathCard} data-selected={path === index} key={item.name}>
                      <input
                        type="radio"
                        name="onboarding-path"
                        checked={path === index}
                        onChange={() => {
                          setPath(index);
                          setDraft((current) => ({ ...current, next: item.experiment }));
                        }}
                      />
                      <b>{item.name}</b>
                      <span>
                        {t("为什么适合：", "Why it fits: ")}
                        {item.fit}
                      </span>
                      <span>
                        {t("还有哪些不清楚：", "Still unclear: ")}
                        {item.unknown}
                      </span>
                      <strong>
                        {t("小实验：", "Small experiment: ")}
                        {item.experiment}
                      </strong>
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
            {field("next", t("一个下一步", "One next step"))}
          </div>
          <button type="button" className={v2.link} onClick={() => setRaw((value) => !value)}>
            {raw
              ? t("收起原文", "Hide the original")
              : t(`依据 · 查看${subject}`, `Source · view ${subject}`)}
          </button>
          {raw && <pre className={css.original}>{matter.text}</pre>}
          {manual && (
            <details>
              <summary>{t("用其他 AI 整理（可选）", "Organize with another AI (optional)")}</summary>
              <ClipboardOrganize
                source={matter.source}
                promptOnboardingMatter={props.promptOnboardingMatter}
                pasteOnboardingMatter={props.pasteOnboardingMatter}
                onDraft={apply}
              />
            </details>
          )}
          <div className={css.matterActions}>
            {organizing && (
              <output className={v2.small}>
                {t("AI 正在整理，原文已经保存", "AI is organizing. Your original text is saved.")}
              </output>
            )}
            <div className={css.footerActions}>
              {props.builtin ? (
                !noAi && (
                  <button type="button" className={quiet} disabled={busy} onClick={() => void run(organize)}>
                    {t("用当前 AI 整理", "Organize with the current AI")}
                  </button>
                )
              ) : (
                <button type="button" className={quiet} disabled={busy} onClick={() => external(matter)}>
                  {t("请当前 AI 整理", "Ask the current AI")}
                </button>
              )}
              <button
                type="button"
                className={primary}
                disabled={busy || !draft.goal.trim() || !draft.next.trim() || (paths.length > 0 && path < 0)}
                onClick={() =>
                  void run(async () => {
                    await props.adoptOnboardingMatter(matter.source, draft, paths[path] ?? null);
                    await props.onDone();
                  })
                }
              >
                {t("采纳这个下一步", "Adopt this next step")}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export function OnboardingNextCard(
  props: OnboardingServices & {
    next: OnboardingNext;
    refresh: () => Promise<void>;
    onSchedule?: () => void;
    onPrompt?: () => void;
  },
) {
  const t = useT();
  const { next } = props;
  const [action, setAction] = useState<"complete" | "defer" | "next" | null>(null);
  const [value, setValue] = useState("");
  const [original, setOriginal] = useState<Matter | null>(null);
  const [goalShown, setGoalShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const run = async (operation: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await operation();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  const sourceLabel =
    next.kind === "goal"
      ? t("查看这个目标", "view this goal")
      : next.kind === "conversation"
        ? t("查看这段对话", "view this conversation")
        : t("查看你写的这件事", "view what you wrote");
  const shown = next.kind === "goal" ? goalShown : !!original;
  return (
    <section
      id={`next-${next.id}`}
      className={`${v2.card} ${css.nextCard}`}
      aria-label={t("刚采纳的下一步", "The next step you adopted")}
    >
      <span className={v2.eyebrow}>
        {next.status === "done" ? t("这一步已完成", "This step is done") : t("现在这件事", "One thing now")}
      </span>
      <h2>{next.next}</h2>
      <p className={v2.small}>
        {t("为了：", "For: ")}
        {next.goal}
        {next.due ? t(` · 安排到 ${next.due}`, ` · planned for ${next.due}`) : ""}
      </p>
      <button
        type="button"
        className={v2.link}
        disabled={busy}
        onClick={() =>
          next.kind === "goal"
            ? setGoalShown(!goalShown)
            : void run(async () => {
                setOriginal(original ? null : await props.readOnboardingMatter(next.source));
              })
        }
      >
        {t("依据 · ", "Source · ")}
        {shown ? t("收起", "hide") : sourceLabel}
      </button>
      {next.kind === "goal" && goalShown && (
        <p className={css.original}>
          {t("来自「你带来的规划」里的目标：", "From the goal in Your plans: ")}
          {next.goal}
        </p>
      )}
      {original && <pre className={css.original}>{original.text}</pre>}
      {next.status === "done" && (
        <>
          <output className={v2.small}>{t("已记好", "Saved")}</output>
          <p>
            {t("结果：", "Result: ")}
            {next.result}
          </p>
          {next.goalId && !action && (
            <button
              type="button"
              className={primary}
              onClick={() => {
                setAction("next");
                setValue("");
              }}
            >
              {t("定下一步", "Set the next step")}
            </button>
          )}
        </>
      )}
      {(next.status !== "done" || action === "next") &&
        (!action ? (
          <div className={css.footerActions}>
            {props.onSchedule && (
              <button type="button" className={quiet} onClick={props.onSchedule}>
                {t("安排时间段", "Schedule a time")}
              </button>
            )}
            <button
              type="button"
              className={primary}
              onClick={() => {
                setAction("complete");
                setValue("");
              }}
            >
              {t("完成并记一句结果", "Done, log one line")}
            </button>
            {props.onPrompt && (
              <button type="button" className={quiet} onClick={props.onPrompt}>
                {t("交给 AI", "Ask AI")}
              </button>
            )}
            <button
              type="button"
              className={quiet}
              onClick={() => {
                setAction("defer");
                setValue(next.due ?? "");
              }}
            >
              {t("改到以后", "Move to later")}
            </button>
          </div>
        ) : (
          <form
            className={css.resultForm}
            onSubmit={(event) => {
              event.preventDefault();
              void run(async () => {
                if (action === "next" && next.goalId) await props.addGoalNext(next.goalId, value);
                else await props.changeOnboardingNext(next.id, next.rev, action, value);
                await props.refresh();
              });
            }}
          >
            <label>
              {action === "next"
                ? t("下一个小步骤", "The next small step")
                : action === "complete"
                  ? t("记一句结果", "One line about how it went")
                  : t("安排到哪一天", "Which day")}
              <input
                type={action === "defer" ? "date" : "text"}
                value={value}
                maxLength={2000}
                disabled={busy}
                required
                onChange={(event) => setValue(event.target.value)}
              />
            </label>
            <div className={css.footerActions}>
              <button type="button" className={quiet} disabled={busy} onClick={() => setAction(null)}>
                {t("取消", "Cancel")}
              </button>
              <button type="submit" className={primary} disabled={busy || !value.trim()}>
                {busy ? t("保存中…", "Saving…") : t("保存", "Save")}
              </button>
            </div>
          </form>
        ))}
      {error && (
        <p role="alert" className={v2.error}>
          {error}
        </p>
      )}
    </section>
  );
}
