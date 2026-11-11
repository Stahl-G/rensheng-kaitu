import type {
  HomeData,
  LocalTaskDecisions,
  PhoneReceipt,
  TaskDecisionAction,
  TaskDecisionScope,
} from "@kaitu/core";
import { useCallback, useEffect, useRef, useState } from "react";
import css from "./Prototype.module.css";
import styles from "./TodayPage.module.css";
import { useT } from "./i18n.js";

export interface TaskDecisionServices {
  root: string;
  load: (root: string) => Promise<LocalTaskDecisions>;
  submit: (scope: TaskDecisionScope, action: TaskDecisionAction) => Promise<PhoneReceipt>;
  retry: (scope: TaskDecisionScope, clientId: string) => Promise<PhoneReceipt>;
  changed: () => void;
  activity: () => void;
  historyRequest: number;
}
export function TaskSuggestions({
  pending,
  services,
}: {
  pending: HomeData["pending"];
  services: TaskDecisionServices;
}) {
  const t = useT();
  const [state, setState] = useState<LocalTaskDecisions>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState(false);
  const historyButton = useRef<HTMLButtonElement>(null);
  const revealed = useRef(0);
  const active = useRef<object>();
  const inFlight = useRef<{ owner: object }>();
  const loadSequence = useRef(0);
  const { root, load } = services;
  const refresh = useCallback(
    async (owner: object) => {
      const sequence = ++loadSequence.current;
      const next = await load(root);
      if (active.current === owner && sequence === loadSequence.current && next.scope.root === root)
        setState(next);
    },
    [root, load],
  );
  useEffect(() => {
    const owner = { root, load };
    active.current = owner;
    setState(undefined);
    setBusy(false);
    setError("");
    return () => {
      active.current = undefined;
    };
  }, [root, load]);
  useEffect(() => {
    const owner = active.current;
    if (owner && pending)
      void refresh(owner).catch((err) => {
        if (active.current === owner) setError(String(err.message ?? err));
      });
  }, [pending, refresh]);
  useEffect(() => {
    if (services.historyRequest) setHistory(true);
  }, [services.historyRequest]);
  useEffect(() => {
    const request = services.historyRequest;
    if (!history || !request || revealed.current === request) return;
    revealed.current = request;
    historyButton.current?.scrollIntoView({ block: "nearest" });
    historyButton.current?.focus({ preventScroll: true });
  }, [history, services.historyRequest]);
  const run = async (operation: (scope: TaskDecisionScope) => Promise<PhoneReceipt>) => {
    const owner = active.current;
    if (!state || !owner || inFlight.current?.owner === owner) return;
    const flight = { owner };
    inFlight.current = flight;
    services.activity();
    setBusy(true);
    setError("");
    try {
      const receipt = await operation(state.scope);
      if (active.current !== owner) return;
      if (receipt.status === "conflict" || receipt.status === "rejected")
        setError(receipt.message ?? t("未处理，请重新读取", "Not processed. Reload"));
      await refresh(owner);
      if (active.current === owner) services.changed();
    } catch (err) {
      if (active.current === owner) {
        setError(err && typeof err === "object" && "message" in err ? String(err.message) : String(err));
        // An unknown response is never a failed write. Enumerate the durable original request.
        try {
          await refresh(owner);
        } catch {
          /* Keep the error and existing request visible. */
        }
      }
    } finally {
      if (inFlight.current === flight) {
        inFlight.current = undefined;
        if (active.current === owner) setBusy(false);
      }
    }
  };
  const unknown = state?.requests.filter((item) => !item.receipt) ?? [];
  const held = unknown.some((item) => item.action.args.consumer_id !== state?.scope.consumer_id);
  const decide = (item: HomeData["pending"][number], decision: "adopted" | "dismissed") => {
    if (!item.file || !state) return;
    const action: TaskDecisionAction = {
      client_id: crypto.randomUUID(),
      op: "decide_task",
      args: {
        consumer_id: state.scope.consumer_id,
        file: item.file,
        id: item.id,
        expected_rev: item.rev,
        expected_source: item.source,
        decision,
      },
    };
    void run((scope) => services.submit(scope, action));
  };
  return (
    <section className={styles.stepList} aria-label={t("建议", "Suggestions")}>
      {pending
        .filter(
          (item) =>
            !state?.decisions.some(
              (decision) =>
                decision.id === item.id &&
                decision.file === item.file &&
                decision.source === item.source &&
                decision.status !== "undone" &&
                decision.rev > item.rev,
            ),
        )
        .map((item) => {
          const unresolved = unknown.some(({ action }) => "id" in action.args && action.args.id === item.id);
          return (
            <div className={styles.stepRow} key={item.id}>
              <span aria-hidden="true">✎</span>
              <span className={styles.stepTitle}>{item.title}</span>
              <small>{item.file ? t("AI 建议", "AI suggestion") : t("资料冲突", "Source conflict")}</small>
              <button
                type="button"
                className={css.btn}
                disabled={busy || !state || !item.file || unresolved || held || unknown.length > 0}
                onClick={() => decide(item, "adopted")}
              >
                {t("采纳", "Adopt")}
              </button>
              <button
                type="button"
                className={css.link}
                disabled={busy || !state || !item.file || unresolved || held || unknown.length > 0}
                onClick={() => decide(item, "dismissed")}
                aria-label={t(`不要这条建议：${item.title}`, `Dismiss suggestion: ${item.title}`)}
              >
                ×
              </button>
            </div>
          );
        })}
      {unknown.map(({ action }) => (
        <div className={styles.stepRow} key={action.client_id}>
          <span>
            {action.op === "undo_task_decision"
              ? t("撤销待核对", "Undo unconfirmed")
              : t("建议操作待核对", "Decision unconfirmed")}
          </span>
          {action.args.consumer_id !== state?.scope.consumer_id ? (
            <span role="alert">
              {t("工作区身份已变化，原请求待核对", "Workspace identity changed. Original request held")}
            </span>
          ) : (
            <button
              type="button"
              className={css.btn}
              disabled={busy}
              onClick={() => void run((scope) => services.retry(scope, action.client_id))}
            >
              {t("核对原请求", "Check original request")}
            </button>
          )}
        </div>
      ))}
      {error && (
        <div role="alert">
          <p>{error}</p>
          <button
            type="button"
            className={css.link}
            disabled={busy}
            onClick={() => {
              const owner = active.current;
              if (owner)
                void refresh(owner).catch((err) => {
                  if (active.current === owner) setError(String(err.message ?? err));
                });
            }}
          >
            {t("重新读取", "Reload")}
          </button>
        </div>
      )}
      <button
        ref={historyButton}
        type="button"
        className={css.link}
        aria-expanded={history}
        onClick={() => setHistory(!history)}
      >
        {t("已处理建议", "Decision history")}
      </button>
      {history &&
        state?.decisions
          .slice()
          .reverse()
          .map((item) => (
            <article className={styles.decisionEntry} key={item.decision_id}>
              <strong>{item.title}</strong>
              <span>
                {item.status === "undone"
                  ? t("已撤销", "Undone")
                  : item.status === "adopted"
                    ? t("已采纳", "Adopted")
                    : t("已拒绝", "Dismissed")}
              </span>
              {item.source && <span className={styles.decisionSource}>{item.source}</span>}
              {item.status !== "undone" && (
                <button
                  type="button"
                  className={css.btn}
                  disabled={busy || held || !item.can_undo || unknown.length > 0}
                  onClick={() =>
                    void run((scope) =>
                      services.submit(scope, {
                        client_id: crypto.randomUUID(),
                        op: "undo_task_decision",
                        args: { consumer_id: scope.consumer_id, decision_id: item.decision_id },
                      }),
                    )
                  }
                >
                  {t("撤销", "Undo")}
                </button>
              )}
              {item.status !== "undone" && !item.can_undo && <span>{t("事项已更新", "Item changed")}</span>}
            </article>
          ))}
    </section>
  );
}
