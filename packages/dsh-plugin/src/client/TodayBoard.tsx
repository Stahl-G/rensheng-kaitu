import type { HomeCompletion, HomeNextTarget, HomeState, HomeThread } from "@kaitu/core";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import css from "./Prototype.module.css";
import { type TaskDecisionServices, TaskSuggestions } from "./TaskSuggestions.js";
import styles from "./TodayPage.module.css";
import { useLocale, useT } from "./i18n.js";
import { todayNumber, todayProjectDate } from "./next-presentation.js";

type Step = HomeNextTarget & { key: string; parent: string };
interface TodayDraftState {
  selected: string | undefined;
  showLatest: boolean;
  drafts: Record<string, string>;
  pending: boolean;
  error: string;
  receipt: { value: HomeCompletion; step: Step; text: string } | undefined;
}
/** Kept by the page owner so navigation cannot lose a draft or an in-flight receipt. */
export function createTodayBoardSession() {
  let state: TodayDraftState = {
    selected: undefined,
    showLatest: false,
    drafts: {},
    pending: false,
    error: "",
    receipt: undefined,
  };
  const listeners = new Set<() => void>();
  return {
    operation: {
      current: undefined as { fingerprint: string; id: string; step: Step; text: string } | undefined,
    },
    read: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    set: <K extends keyof TodayDraftState>(
      key: K,
      value: TodayDraftState[K] | ((current: TodayDraftState[K]) => TodayDraftState[K]),
    ) => {
      state = { ...state, [key]: typeof value === "function" ? value(state[key]) : value };
      for (const listener of listeners) listener();
    },
  };
}
export type TodayBoardSession = ReturnType<typeof createTodayBoardSession>;
/** The owner and the visible receipt use the same undo operation across navigation. */
export async function reverseTodayBoard(
  board: TodayBoardSession,
  undo: (token: string) => Promise<{ undone: boolean }>,
) {
  const { receipt, pending } = board.read();
  if (!receipt || pending) return;
  board.set("pending", true);
  board.set("error", "");
  try {
    await undo(receipt.value.token);
    board.set("selected", receipt.step.key);
    board.set("drafts", (current) => ({ ...current, [receipt.step.key]: receipt.text }));
    board.set("receipt", undefined);
  } catch (err) {
    board.set("error", err instanceof Error ? err.message : String(err));
  } finally {
    board.set("pending", false);
  }
}
export function TodayBoard({
  data,
  decisions,
  complete,
  undo,
  openProject,
  openGoal,
  library,
  begin,
  ask,
  canAsk,
  session,
}: {
  data: HomeState;
  decisions?: TaskDecisionServices;
  session?: TodayBoardSession;
  complete?: (target: HomeNextTarget, result: string, operationId: string) => Promise<HomeCompletion>;
  undo?: (token: string) => Promise<{ undone: boolean }>;
  openProject: (id: string) => void;
  openGoal?: (id: string) => void;
  library: () => void;
  begin?: () => void;
  ask: (text: string) => void;
  canAsk: boolean;
  adopt: (id: string) => void;
  dismiss: (id: string) => void;
  busy: boolean;
}) {
  const t = useT();
  const locale = useLocale();
  const threads = data.data?.threads ?? [];
  const steps: Step[] =
    data.data?.steps ??
    threads.flatMap((thread) =>
      thread.next ? [{ ...thread.next, key: thread.key, parent: thread.title }] : [],
    );
  const localSession = useRef(session ?? createTodayBoardSession());
  const board = session ?? localSession.current;
  const { selected, showLatest, drafts, pending, error, receipt } = useSyncExternalStore(
    board.subscribe,
    board.read,
  );
  const setSelected = (value: string | undefined) => board.set("selected", value);
  const setDrafts = (
    value: Record<string, string> | ((current: Record<string, string>) => Record<string, string>),
  ) => board.set("drafts", value);
  const setPending = (value: boolean) => board.set("pending", value);
  const setError = (value: string) => board.set("error", value);
  const setReceipt = (value: TodayDraftState["receipt"]) => board.set("receipt", value);
  const [review, setReview] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const operation = board.operation;
  const focus =
    (!showLatest ? operation.current?.step : undefined) ??
    steps.find((step) => step.key === selected) ??
    steps[0];
  const shown = receipt?.step ?? focus;
  const result =
    (!showLatest ? operation.current?.text : undefined) ?? (focus ? (drafts[focus.key] ?? "") : "");
  const results = data.data?.results;
  const today = data.data?.today ?? "";
  const days = Array.from({ length: 7 }, (_, index) =>
    today
      ? new Date(Date.parse(`${today}T12:00:00Z`) - (6 - index) * 86400000).toISOString().slice(0, 10)
      : "",
  );
  const resultDays = new Set(results?.map((item) => item.date));
  const openThread = (thread: HomeThread) =>
    thread.kind === "project"
      ? openProject(thread.id)
      : thread.kind === "goal" && openGoal
        ? openGoal(thread.id)
        : library();
  useEffect(() => {
    if (typeof window === "undefined") return;
    const focusCurrent = () => {
      field.current?.focus();
    };
    window.addEventListener("kaitu:complete-current", focusCurrent);
    return () => window.removeEventListener("kaitu:complete-current", focusCurrent);
  }, []);
  const finish = async () => {
    const target = operation.current?.step ?? focus;
    const text = operation.current?.text ?? result;
    if (!target || !complete || board.read().pending || !text.trim()) return;
    setPending(true);
    setError("");
    const fingerprint = JSON.stringify([target, text.trim()]);
    if (operation.current?.fingerprint !== fingerprint)
      operation.current = { fingerprint, id: crypto.randomUUID(), step: target, text };
    try {
      const value = await complete(target, text, operation.current.id);
      board.set("showLatest", false);
      setReceipt({ value, step: target, text });
      operation.current = undefined;
    } catch (err) {
      const failure = err && typeof err === "object" ? err : {};
      const remoteCode = "code" in failure ? failure.code : undefined;
      const details =
        "details" in failure && failure.details && typeof failure.details === "object" ? failure.details : {};
      const code =
        remoteCode === "kaitu/completion-rejected" && "code" in details ? details.code : remoteCode;
      if (["CONFLICT", "BAD_ARGS", "INVALID_DOCUMENT", "INVALID_RECORD"].includes(String(code)))
        operation.current = undefined;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  };
  const reverse = () => undo && reverseTodayBoard(board, undo);
  return (
    <div className={styles.todayBoard}>
      <button
        type="button"
        className={styles.resultWeek}
        aria-label={t(
          `近 7 天有结果的天数：${results ? resultDays.size : "未知"}，打开近期回顾`,
          `Days with results in the past seven days: ${results ? resultDays.size : "unknown"}. Open review`,
        )}
        aria-expanded={review}
        onClick={() => setReview(!review)}
      >
        <span>{t("7 天", "7 days")}</span>
        {days.map((day) => (
          <i key={day} title={day} data-result={resultDays.has(day)} data-today={day === today} />
        ))}
        <b>{results ? resultDays.size : "—"}</b>
      </button>
      {review && (
        <section className={styles.weekReview} aria-label={t("近期回顾", "Recent review")}>
          <div className={styles.sectionHeading}>
            <h2>{t("近 7 天的结果", "Results in the past seven days")}</h2>
            <button type="button" className={css.link} onClick={() => setReview(false)}>
              {t("收起", "Close")}
            </button>
          </div>
          {!results?.length && (
            <p>{results ? t("还没有记下结果", "No results recorded yet") : t("正在读取…", "Loading…")}</p>
          )}
          {results?.map((item) => (
            <article key={`${item.file}:${item.id}:${item.at}`}>
              <time dateTime={item.at}>{todayProjectDate(item.date, today, locale)}</time>
              <strong>{item.title}</strong>
              <p>{item.text}</p>
            </article>
          ))}
        </section>
      )}
      {showLatest && operation.current && (
        <section className={styles.stepList} aria-label={t("上次结果待核实", "Previous result unconfirmed")}>
          <strong>{operation.current.step.title}</strong>
          <button type="button" className={css.btn} disabled={pending} onClick={() => void finish()}>
            {t("核对上次结果", "Check previous result")}
          </button>
        </section>
      )}
      {shown ? (
        <section
          className={styles.actionCard}
          data-done={!!receipt}
          aria-label={t("当前事项", "Current step")}
        >
          <div className={styles.actionMeta}>
            <span>{shown.parent}</span>
            {shown.due && <time dateTime={shown.due}>{shown.due}</time>}
          </div>
          <h2>
            <mark>{shown.title}</mark>
          </h2>
          {receipt ? (
            <div className={styles.completionReceipt} aria-live="polite">
              <span>{receipt.text}</span>
              <button type="button" className={css.btn} disabled={pending} onClick={() => void reverse()}>
                {t("撤销", "Undo")} ⌘Z
              </button>
              <button type="button" className={css.link} onClick={() => setReceipt(undefined)}>
                {t("下一件", "Next")}
              </button>
            </div>
          ) : (
            <>
              {complete && shown.file && shown.precondition ? (
                <form
                  className={styles.resultForm}
                  onSubmit={(event) => {
                    event.preventDefault();
                    void finish();
                  }}
                >
                  <input
                    ref={field}
                    aria-label={t("结果", "Result")}
                    placeholder={t("结果", "Result")}
                    maxLength={2000}
                    value={result}
                    disabled={pending || !!operation.current}
                    onChange={(event) => {
                      const value = event.target.value;
                      if (focus) setDrafts((current) => ({ ...current, [focus.key]: value }));
                    }}
                  />
                  <button
                    className={`${css.btn} ${css["btn-strong"]}`}
                    disabled={pending || !result.trim() || (showLatest && !!operation.current)}
                    type="submit"
                  >
                    {pending
                      ? t("正在保存…", "Saving…")
                      : operation.current
                        ? t("重试", "Retry")
                        : t("完成", "Done")}{" "}
                    ↩
                  </button>
                </form>
              ) : null}
              {canAsk && (
                <button
                  type="button"
                  className={css.link}
                  onClick={() =>
                    ask(
                      t(
                        `帮我推进「${shown.title}」。先读相关资料。`,
                        `Help me move “${shown.title}” forward. Read related notes first.`,
                      ),
                    )
                  }
                >
                  {t("问问", "Ask")}
                </button>
              )}
            </>
          )}
        </section>
      ) : (
        <section className={styles.actionCard}>
          <h2>
            {data.loading
              ? t("正在读取…", "Loading…")
              : t("今天想推进什么？", "What would you like to move forward?")}
          </h2>
          <button type="button" className={css.btn} onClick={begin ?? library}>
            {begin ? t("开始", "Get started") : t("打开资料", "Open Library")}
          </button>
        </section>
      )}
      {error && (
        <div role="alert" className={css.error}>
          <p>{error}</p>
          {operation.current && !pending && (
            <button
              type="button"
              className={css.link}
              onClick={() => {
                board.set("showLatest", true);
                setSelected(undefined);
                setError("");
              }}
            >
              {t("查看最新事项", "View latest steps")}
            </button>
          )}
        </div>
      )}
      {(steps.length > 1 || !!data.data?.pending.length) && (
        <section className={styles.stepList} aria-label={t("接下来", "Up next")}>
          {steps
            .filter((step) => step.key !== shown?.key)
            .slice(0, 2)
            .map((step) => (
              <div className={styles.stepRow} key={step.key}>
                <button
                  type="button"
                  className={styles.stepCircle}
                  disabled={pending}
                  aria-label={t(`完成并记结果：${step.title}`, `Complete and record result: ${step.title}`)}
                  onClick={() => {
                    setSelected(step.key);
                    if (operation.current) board.set("showLatest", true);
                    setReceipt(undefined);
                    requestAnimationFrame(() => field.current?.focus());
                  }}
                />
                <button
                  type="button"
                  className={styles.stepTitle}
                  onClick={() => {
                    setSelected(step.key);
                    if (operation.current) board.set("showLatest", true);
                    setReceipt(undefined);
                  }}
                >
                  {step.title}
                </button>
                <span>{step.parent}</span>
                {step.due && <time data-overdue={step.due < today}>{step.due}</time>}
              </div>
            ))}
        </section>
      )}
      {decisions && (
        <TaskSuggestions key={decisions.root} pending={data.data?.pending ?? []} services={decisions} />
      )}
      {threads.length > 0 && (
        <section className={styles.threadLinks} aria-label={t("接着上次", "Continue")}>
          {threads.slice(0, 3).map((thread) => (
            <button
              type="button"
              key={thread.key}
              aria-label={t(`打开${thread.title}`, `Open ${thread.title}`)}
              onClick={() => openThread(thread)}
            >
              <strong>{thread.title}</strong>
              {thread.last && <span>{thread.last.text}</span>}
              {thread.resultCount !== null && (
                <small>{t(`${thread.resultCount} 条结果`, `${thread.resultCount} results`)}</small>
              )}
            </button>
          ))}
        </section>
      )}
      {!!data.data?.traces.length && (
        <section className={styles.traceCards} aria-label={t("最近的痕迹", "Recent traces")}>
          {data.data.traces.slice(0, 3).map((trace) => (
            <article key={trace.key}>
              <strong>
                {trace.label}
                {trace.value !== null
                  ? ` ${trace.estimated ? "≈" : ""}${todayNumber(trace.value, locale)} ${trace.unit ?? ""}`
                  : ""}
              </strong>
              <time dateTime={trace.date}>{todayProjectDate(trace.date, today, locale)}</time>
            </article>
          ))}
        </section>
      )}
      {data.error && <p role="alert">{data.error}</p>}
    </div>
  );
}
