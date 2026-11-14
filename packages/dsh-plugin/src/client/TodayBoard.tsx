import type { HomeState, HomeThread } from "@kaitu/core";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import css from "./Prototype.module.css";
import styles from "./TodayPage.module.css";
import { useLocale, useT } from "./i18n.js";
import { todayNumber, todayProjectDate } from "./next-presentation.js";

import {
  type ResultTransport,
  type Step,
  type TodayBoardSession,
  createTodayBoardSession,
  resultId,
} from "./result-session.js";
export { createTodayBoardSession, type TodayBoardSession } from "./result-session.js";
export function TodayBoard({
  data,
  resultAction,
  openProject,
  openGoal,
  library,
  begin,
  ask,
  canAsk,

  busy,
  session,
}: {
  data: HomeState;
  session?: TodayBoardSession;
  resultAction?: ResultTransport;
  openProject: (id: string) => void;
  openGoal?: (id: string) => void;
  library: () => void;
  begin?: () => void;
  ask: (text: string) => void;
  canAsk: boolean;

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
  const setError = (value: string) => board.set("error", value);
  const setReceipt = () => board.expire();
  const [review, setReview] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const composing = useRef(false);
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
  const resultDays = new Set(
    results
      ?.filter((item) => item.by === "user" || (item.file !== "task" && item.by === "unknown"))
      .map((item) => item.date),
  );
  const activityDays = data.data?.resultActivityDays;
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
    if (operation.current) return board.send(resultAction);
    if (!focus?.precondition || !focus.file) return;
    if (/[\r\n\u2028\u2029]/u.test(result) || Array.from(result).length > 2000) {
      setError(t("请保留草稿，改为一行且不超过2000字", "Keep the draft; use one line up to 2000 characters"));
      return;
    }
    await board.send(resultAction, {
      step: focus,
      text: result,
      request: {
        client_id: resultId(),
        op: "complete_next_result",
        args: {
          file: focus.file,
          id: focus.id,
          result_text: result,
          ...(focus.precondition.kind === "task"
            ? { expected_rev: focus.precondition.expectedRev }
            : { expected_next: { ...focus.precondition.expectedNext } }),
        },
      },
    });
  };
  const decide = (item: NonNullable<HomeState["data"]>["pending"][number], adopt: boolean) =>
    board.send(resultAction, {
      step: {
        id: item.id,
        key: `task:${item.id}`,
        file: "task",
        title: item.title,
        parent: t("AI 建议", "AI suggestion"),
        due: null,
        precondition: { kind: "task", expectedRev: item.rev },
      },
      text: adopt ? t("已采纳", "Adopted") : t("已忽略", "Dismissed"),
      request: {
        client_id: resultId(),
        op: adopt ? "adopt_task" : "cancel_task",
        args: { id: item.id, expected_rev: item.rev },
      },
    });
  const reverse = () => board.undo(resultAction);
  return (
    <div className={styles.todayBoard}>
      <button
        type="button"
        className={styles.resultWeek}
        aria-label={t(
          `近 7 天有结果的天数：${activityDays ?? "未知"}，打开近期回顾`,
          `Days with results in the past seven days: ${activityDays ?? "unknown"}. Open review`,
        )}
        aria-expanded={review}
        onClick={() => setReview(!review)}
      >
        <span>{t("7 天", "7 days")}</span>
        {days.map((day) => (
          <i key={day} title={day} data-result={resultDays.has(day)} data-today={day === today} />
        ))}
        <b>{activityDays ?? "—"}</b>
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
              <p style={{ whiteSpace: "pre-wrap" }}>{item.text}</p>
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
              <span>{receipt.text || t("已完成", "Completed")}</span>
              <button type="button" className={css.btn} disabled={pending} onClick={() => void reverse()}>
                {t("撤销", "Undo")}
              </button>
              <button type="button" className={css.link} onClick={() => setReceipt()}>
                {t("下一件", "Next")}
              </button>
            </div>
          ) : (
            <>
              {shown.file && shown.precondition ? (
                <form
                  className={styles.resultForm}
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (!composing.current) void finish();
                  }}
                >
                  {/[\r\n\u2028\u2029]/u.test(result) ? (
                    <textarea
                      aria-label={t("结果", "Result")}
                      value={result}
                      disabled={pending || !!operation.current}
                      onChange={(event) => {
                        if (focus) setDrafts((current) => ({ ...current, [focus.key]: event.target.value }));
                      }}
                    />
                  ) : (
                    <input
                      ref={field}
                      onCompositionStart={() => {
                        composing.current = true;
                      }}
                      onCompositionEnd={() => {
                        composing.current = false;
                      }}
                      onKeyDown={(event) => {
                        if (
                          event.key === "Enter" &&
                          (event.nativeEvent.isComposing ||
                            event.repeat ||
                            event.metaKey ||
                            event.ctrlKey ||
                            event.altKey ||
                            event.shiftKey)
                        )
                          event.preventDefault();
                      }}
                      onPaste={(event) => {
                        const pasted = event.clipboardData.getData("text");
                        if (/[\r\n\u2028\u2029]/u.test(pasted) && focus) {
                          event.preventDefault();
                          const input = event.currentTarget;
                          const value =
                            result.slice(0, input.selectionStart ?? result.length) +
                            pasted +
                            result.slice(input.selectionEnd ?? result.length);
                          setDrafts((current) => ({ ...current, [focus.key]: value }));
                          setError(t("请保留草稿，改为一行", "Keep the draft; use one line"));
                        }
                      }}
                      aria-label={t("结果", "Result")}
                      placeholder={t("结果", "Result")}
                      value={result}
                      disabled={pending || !!operation.current}
                      onChange={(event) => {
                        const value = event.target.value;
                        if (focus) setDrafts((current) => ({ ...current, [focus.key]: value }));
                      }}
                    />
                  )}
                  <button
                    className={`${css.btn} ${css["btn-strong"]}`}
                    disabled={pending || (showLatest && !!operation.current)}
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
                    setReceipt();
                    requestAnimationFrame(() => field.current?.focus());
                  }}
                />
                <button
                  type="button"
                  className={styles.stepTitle}
                  onClick={() => {
                    setSelected(step.key);
                    if (operation.current) board.set("showLatest", true);
                    setReceipt();
                  }}
                >
                  {step.title}
                </button>
                <span>{step.parent}</span>
                {step.due && <time data-overdue={step.due < today}>{step.due}</time>}
              </div>
            ))}
          {data.data?.pending.map((item) => (
            <div className={styles.stepRow} key={item.id}>
              <span aria-hidden="true">✎</span>
              <span className={styles.stepTitle}>{item.title}</span>
              <small>{t("AI 建议", "AI suggestion")}</small>
              <button
                type="button"
                className={css.btn}
                disabled={busy || pending || !!operation.current}
                onClick={() => void decide(item, true)}
              >
                {t("采纳", "Adopt")}
              </button>
              <button
                type="button"
                className={css.link}
                disabled={busy || pending || !!operation.current}
                aria-label={t(`不要这条建议：${item.title}`, `Dismiss suggestion: ${item.title}`)}
                onClick={() => void decide(item, false)}
              >
                ×
              </button>
            </div>
          ))}
        </section>
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
