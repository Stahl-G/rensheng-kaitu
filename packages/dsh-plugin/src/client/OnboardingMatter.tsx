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
import type { OnboardingServices } from "./onboarding-services.js";

const primary = `${v2.btn} ${v2["btn-primary"]}`;
const quiet = `${v2.btn} ${v2["btn-quiet"]}`;
const editable = (draft: OnboardingMatterSuggestion): OnboardingMatterDraft => ({
  goal: draft.goal,
  current: draft.current,
  next: draft.next,
});
export function OnboardingMatter(
  props: OnboardingServices & {
    initial: Matter | null;
    content: OnboardingContent["matter"];
    builtin: boolean;
    onPrompt: (text: string) => void;
    onDone: () => Promise<void>;
    onBusy: (busy: boolean) => void;
  },
) {
  const [text, setText] = useState("");
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
  useEffect(() => {
    const receipt = JSON.stringify(props.initial?.draft ?? null);
    if (props.initial?.source === matter?.source && props.initial?.draft && receipt !== applied.current) {
      applied.current = receipt;
      setDraft(editable(props.initial.draft));
      setPaths(props.initial.draft.paths ?? []);
      setPath(-1);
      setManual(false);
    }
  }, [props.initial, matter?.source]);
  const run = async (operation: () => Promise<void>) => {
    setBusy(true);
    props.onBusy(true);
    setError("");
    try {
      await operation();
    } catch (err) {
      if (alive.current) setError(err instanceof Error ? err.message : String(err));
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
      `请用 kaitu_onboarding 的 matter-read 读取原文 ${saved.source}，整理当前目标和已知现状；已有明确的事时给一个下一步，不知道做什么时给 2–3 条可能路径（为什么适合、还有哪些不清楚、一个低成本小实验），不要预选路径或下一步。调用 matter-draft 保存供我核对的草稿。不要创建待办或采纳其他建议。我会回到开图核对并采纳。`,
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
      const result = await props.organizeOnboardingMatter(saved.source);
      if (!alive.current) return;
      setMatter(result);
      if (result.draft) {
        applied.current = JSON.stringify(result.draft);
        setDraft(editable(result.draft));
        setPaths(result.draft.paths ?? []);
        setPath(-1);
        setManual(false);
      } else {
        setManual(true);
        setNoAi(true);
      }
    } finally {
      if (alive.current) setOrganizing(false);
    }
  };
  const subject = matter?.kind === "conversation" ? "这段对话" : "你写的这件事";
  const field = (key: keyof OnboardingMatterDraft, title: string) => (
    <label key={key}>
      <b>{title}</b>
      <input
        value={draft[key]}
        disabled={busy || (key === "next" && paths.length > 0 && path < 0)}
        maxLength={key === "current" ? 4000 : 2000}
        placeholder={
          key === "next" && paths.length > 0 && path < 0 ? "先选一条可能路径，再修改小实验" : undefined
        }
        onChange={(event) => setDraft((current) => ({ ...current, [key]: event.target.value }))}
      />
    </label>
  );
  return (
    <div className={css.matter} aria-busy={busy}>
      <h1 className={css.title}>{matter ? `开图从${subject}里看到的` : props.content.question}</h1>
      <p className={css.lead}>
        {matter
          ? "每一项都能改。只有你采纳的这一个下一步会成为待办，其他建议会留在原文里。"
          : "直接写就行，也可以粘贴一段和 AI 聊过的对话。开图先原样保存，再帮你理出一个下一步，采不采纳由你定。"}
      </p>
      {error && (
        <p role="alert" className={v2.error}>
          {error}
        </p>
      )}
      {!matter ? (
        <>
          <fieldset className={css.examples} disabled={busy}>
            <legend className={v2.sr}>从一个示例开始</legend>
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
          <label htmlFor="onboarding-original">想改变的事或 AI 对话</label>
          <textarea
            ref={input}
            id="onboarding-original"
            rows={8}
            maxLength={100000}
            value={text}
            disabled={busy}
            onChange={(event) => setText(event.target.value)}
            placeholder="写下来，或粘贴一段和 AI 的对话"
          />
          <div className={css.footerActions}>
            <button
              type="button"
              className={quiet}
              disabled={busy || !text.trim()}
              onClick={() => void run(keep)}
            >
              只保存原文
            </button>
            <button
              type="button"
              className={primary}
              disabled={busy || !text.trim()}
              onClick={() => void run(organize)}
            >
              {busy ? "正在保存…" : "保存并整理"}
            </button>
          </div>
        </>
      ) : (
        <>
          <div className={css.badges}>
            <span>原文已保存</span>
            <span>需要你核对</span>
          </div>
          {busy && (
            <output className={v2.small}>{organizing ? "正在请 AI 整理，原文已保存…" : "正在保存…"}</output>
          )}
          {manual && (
            <p className={v2.small}>
              {props.builtin
                ? noAi
                  ? "尚未连接 AI，这三项由你自己填写。原文已保存，之后也能连接 AI 再整理。"
                  : "没有 AI 草稿时，这三项由你自己填写；也可以重新请 AI 整理。"
                : externalRequested
                  ? "到当前 AI 发送预填提示，再回到开图核对草稿。你也可以自己填写这三项。"
                  : "你可以自己填写这三项，也可以请当前 AI 整理成待核对草稿。"}
            </p>
          )}
          <div className={css.draftFields}>
            {field("goal", "当前目标")}
            {field("current", "已知现状")}
            {paths.length > 0 && (
              <fieldset className={css.paths} disabled={busy}>
                <legend>可能的路径</legend>
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
                      <span>为什么适合：{item.fit}</span>
                      <span>还有哪些不清楚：{item.unknown}</span>
                      <strong>小实验：{item.experiment}</strong>
                    </label>
                  ))}
                </div>
                <p className={v2.small}>AI 给的是可能性，选不选、选哪条由你定</p>
              </fieldset>
            )}
            {field("next", "一个下一步")}
          </div>
          <button type="button" className={v2.link} onClick={() => setRaw((value) => !value)}>
            {raw ? "收起原文" : `依据 · 查看${subject}`}
          </button>
          {raw && <pre className={css.original}>{matter.text}</pre>}
          <div className={css.footerActions}>
            {props.builtin ? (
              <button type="button" className={quiet} disabled={busy} onClick={() => void run(organize)}>
                重新请 AI 整理
              </button>
            ) : (
              <button type="button" className={quiet} disabled={busy} onClick={() => external(matter)}>
                请当前 AI 整理
              </button>
            )}
            <button type="button" className={quiet} disabled={busy} onClick={() => void run(keep)}>
              只保存原文
            </button>
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
              采纳这个下一步
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export function OnboardingNextCard(
  props: OnboardingServices & { next: OnboardingNext; refresh: () => Promise<void> },
) {
  const { next } = props;
  const [action, setAction] = useState<"complete" | "defer" | null>(null);
  const [value, setValue] = useState("");
  const [original, setOriginal] = useState<Matter | null>(null);
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
  return (
    <section className={`${v2.card} ${css.nextCard}`} aria-label="刚采纳的下一步">
      <span className={v2.eyebrow}>{next.status === "done" ? "这一步已完成" : "现在最该做的一件事"}</span>
      <h2>{next.next}</h2>
      <p className={v2.small}>
        为了：{next.goal}
        {next.due ? ` · 安排到 ${next.due}` : ""}
      </p>
      <button
        type="button"
        className={v2.link}
        disabled={busy}
        onClick={() =>
          void run(async () => {
            setOriginal(original ? null : await props.readOnboardingMatter(next.source));
          })
        }
      >
        依据 · {original ? "收起原文" : next.kind === "conversation" ? "查看这段对话" : "查看你写的这件事"}
      </button>
      {original && <pre className={css.original}>{original.text}</pre>}
      {next.status === "done" ? (
        <p>结果：{next.result}</p>
      ) : (
        <>
          {!action ? (
            <div className={css.footerActions}>
              <button
                type="button"
                className={primary}
                onClick={() => {
                  setAction("complete");
                  setValue("");
                }}
              >
                完成并记一句结果
              </button>
              <button
                type="button"
                className={quiet}
                onClick={() => {
                  setAction("defer");
                  setValue(next.due ?? "");
                }}
              >
                改到以后
              </button>
            </div>
          ) : (
            <form
              className={css.resultForm}
              onSubmit={(event) => {
                event.preventDefault();
                void run(async () => {
                  await props.changeOnboardingNext(next.id, next.rev, action, value);
                  await props.refresh();
                });
              }}
            >
              <label>
                {action === "complete" ? "记一句结果" : "安排到哪一天"}
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
                  取消
                </button>
                <button type="submit" className={primary} disabled={busy || !value.trim()}>
                  {busy ? "保存中…" : "保存"}
                </button>
              </div>
            </form>
          )}
        </>
      )}
      {error && (
        <p role="alert" className={v2.error}>
          {error}
        </p>
      )}
    </section>
  );
}
