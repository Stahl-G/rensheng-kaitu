import { useState } from "react";
import css from "./PlanReading.module.css";
import v2 from "./Prototype.module.css";
import { useT } from "./i18n.js";
import { planReading } from "./plan-reading.js";

export type ReadPlanOriginal = (source: string) => Promise<{ text: string }>;

export function PlanDetails({
  goal,
  step,
  current,
  lastResult,
  goalSource,
  source,
  captureSource,
  readOriginal,
}: {
  goal?: string;
  step?: string;
  current?: string;
  lastResult?: string;
  goalSource?: string;
  source?: string;
  captureSource?: string;
  readOriginal?: ReadPlanOriginal;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [originalOpen, setOriginalOpen] = useState(false);
  const [original, setOriginal] = useState<{ source: string; text?: string; error?: boolean } | undefined>();
  const load = () => {
    if (!captureSource || !readOriginal) return;
    setOriginal({ source: captureSource });
    void readOriginal(captureSource)
      .then((record) => setOriginal({ source: captureSource, text: record.text }))
      .catch(() => setOriginal({ source: captureSource, error: true }));
  };
  if (!goal && !step && !current && !lastResult) return null;
  const entries = open ? planReading(goal ?? "", "goal") : [];
  const stepEntries = open ? planReading(step ?? "", "goal") : [];
  const background = open ? planReading(current ?? "", "background") : [];
  const render = (heading: string, rows: ReturnType<typeof planReading>) => {
    if (!rows.length) return null;
    const unique = new Map(rows.map((row) => [JSON.stringify([row.date, row.text]), row]));
    return (
      <div>
        <b>{heading}</b>
        <ul>
          {[...unique.values()].map(({ text, date }) => (
            <li key={JSON.stringify([date, text])}>
              {date && <time dateTime={date}>{date}</time>}
              {text}
            </li>
          ))}
        </ul>
      </div>
    );
  };
  return (
    <details className={css.details} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className={v2.link}>{t("详情", "Details")}</summary>
      {open && (
        <div className={css.body}>
          {render(
            t("当前目标", "Current goal"),
            entries.filter((entry) => entry.group === "goal"),
          )}
          {render(
            t("下一步", "Next step"),
            stepEntries.filter((entry) => entry.group === "goal"),
          )}
          {render(
            t("相关背景", "Relevant background"),
            [...entries, ...stepEntries, ...background].filter((entry) => entry.group === "background"),
          )}
          {render(
            t("历史考虑", "Earlier considerations"),
            [...entries, ...stepEntries, ...background].filter((entry) => entry.group === "history"),
          )}
          {render(
            t("记录摘录", "Record excerpts"),
            [...entries, ...stepEntries, ...background].filter((entry) => entry.group === "context"),
          )}
          {lastResult && (
            <div>
              <b>{t("最近结果", "Latest result")}</b>
              <ul>
                <li>{lastResult}</li>
              </ul>
            </div>
          )}
          <details
            className={css.raw}
            onToggle={(event) => {
              const shown = event.currentTarget.open;
              setOriginalOpen(shown);
              if (shown && original?.source !== captureSource) load();
            }}
          >
            <summary className={v2.link}>{t("查看原始记录", "View original record")}</summary>
            {originalOpen && (
              <div className={css.original}>
                {goal && (
                  <div>
                    {goalSource && <code>{goalSource}</code>}
                    <pre>{goal}</pre>
                  </div>
                )}
                {step && (
                  <div>
                    {source && source !== captureSource && <code>{source}</code>}
                    <pre>{step}</pre>
                  </div>
                )}
                {current && <pre>{current}</pre>}
                {captureSource &&
                  readOriginal &&
                  (original?.source !== captureSource || (!original.error && original.text === undefined) ? (
                    <output>{t("正在读取…", "Loading…")}</output>
                  ) : original.error ? (
                    <div>
                      <p role="alert">{t("无法读取原文", "Couldn’t read original")}</p>
                      <button type="button" className={v2.link} onClick={load}>
                        {t("重试", "Retry")}
                      </button>
                    </div>
                  ) : (
                    <div>
                      <code>{captureSource}</code>
                      <pre>{original.text}</pre>
                    </div>
                  ))}
              </div>
            )}
          </details>
        </div>
      )}
    </details>
  );
}
