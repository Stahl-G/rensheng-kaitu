import type { CalendarPushSettings } from "@kaitu/core";
import { useState } from "react";
import css from "./Prototype.module.css";

export interface CalendarPushServices {
  loadCalendarPush: () => Promise<CalendarPushSettings>;
  retryCalendarPush: (id: string) => Promise<CalendarPushSettings>;
  configureCalendarPush: (enabled: boolean) => Promise<CalendarPushSettings>;
  removeCalendarPush: () => Promise<CalendarPushSettings>;
  scheduleNext: (file: string, id: string, start: string, end: string) => Promise<unknown>;
  editCalendarBlock: (id: string, start: string, end: string) => Promise<unknown>;
}

export function CalendarPushResult({
  id,
  state,
  retry,
}: {
  id: string;
  state: CalendarPushSettings | null;
  retry: (id: string) => Promise<unknown>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const receipt = state?.entries[id];
  if (!receipt) return state && !state.enabled ? <span className={css.small}>系统日历已关闭</span> : null;
  const labels = {
    added: "已加入『开图』日历",
    file: "已生成日历文件",
    deleted: "已从日历删除",
    removed: "已移除日历安排",
    error: "日历操作失败",
  };
  return (
    <output className={css.stack}>
      <span>
        {receipt.status === "removed" && receipt.ics ? "已生成取消日历文件" : labels[receipt.status]}
      </span>
      {receipt.reason && <span className={css.small}>{receipt.reason}</span>}
      {receipt.ics && (
        <a
          className={css.link}
          download={`kaitu-block-${encodeURIComponent(id)}.ics`}
          href={`data:text/calendar;charset=utf-8,${encodeURIComponent(receipt.ics)}`}
        >
          下载日历文件
        </a>
      )}
      {["file", "error"].includes(receipt.status) && (
        <button
          type="button"
          className={css.link}
          disabled={busy || (!state?.enabled && receipt.status !== "error")}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              await retry(id);
            } catch (err) {
              setError(err instanceof Error ? err.message : String(err));
            } finally {
              setBusy(false);
            }
          }}
        >
          重试日历操作
        </button>
      )}
      {error && <span role="alert">{error}</span>}
    </output>
  );
}

export function CalendarSlotForm({
  date,
  start = "",
  end = "",
  save,
  close,
}: {
  date: string;
  start?: string;
  end?: string;
  save: (start: string, end: string) => Promise<unknown>;
  close: () => void;
}) {
  const [from, setFrom] = useState(start);
  const [to, setTo] = useState(end);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <form
      className={`${css.card} ${css["sub-form"]}`}
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setError("");
        try {
          await save(from, to);
          close();
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      <b>安排时间段 · {date}</b>
      <div className={css.fields}>
        <label>
          开始时间
          <input type="time" required value={from} onChange={(event) => setFrom(event.target.value)} />
        </label>
        <label>
          结束时间
          <input type="time" required value={to} onChange={(event) => setTo(event.target.value)} />
        </label>
      </div>
      {error && <p role="alert">{error}</p>}
      <button type="submit" className={`${css.btn} ${css["btn-primary"]}`} disabled={busy}>
        确认时间段
      </button>
      <button type="button" className={css.link} disabled={busy} onClick={close}>
        取消
      </button>
    </form>
  );
}
