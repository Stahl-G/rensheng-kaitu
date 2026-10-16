import { useId, useState } from "react";
import type { Experience, ExperienceChanges } from "../types.js";
import css from "./MapPage.module.css";

export function ExperienceEditor({
  item,
  save,
  cancel,
}: {
  item: Experience;
  save: (changes: ExperienceChanges) => Promise<void>;
  cancel: () => void;
}) {
  const prefix = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorId = `${prefix}-error`;
  return (
    <form
      className={css.editor}
      aria-label="修正经历"
      aria-busy={busy}
      onSubmit={async (event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        const value = (name: string) => String(data.get(name) ?? "").trim();
        setBusy(true);
        setError(null);
        try {
          await save({
            place: { name: value("city"), ...(value("country") ? { country: value("country") } : {}) },
            event_type: value("event_type") as ExperienceChanges["event_type"],
            fact_status: value("fact_status") as ExperienceChanges["fact_status"],
            time_precision: value("time_precision") as ExperienceChanges["time_precision"],
            ...(value("start") ? { start: value("start") } : {}),
            ...(value("end") ? { end: value("end") } : {}),
            ...(value("title") ? { title: value("title") } : {}),
            ...(value("notes") ? { notes: value("notes") } : {}),
          });
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      <fieldset disabled={busy} aria-describedby={error ? errorId : undefined}>
        <label>
          城市
          <input
            name="city"
            defaultValue={item.place.name}
            required
            aria-invalid={error ? true : undefined}
          />
        </label>
        <label>
          国家代码
          <input name="country" defaultValue={item.place.country} placeholder="VN" maxLength={2} />
        </label>
        <label>
          标题
          <input name="title" defaultValue={item.title} />
        </label>
        <div className={css.fieldRow}>
          <label>
            分类
            <select name="event_type" defaultValue={item.event_type}>
              <option value="lived">居住</option>
              <option value="worked">工作</option>
              <option value="studied">求学</option>
              <option value="travel">旅行</option>
              <option value="visit">到访</option>
              <option value="other">其他</option>
            </select>
          </label>
          <label>
            事实状态
            <select name="fact_status" defaultValue={item.fact_status}>
              <option value="user_reported">我提供的经历</option>
              <option value="observed">已记录的经历</option>
              <option value="inferred">AI 推测</option>
              <option value="planned">计划</option>
              <option value="suggested">建议</option>
            </select>
          </label>
        </div>
        <label>
          时间精度
          <select name="time_precision" defaultValue={item.time_precision}>
            <option value="unknown">时间不详</option>
            <option value="year">年份</option>
            <option value="month">月份</option>
            <option value="day">日期</option>
          </select>
        </label>
        <div className={css.fieldRow}>
          <label>
            开始时间
            <input name="start" defaultValue={item.start} placeholder="2024 或 2024-10-15" />
          </label>
          <label>
            结束时间
            <input name="end" defaultValue={item.end} placeholder="留空表示未记录结束" />
          </label>
        </div>
        <label>
          备注
          <textarea name="notes" defaultValue={item.notes} rows={3} />
        </label>
      </fieldset>
      {error && (
        <p id={errorId} role="alert" className={css.formError}>
          {error}
        </p>
      )}
      <div className={css.actions}>
        <button type="submit" className={css.primary} disabled={busy}>
          {busy ? "保存中…" : "保存修正"}
        </button>
        <button type="button" className={css.control} disabled={busy} onClick={cancel}>
          取消
        </button>
      </div>
    </form>
  );
}
