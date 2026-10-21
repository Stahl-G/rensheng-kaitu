import zh from "@fullcalendar/core/locales/zh-cn";
import dayGridPlugin from "@fullcalendar/daygrid";
import listPlugin from "@fullcalendar/list";
import FullCalendar from "@fullcalendar/react";
import timeGridPlugin from "@fullcalendar/timegrid";
import type { CalendarPushSettings, PlanBlock } from "@kaitu/core";
import { useEffect, useState } from "react";
import type { CalendarData, CalendarEntry } from "../types.js";
import { CalendarPushResult, type CalendarPushServices, CalendarSlotForm } from "./CalendarPush.js";
import css from "./Prototype.module.css";
import { type Locale, useLocale, useT } from "./i18n.js";

export interface CalendarPageProps extends CalendarPushServices {
  loadCalendar: () => Promise<CalendarData>;
  addCalendar: (url: string, name: string) => Promise<CalendarData>;
  decideProposal: (id: string, decision: "confirmed" | "rejected") => Promise<unknown>;
}
export function calendarDay(value: string, zone: string) {
  return value.length === 10 || !/(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    ? value.slice(0, 10)
    : new Intl.DateTimeFormat("sv-SE", { timeZone: zone }).format(new Date(value));
}
export function calendarTime(value: string, zone: string, locale: Locale = "zh-CN") {
  if (value.length === 10) return locale === "en" ? "All day" : "全天";
  return !/(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    ? value.slice(11, 16)
    : new Intl.DateTimeFormat("zh-CN", {
        timeZone: zone,
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(new Date(value));
}
export function Agenda({
  data,
  open,
  proposals,
  decide,
  busy,
}: {
  data: CalendarData | null;
  open: () => void;
  proposals: PlanBlock[];
  decide: (id: string, decision: "confirmed" | "rejected") => void;
  busy: boolean;
}) {
  const t = useT();
  const locale = useLocale();
  const today =
    data?.events.filter(
      (event) =>
        calendarDay(event.start, data.timeZone) <= data.today &&
        (event.end
          ? calendarDay(event.end, data.timeZone) >= data.today &&
            !(event.end.length === 10 && event.end === data.today)
          : calendarDay(event.start, data.timeZone) === data.today),
    ) ?? [];
  today.push(
    ...proposals
      .filter((b) => !b.start)
      .map((b) => ({
        id: b.id,
        title: b.title,
        start: "",
        pending: true,
        source: "开图",
      })),
  );
  return (
    <section className={css.sec}>
      <div className={css["sec-head"]}>
        <h2 className={css.eyebrow}>{t("今天的日程", "Today's schedule")}</h2>
        <button type="button" className={css.link} onClick={open}>
          {t("看全部日程", "Full schedule")}
        </button>
      </div>
      <div className={`${css.card} ${css.agenda}`}>
        {!data ? (
          <p className={css.emptyState}>{t("正在读取日程…", "Loading schedule…")}</p>
        ) : !today.length ? (
          <p className={css.emptyState}>{t("今天还没有日程", "Nothing scheduled today")}</p>
        ) : (
          today
            .sort((a, b) => a.start.localeCompare(b.start))
            .map((event) => (
              <div className={css["agenda-row"]} key={event.id}>
                <time>
                  {event.start ? calendarTime(event.start, data.timeZone, locale) : t("待定", "TBD")}
                </time>
                <span>{event.title}</span>
                {event.pending ? (
                  <div className={css.confirmationActions}>
                    <button
                      type="button"
                      className={`${css.btn} ${css.confirmationAccept}`}
                      disabled={busy}
                      onClick={() => decide(event.id, "confirmed")}
                    >
                      {t("确认", "Confirm")}
                    </button>
                    <button
                      type="button"
                      className={`${css.btn} ${css.confirmationDismiss}`}
                      disabled={busy}
                      onClick={() => decide(event.id, "rejected")}
                    >
                      {t("不用", "No thanks")}
                    </button>
                  </div>
                ) : (
                  <span className={css.small}>
                    {event.source === "开图" ? t("开图", "Kaitu") : event.source}
                  </span>
                )}
              </div>
            ))
        )}
      </div>
    </section>
  );
}
export function CalendarPage(props: CalendarPageProps & { initialAdding?: boolean }) {
  const t = useT();
  const locale = useLocale();
  const [push, setPush] = useState<CalendarPushSettings | null>(null);
  const [editing, setEditing] = useState(false);
  const [data, setData] = useState<CalendarData | null>(null);
  const [selected, setSelected] = useState<CalendarEntry | null>(null);
  const [adding, setAdding] = useState(props.initialAdding ?? false);
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void Promise.all([props.loadCalendar(), props.loadCalendarPush()])
      .then(([value, status]) => {
        if (active) {
          setData(value);
          setPush(status);
        }
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      active = false;
    };
  }, [props.loadCalendar, props.loadCalendarPush]);
  const sources = [...new Set(data?.events.filter((event) => !event.pending).map((event) => event.source))];
  const colors = ["explore", "doing", "health", "finance", "me"];
  const colorFor = (source: string) =>
    colors[Array.from(source).reduce((sum, c) => sum + (c.codePointAt(0) ?? 0), 0) % colors.length];
  const decide = async (decision: "confirmed" | "rejected") => {
    if (!selected) return;
    setBusy(true);
    setError("");
    try {
      await props.decideProposal(selected.id, decision);
      const fresh = await props.loadCalendar();
      setData(fresh);
      setPush(await props.loadCalendarPush());
      setSelected(fresh.events.find((event) => event.id === selected.id) ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={css.sec}>
      <div className={css["sec-head"]}>
        <p className={css.small}>
          {t("日历订阅每 15 分钟刷新", "Calendar subscriptions refresh every 15 minutes")}
        </p>
        <button type="button" className={`${css.btn} ${css["btn-quiet"]}`} onClick={() => setAdding(!adding)}>
          {t("＋ 添加日历", "+ Add calendar")}
        </button>
      </div>
      {error && (
        <p role="alert" className={css.error}>
          {error}
        </p>
      )}
      {adding && (
        <form
          className={`${css.card} ${css["sub-form"]}`}
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            try {
              setData(await props.addCalendar(url, name));
              setAdding(false);
              setUrl("");
              setName("");
            } catch (err) {
              setError(err instanceof Error ? err.message : String(err));
            } finally {
              setBusy(false);
            }
          }}
        >
          <b>{t("添加日历订阅", "Add a calendar subscription")}</b>
          <div className={css.fields}>
            <label>
              {t("ICS 订阅地址", "ICS subscription URL")}
              <input
                required
                value={url}
                placeholder={t("https://…/basic.ics 或 webcal://…", "https://…/basic.ics or webcal://…")}
                onChange={(e) => setUrl(e.target.value)}
              />
            </label>
            <label>
              {t("叫它什么", "Name")}
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("比如：家庭", "For example: Family")}
              />
            </label>
          </div>
          <button type="submit" className={`${css.btn} ${css["btn-primary"]}`} disabled={busy}>
            {t("添加订阅", "Add subscription")}
          </button>
        </form>
      )}
      <div className={`${css.card} ${css.cal} ${css.calendarShell}`}>
        {data && (
          <FullCalendar
            plugins={[dayGridPlugin, timeGridPlugin, listPlugin]}
            locale={locale === "en" ? "en" : zh}
            initialView="timeGridWeek"
            initialDate={data.today}
            headerToolbar={{
              left: "prev,next today",
              center: "title",
              right: "timeGridDay,timeGridWeek,dayGridMonth,listMonth",
            }}
            buttonIcons={false}
            buttonText={{
              prev: "‹",
              next: "›",
              today: t("今天", "Today"),
              day: t("日", "Day"),
              week: t("周", "Week"),
              month: t("月", "Month"),
              list: t("列表", "List"),
            }}
            height="auto"
            editable={false}
            selectable={false}
            nowIndicator
            firstDay={1}
            slotMinTime="06:00:00"
            slotMaxTime="24:00:00"
            timeZone="UTC"
            now={`${calendarDay(new Date().toISOString(), data.timeZone)}T${calendarTime(new Date().toISOString(), data.timeZone)}:00`}
            events={data.events.map((event) => {
              const color = colorFor(event.source) ?? "explore";
              // Floating plan times belong to the workspace timezone; render their wall times alongside imported instants.
              const wall = (value: string) =>
                value.length === 10
                  ? value
                  : `${calendarDay(value, data.timeZone)}T${calendarTime(value, data.timeZone)}:00`;
              return {
                ...event,
                start: wall(event.start),
                end: event.end ? wall(event.end) : undefined,
                backgroundColor: `var(--${event.pending ? "surface" : `${color}-tint`})`,
                borderColor: `var(--${event.pending ? "news" : color})`,
                textColor: `var(--${event.pending ? "news" : `${color}-ink`})`,
                classNames: event.pending ? ["suggestion"] : [],
              };
            })}
            eventClick={({ event }) => {
              setEditing(false);
              setSelected(data.events.find((row) => row.id === event.id) ?? null);
            }}
          />
        )}
      </div>
      <div className={css["cal-legend"]}>
        {sources.map((source) => (
          <span key={source}>
            <i className={css.dot} style={{ background: `var(--${colorFor(source)})` }} />
            {source === "开图" ? t("开图", "Kaitu") : source}
          </span>
        ))}
        <span>{t("┄ 开图建议", "┄ Kaitu suggestion")}</span>
      </div>
      {selected && (
        <div className={`${css.card} ${css["cal-detail"]}`}>
          <span className={css.stack}>
            <b>{selected.title}</b>
            <span className={css.small}>
              {selected.start} · {selected.source}
            </span>
          </span>
          <CalendarPushResult
            id={selected.id}
            state={push}
            retry={async (id) =>
              setPush(await (push?.enabled ? props.retryCalendarPush(id) : props.removeCalendarPush()))
            }
          />
          {selected.pending && (
            <>
              <button
                type="button"
                className={`${css.btn} ${css["btn-primary"]}`}
                disabled={busy}
                onClick={() => void decide("confirmed")}
              >
                {t("确认", "Confirm")}
              </button>
              <button
                type="button"
                className={`${css.btn} ${css["btn-quiet"]}`}
                disabled={busy}
                onClick={() => void decide("rejected")}
              >
                {t("不用", "No thanks")}
              </button>
            </>
          )}
          {!selected.pending && selected.source === "开图" && !!push?.entries[selected.id] && (
            <>
              <button type="button" className={css.link} disabled={busy} onClick={() => setEditing(!editing)}>
                {t("调整时间", "Change time")}
              </button>
              <button
                type="button"
                className={css.link}
                disabled={busy}
                onClick={() => void decide("rejected")}
              >
                {t("取消日程", "Cancel event")}
              </button>
            </>
          )}
          {editing && (
            <CalendarSlotForm
              key={selected.id}
              date={selected.start.slice(0, 10)}
              start={selected.start.slice(11, 16)}
              end={selected.end?.slice(11, 16)}
              close={() => setEditing(false)}
              save={async (start, end) => {
                await props.editCalendarBlock(selected.id, start, end);
                const fresh = await props.loadCalendar();
                setData(fresh);
                setSelected(fresh.events.find((event) => event.id === selected.id) ?? null);
                setPush(await props.loadCalendarPush());
              }}
            />
          )}
        </div>
      )}
      {push &&
        Object.entries(push.entries)
          .filter(
            ([id, receipt]) =>
              !data?.events.some((event) => event.id === id) && ["removed", "error"].includes(receipt.status),
          )
          .map(([id]) => (
            <CalendarPushResult
              key={id}
              id={id}
              state={push}
              retry={async (key) =>
                setPush(await (push?.enabled ? props.retryCalendarPush(key) : props.removeCalendarPush()))
              }
            />
          ))}
      {data?.subscriptions.map((sub) => (
        <div key={sub.id} className={css.small}>
          {sub.name} ·{" "}
          {sub.error ??
            (sub.syncedAt
              ? t(
                  `最近同步 ${new Date(sub.syncedAt).toLocaleString(locale)}`,
                  `Last synced ${new Date(sub.syncedAt).toLocaleString(locale)}`,
                )
              : t("还没同步", "Not synced yet"))}
        </div>
      ))}
    </div>
  );
}
