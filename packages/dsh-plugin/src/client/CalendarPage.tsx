import zh from "@fullcalendar/core/locales/zh-cn";
import dayGridPlugin from "@fullcalendar/daygrid";
import listPlugin from "@fullcalendar/list";
import FullCalendar from "@fullcalendar/react";
import timeGridPlugin from "@fullcalendar/timegrid";
import { useEffect, useState } from "react";
import type { CalendarData, CalendarEntry } from "../types.js";
import css from "./Prototype.module.css";

export interface CalendarPageProps {
  loadCalendar: () => Promise<CalendarData>;
  addCalendar: (url: string, name: string) => Promise<CalendarData>;
  decideProposal: (id: string, decision: "confirmed" | "rejected") => Promise<unknown>;
}
export function calendarDay(value: string, zone: string) {
  return value.length === 10 || !/(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    ? value.slice(0, 10)
    : new Intl.DateTimeFormat("sv-SE", { timeZone: zone }).format(new Date(value));
}
export function calendarTime(value: string, zone: string) {
  if (value.length === 10) return "全天";
  return !/(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    ? value.slice(11, 16)
    : new Intl.DateTimeFormat("zh-CN", {
        timeZone: zone,
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(new Date(value));
}
export function Agenda({ data, open }: { data: CalendarData | null; open: () => void }) {
  const today =
    data?.events.filter(
      (event) =>
        calendarDay(event.start, data.timeZone) <= data.today &&
        (event.end
          ? calendarDay(event.end, data.timeZone) >= data.today &&
            !(event.end.length === 10 && event.end === data.today)
          : calendarDay(event.start, data.timeZone) === data.today),
    ) ?? [];
  return (
    <section className={css.sec}>
      <div className={css["sec-head"]}>
        <h2 className={css.eyebrow}>今天的日程</h2>
        <button type="button" className={css.link} onClick={open}>
          看全部日程
        </button>
      </div>
      <div className={`${css.card} ${css.agenda}`}>
        {!data ? (
          <p className={css.emptyState}>正在读取日程…</p>
        ) : !today.length ? (
          <p className={css.emptyState}>今天还没有日程</p>
        ) : (
          today
            .sort((a, b) => a.start.localeCompare(b.start))
            .map((event) => (
              <div className={css["agenda-row"]} key={event.id}>
                <time>{calendarTime(event.start, data.timeZone)}</time>
                <span>{event.title}</span>
                <span className={css.small}>
                  {event.source}
                  {event.pending ? " · 建议，待确认" : ""}
                </span>
              </div>
            ))
        )}
      </div>
    </section>
  );
}
export function CalendarPage(props: CalendarPageProps & { initialAdding?: boolean }) {
  const [data, setData] = useState<CalendarData | null>(null);
  const [selected, setSelected] = useState<CalendarEntry | null>(null);
  const [adding, setAdding] = useState(props.initialAdding ?? false);
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void props
      .loadCalendar()
      .then((value) => {
        if (active) setData(value);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      active = false;
    };
  }, [props.loadCalendar]);
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
      setData(await props.loadCalendar());
      setSelected(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={css.sec}>
      <div className={css["sec-head"]}>
        <p className={css.small}>日历订阅每 15 分钟刷新</p>
        <button type="button" className={`${css.btn} ${css["btn-quiet"]}`} onClick={() => setAdding(!adding)}>
          ＋ 添加日历
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
          <b>添加日历订阅</b>
          <div className={css.fields}>
            <label>
              ICS 订阅地址
              <input
                required
                value={url}
                placeholder="https://…/basic.ics 或 webcal://…"
                onChange={(e) => setUrl(e.target.value)}
              />
            </label>
            <label>
              叫它什么
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="比如：家庭" />
            </label>
          </div>
          <button type="submit" className={`${css.btn} ${css["btn-primary"]}`} disabled={busy}>
            添加订阅
          </button>
        </form>
      )}
      <div className={`${css.card} ${css.cal} ${css.calendarShell}`}>
        {data && (
          <FullCalendar
            plugins={[dayGridPlugin, timeGridPlugin, listPlugin]}
            locale={zh}
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
              today: "今天",
              day: "日",
              week: "周",
              month: "月",
              list: "列表",
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
            eventClick={({ event }) => setSelected(data.events.find((row) => row.id === event.id) ?? null)}
          />
        )}
      </div>
      <div className={css["cal-legend"]}>
        {sources.map((source) => (
          <span key={source}>
            <i className={css.dot} style={{ background: `var(--${colorFor(source)})` }} />
            {source}
          </span>
        ))}
        <span>┄ 开图建议</span>
      </div>
      {selected && (
        <div className={`${css.card} ${css["cal-detail"]}`}>
          <span className={css.stack}>
            <b>{selected.title}</b>
            <span className={css.small}>
              {selected.start} · {selected.source}
            </span>
          </span>
          {selected.pending && (
            <>
              <button
                type="button"
                className={`${css.btn} ${css["btn-primary"]}`}
                disabled={busy}
                onClick={() => void decide("confirmed")}
              >
                放进日程
              </button>
              <button
                type="button"
                className={`${css.btn} ${css["btn-quiet"]}`}
                disabled={busy}
                onClick={() => void decide("rejected")}
              >
                不用
              </button>
            </>
          )}
        </div>
      )}
      {data?.subscriptions.map((sub) => (
        <div key={sub.id} className={css.small}>
          {sub.name} ·{" "}
          {sub.error ??
            (sub.syncedAt ? `最近同步 ${new Date(sub.syncedAt).toLocaleString("zh-CN")}` : "还没同步")}
        </div>
      ))}
    </div>
  );
}
