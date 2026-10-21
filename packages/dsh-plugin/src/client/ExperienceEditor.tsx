import { useId, useState } from "react";
import type { Experience, ExperienceChanges } from "../types.js";
import css from "./MapPage.module.css";
import { useT } from "./i18n.js";

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
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorId = `${prefix}-error`;
  return (
    <form
      className={css.editor}
      aria-label={t("修正经历", "Correct place")}
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
          {t("城市", "City")}
          <input
            name="city"
            defaultValue={item.place.name}
            required
            aria-invalid={error ? true : undefined}
          />
        </label>
        <label>
          {t("国家代码", "Country code")}
          <input name="country" defaultValue={item.place.country} placeholder="VN" maxLength={2} />
        </label>
        <label>
          {t("标题", "Title")}
          <input name="title" defaultValue={item.title} />
        </label>
        <div className={css.fieldRow}>
          <label>
            {t("分类", "Category")}
            <select name="event_type" defaultValue={item.event_type}>
              <option value="lived">{t("居住", "Residence")}</option>
              <option value="worked">{t("工作", "Worked")}</option>
              <option value="studied">{t("求学", "Study")}</option>
              <option value="travel">{t("旅行", "Travel")}</option>
              <option value="visit">{t("到访", "Visited")}</option>
              <option value="other">{t("其他", "Other")}</option>
            </select>
          </label>
          <label>
            {t("事实状态", "Fact status")}
            <select name="fact_status" defaultValue={item.fact_status}>
              <option value="user_reported">{t("我提供的经历", "Shared by me")}</option>
              <option value="observed">{t("已记录的经历", "Recorded place")}</option>
              <option value="inferred">{t("AI 推测", "AI inference")}</option>
              <option value="planned">{t("计划", "Planned")}</option>
              <option value="suggested">{t("建议", "Suggested")}</option>
            </select>
          </label>
        </div>
        <label>
          {t("时间精度", "Date precision")}
          <select name="time_precision" defaultValue={item.time_precision}>
            <option value="unknown">{t("时间不详", "Undated")}</option>
            <option value="year">{t("年份", "Year")}</option>
            <option value="month">{t("月份", "Month")}</option>
            <option value="day">{t("日期", "Date")}</option>
          </select>
        </label>
        <div className={css.fieldRow}>
          <label>
            {t("开始时间", "Start date")}
            <input
              name="start"
              defaultValue={item.start}
              placeholder={t("2024 或 2024-10-15", "2024 or 2024-10-15")}
            />
          </label>
          <label>
            {t("结束时间", "End date")}
            <input
              name="end"
              defaultValue={item.end}
              placeholder={t("留空表示未记录结束", "Leave empty if no end date is recorded")}
            />
          </label>
        </div>
        <label>
          {t("备注", "Notes")}
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
          {busy ? t("保存中…", "Saving…") : t("保存修正", "Save correction")}
        </button>
        <button type="button" className={css.control} disabled={busy} onClick={cancel}>
          {t("取消", "Cancel")}
        </button>
      </div>
    </form>
  );
}
