import type { PlansData } from "@kaitu/core";
import { useState } from "react";
import css from "./Prototype.module.css";
import { useT } from "./i18n.js";

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
  addGoalNext,
  changeNext,
  refresh,
  open,
}: {
  plans: PlansData;
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
    next?: { id: string; rev: number };
  } | null>(null);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!plans.goals.length) return null;
  const start = (goal: PlansData["goals"][number], mode: Mode, initial = "") => {
    const same = editing?.goal === goal.id && editing.mode === mode;
    const next = goal.next ? { id: goal.next.id, rev: goal.next.rev } : undefined;
    setEditing(same ? null : { goal: goal.id, mode, ...(next ? { next } : {}) });
    setValue(initial);
    setError("");
  };
  const save = (goal: PlansData["goals"][number], mode: Mode) =>
    mode === "next"
      ? addGoalNext(goal.id, value.trim())
      : changeNext(
          editing?.next?.id ?? "",
          editing?.next?.rev ?? 1,
          mode,
          mode === "complete" ? value.trim() : value,
        );
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
    <div key={goal.id}>
      <div className={css.row}>
        <span className={`${css["row-title"]} ${css.stack}`}>
          <b>{goal.title}</b>
          <span className={css.small}>
            {origin(goal)}
            {goal.results
              ? t(
                  ` · 记下 ${goal.results} 次结果`,
                  ` · ${goal.results} result${goal.results > 1 ? "s" : ""} logged`,
                )
              : ""}
            {goal.lastResult ? t(` · 最近：${goal.lastResult}`, ` · latest: ${goal.lastResult}`) : ""}
          </span>
        </span>
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
          <input
            id={`goal-${editing.mode}-${goal.id}`}
            type={editing.mode === "defer" ? "date" : "text"}
            value={value}
            maxLength={2000}
            disabled={busy}
            onChange={(event) => setValue(event.target.value)}
          />
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
              disabled={busy || !value.trim()}
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
      <div className={css["sec-head"]}>
        <h2 id="plans-title" className={css.eyebrow}>
          {t("你带来的规划", "Your plans")}
        </h2>
        <span className={css.small}>
          {t(
            `${plans.goals.length} 个目标`,
            `${plans.goals.length} goal${plans.goals.length > 1 ? "s" : ""}`,
          )}
        </span>
      </div>
      <div className={`${css.card} ${css["list-card"]} ${css.plans}`}>
        {plans.goals.slice(0, 5).map(row)}
        {plans.goals.length > 5 && (
          <details>
            <summary className={css.link}>
              {t(`其余 ${plans.goals.length - 5} 个目标`, `${plans.goals.length - 5} more goals`)}
            </summary>
            {plans.goals.slice(5).map(row)}
          </details>
        )}
      </div>
      {(plans.projects > 0 || plans.directions > 0) && (
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
