import type { PlansData } from "@kaitu/core";
import { useRef, useState, useSyncExternalStore } from "react";
import css from "./Prototype.module.css";
import { TodayGoal } from "./TodayPage.js";
import { useT } from "./i18n.js";
import {
  type ResultTransport,
  type TodayBoardSession,
  createTodayBoardSession,
  resultId,
} from "./result-session.js";

const AI_NAMES: Record<string, string> = {
  chatgpt: "ChatGPT",
  claude: "Claude",
  gemini: "Gemini",
  doubao: "豆包",
  other: "AI",
};

type Mode = "next" | "complete" | "defer";

/**
 * 「你带来的规划」：所有进行中的目标放在一张卡上。没有下一步的目标可以直接定一个；
 * 已有下一步的目标可以直接完成并记一句结果，或改到以后，不只最新的那一步能处理。
 */
export function PlansCard({
  plans,
  resultSession,
  resultAction,
  goalId,
  addGoalNext,
  changeNext,
  refresh,
  open,
}: {
  plans: PlansData;
  resultSession?: TodayBoardSession;
  resultAction?: ResultTransport;
  goalId?: string;
  addGoalNext: (goalId: string, title: string) => Promise<unknown>;
  changeNext: (id: string, rev: number, action: string, value: string) => Promise<unknown>;
  refresh: () => Promise<void>;
  open: (section: "projects" | "directions") => void;
}) {
  const t = useT();
  // 打开表单时记下当时那一步；后台刷新换了下一步，也只改用户看到的那一步。
  const [editing, setEditing] = useState<{
    goal: string;
    mode: Mode;
    next?: { id: string; rev: number; title: string };
  } | null>(null);
  const [value, setValue] = useState("");
  const local = useRef(createTodayBoardSession());
  const owner = resultSession ?? local.current;
  const resultState = useSyncExternalStore(owner.subscribe, owner.read);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const goals = goalId ? plans.goals.filter((goal) => goal.id === goalId) : plans.goals;
  if (!goals.length) return null;
  const start = (goal: PlansData["goals"][number], mode: Mode, initial = "") => {
    const same = editing?.goal === goal.id && editing.mode === mode;
    const next = goal.next ? { id: goal.next.id, rev: goal.next.rev, title: goal.next.title } : undefined;
    setEditing(same ? null : { goal: goal.id, mode, ...(next ? { next } : {}) });
    setValue(mode === "complete" && next ? (owner.read().drafts[`task:${next.id}`] ?? initial) : initial);
    setError("");
  };
  const save = async (goal: PlansData["goals"][number], mode: Mode) => {
    if (mode === "next") return addGoalNext(goal.id, value.trim());
    if (mode === "defer") return changeNext(editing?.next?.id ?? "", editing?.next?.rev ?? 1, mode, value);
    const next = editing?.next;
    if (!next) throw new Error(t("事项已变化，请重新打开", "Step changed; reopen it"));
    if (/[\r\n\u2028\u2029]/u.test(value) || Array.from(value).length > 2000)
      throw new Error(
        t("请保留草稿，改为一行且不超过2000字", "Keep the draft; use one line up to 2000 characters"),
      );
    const pending = owner.operation.current;
    if (pending && pending.step.id !== next.id)
      throw new Error(t("请先核对上次结果", "Confirm the previous result first"));
    const saved = await owner.send(
      resultAction,
      pending ?? {
        step: {
          id: next.id,
          file: "task",
          key: `task:${next.id}`,
          title: next.title,
          parent: goal.title,
          due: null,
          precondition: { kind: "task", expectedRev: next.rev },
        },
        text: value,
        request: {
          client_id: resultId(),
          op: "complete_next_result",
          args: { file: "task", id: next.id, expected_rev: next.rev, result_text: value },
        },
      },
    );
    if (!saved)
      throw new Error(owner.read().error || t("请先核对上次结果", "Confirm the previous result first"));
  };
  const editValue = (text: string) => {
    setValue(text);
    if (editing?.mode === "complete" && editing.next)
      owner.set("drafts", (drafts) => ({ ...drafts, [`task:${editing.next?.id}`]: text }));
  };
  const origin = (goal: PlansData["goals"][number]) => {
    if (!goal.origin) return t("你的目标", "Your goal");
    const date = goal.origin.date.slice(5).replace("-", "/");
    if (goal.origin.source === "note") return t(`你写下的 · ${date}`, `You wrote it · ${date}`);
    if (goal.origin.source === "conversation")
      return t(`来自一段对话 · ${date}`, `From a conversation · ${date}`);
    const name = AI_NAMES[goal.origin.source] ?? "AI";
    return t(`从 ${name} 搬来 · ${date}`, `From ${name} · ${date}`);
  };
  const row = (goal: PlansData["goals"][number]) => (
    <div key={goal.id} id={`plan-${goal.id}`}>
      <div className={css.row}>
        <div className={`${css["row-title"]} ${css.stack}`}>
          <TodayGoal text={goal.title} title />
          <span className={css.small} style={{ whiteSpace: "pre-wrap" }}>
            {origin(goal)}
            {goal.results
              ? t(
                  ` · 记下 ${goal.results} 次结果`,
                  ` · ${goal.results} result${goal.results > 1 ? "s" : ""} logged`,
                )
              : ""}
            {goal.lastResult ? t(` · 最近：${goal.lastResult}`, ` · latest: ${goal.lastResult}`) : ""}
          </span>
        </div>
        {goal.next ? (
          <span className={css.planNext}>
            <span className={css.chip}>
              {t("下一步：", "Next: ")}
              {goal.next.title}
              {goal.next.due ? t(` · ${goal.next.due}`, ` · ${goal.next.due}`) : ""}
            </span>
            <button
              type="button"
              className={css.link}
              disabled={busy}
              onClick={() => start(goal, "complete")}
            >
              {t("完成", "Done")}
            </button>
            <button
              type="button"
              className={css.link}
              disabled={busy}
              onClick={() => start(goal, "defer", goal.next?.due ?? "")}
            >
              {t("改期", "Later")}
            </button>
          </span>
        ) : (
          <button
            type="button"
            className={`${css.btn} ${css["btn-quiet"]}`}
            disabled={busy}
            onClick={() => start(goal, "next")}
          >
            {t("定下一步", "Set a next step")}
          </button>
        )}
      </div>
      {editing?.goal === goal.id && (
        <form
          className={css["sub-form"]}
          onSubmit={(event) => {
            event.preventDefault();
            setBusy(true);
            setError("");
            void save(goal, editing.mode)
              .then(async () => {
                setEditing(null);
                await refresh();
              })
              .catch((err) => setError(err instanceof Error ? err.message : String(err)))
              .finally(() => setBusy(false));
          }}
        >
          <label className={css.small} htmlFor={`goal-${editing.mode}-${goal.id}`}>
            {editing.mode === "next"
              ? t("一个今天或这周就能做的下一步", "One next step you can take today or this week")
              : editing.mode === "complete"
                ? t(
                    `「${goal.next?.title ?? ""}」怎么样了？记一句结果`,
                    `How did “${goal.next?.title ?? ""}” go? One line`,
                  )
                : t("安排到哪一天", "Which day")}
          </label>
          {/[\r\n\u2028\u2029]/u.test(value) && editing.mode === "complete" ? (
            <textarea
              id={`goal-${editing.mode}-${goal.id}`}
              value={value}
              disabled={busy || !!owner.operation.current}
              onChange={(event) => editValue(event.target.value)}
            />
          ) : (
            <input
              id={`goal-${editing.mode}-${goal.id}`}
              type={editing.mode === "defer" ? "date" : "text"}
              value={value}
              disabled={busy || (editing.mode === "complete" && !!owner.operation.current)}
              onChange={(event) => editValue(event.target.value)}
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
                const text = event.clipboardData.getData("text");
                if (editing.mode === "complete" && /[\r\n\u2028\u2029]/u.test(text)) {
                  event.preventDefault();
                  editValue(
                    value.slice(0, event.currentTarget.selectionStart ?? value.length) +
                      text +
                      value.slice(event.currentTarget.selectionEnd ?? value.length),
                  );
                }
              }}
            />
          )}
          {error && (
            <p role="alert" className={css.error}>
              {error}
            </p>
          )}
          <div className={css["dialog-foot"]}>
            <button type="button" className={css.link} disabled={busy} onClick={() => setEditing(null)}>
              {t("取消", "Cancel")}
            </button>
            <button
              type="submit"
              className={`${css.btn} ${css["btn-primary"]}`}
              disabled={busy || (editing.mode !== "complete" && !value.trim())}
            >
              {busy ? t("保存中…", "Saving…") : t("保存", "Save")}
            </button>
          </div>
        </form>
      )}
    </div>
  );
  return (
    <section className={css.sec} aria-labelledby="plans-title">
      {resultState.receipt && (
        <div aria-live="polite">
          <span>{resultState.receipt.text || t("已完成", "Completed")}</span>
          <button
            type="button"
            className={css.btn}
            disabled={resultState.pending}
            onClick={() => void owner.undo(resultAction)}
          >
            {t("撤销", "Undo")}
          </button>
        </div>
      )}
      {resultState.error && <p role="alert">{resultState.error}</p>}
      {owner.operation.current && (
        <button
          type="button"
          className={css.btn}
          disabled={resultState.pending}
          onClick={() => void owner.send(resultAction)}
        >
          {t("核对上次结果", "Check previous result")}
        </button>
      )}
      <div className={css["sec-head"]}>
        <h2 id="plans-title" className={css.eyebrow}>
          {t("你带来的规划", "Your plans")}
        </h2>
        <span className={css.small}>
          {t(`${goals.length} 个目标`, `${goals.length} goal${goals.length > 1 ? "s" : ""}`)}
        </span>
      </div>
      <div className={`${css.card} ${css["list-card"]} ${css.plans}`}>
        {goals.slice(0, 5).map(row)}
        {goals.length > 5 && (
          <details>
            <summary className={css.link}>
              {t(`其余 ${goals.length - 5} 个目标`, `${goals.length - 5} more goals`)}
            </summary>
            {goals.slice(5).map(row)}
          </details>
        )}
      </div>
      {!goalId && (plans.projects > 0 || plans.directions > 0) && (
        <p className={css.small}>
          {plans.projects > 0 && (
            <button type="button" className={css.link} onClick={() => open("projects")}>
              {t(`${plans.projects} 件在做的事`, `${plans.projects} project${plans.projects > 1 ? "s" : ""}`)}
            </button>
          )}
          {plans.projects > 0 && plans.directions > 0 && " · "}
          {plans.directions > 0 && (
            <button type="button" className={css.link} onClick={() => open("directions")}>
              {t(
                `${plans.directions} 个在探索的方向`,
                `${plans.directions} direction${plans.directions > 1 ? "s" : ""} to explore`,
              )}
            </button>
          )}
        </p>
      )}
    </section>
  );
}
