import { readFileSync } from "node:fs";
import { basename, extname } from "node:path";
import ICAL from "ical.js";
import { KaituError } from "../errors.js";
import { assertTimeZone, isoInZone, localDate, localTimeToInstant } from "../time.js";
import type { Workspace } from "../workspace.js";
import { type Candidate, candidate, importBatch } from "./batch.js";

export interface IcsOptions {
  dryRun?: boolean;
  calendar?: string;
  fallbackCalendarName?: string;
  from?: string;
  to?: string;
  now?: Date;
}

class IanaZone extends ICAL.Timezone {
  constructor(zone: string) {
    super({ tzid: zone });
    assertTimeZone(zone);
  }
  override utcOffset(time: ICAL.Time): number {
    const pad = (value: number) => String(value).padStart(2, "0");
    const wall = `${time.year}-${pad(time.month)}-${pad(time.day)}T${pad(time.hour)}:${pad(time.minute)}:${pad(time.second)}`;
    const date = localTimeToInstant(wall, this.tzid);
    return (
      (Date.UTC(time.year, time.month - 1, time.day, time.hour, time.minute, time.second) - +date) / 1000
    );
  }
}

function prepareZones(calendar: ICAL.Component, zone: string): void {
  const zones = new Map<string, ICAL.Timezone>();
  for (const event of calendar.getAllSubcomponents("vevent")) {
    for (const prop of event.getAllProperties()) {
      if (!["date-time", "date", "period"].includes(prop.type)) continue;
      const tzid = prop.getParameter("tzid");
      let tz: ICAL.Timezone | undefined;
      if (typeof tzid === "string") {
        tz = calendar.getTimeZoneByID(tzid) ?? zones.get(tzid) ?? new IanaZone(tzid);
        zones.set(tzid, tz);
      }
      for (const value of prop.getValues()) {
        const times = value instanceof ICAL.Period ? [value.start, value.end] : [value];
        for (const time of times) {
          if (time instanceof ICAL.Time && !time.isDate && time.zone === ICAL.Timezone.localTimezone) {
            time.zone = tz ?? zones.get(zone) ?? new IanaZone(zone);
            if (!tz) zones.set(zone, time.zone);
          }
        }
      }
    }
    if (event.hasProperty("recurrence-id") && !event.hasProperty("dtstart")) {
      event.addPropertyWithValue("dtstart", event.getFirstPropertyValue("recurrence-id"));
    }
  }
}

function shiftDate(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
}

export async function importIcs(ws: Workspace, inputFile: string, opts: IcsOptions = {}) {
  const zone = ws.timeZone();
  const today = localDate(opts.now ?? new Date(), zone);
  const from = opts.from ?? shiftDate(today, -30);
  const to = opts.to ?? shiftDate(today, 180);
  let lower: number;
  let upper: number;
  try {
    lower = +localTimeToInstant(`${from}T00:00:00`, zone);
    localTimeToInstant(`${to}T00:00:00`, zone);
    upper = +localTimeToInstant(`${shiftDate(to, 1)}T00:00:00`, zone);
    if (from > to) throw new Error("Reversed window");
  } catch {
    throw new KaituError("日历窗口必须是有效日期，且起始日期不能晚于结束日期", "BAD_ARGS");
  }
  const candidates: Candidate[] = [];
  let name: string;
  try {
    const calendar = new ICAL.Component(ICAL.parse(readFileSync(inputFile, "utf8")));
    if (calendar.name !== "vcalendar") throw new Error("Missing VCALENDAR");
    name =
      opts.calendar ??
      String(
        calendar.getFirstPropertyValue("x-wr-calname") ??
          opts.fallbackCalendarName ??
          basename(inputFile, extname(inputFile)),
      );
    prepareZones(calendar, zone);
    const components = calendar.getAllSubcomponents("vevent");
    for (const component of components) {
      const uid = component.getFirstPropertyValue("uid");
      if (typeof uid !== "string" || !uid) throw new Error("Invalid UID");
    }
    const masters = components.filter((component) => !component.hasProperty("recurrence-id"));
    const uids = new Set<string>();
    const instant = (time: ICAL.Time): Date =>
      time.isDate ? localTimeToInstant(`${time.toString()}T00:00:00`, zone) : time.toJSDate();
    const add = (event: ICAL.Event, start: ICAL.Time, end: ICAL.Time) => {
      if (event.component.getFirstPropertyValue("status") === "CANCELLED") return;
      const startDate = instant(start);
      if (+startDate < lower || +startDate >= upper) return;
      if (+instant(end) < +startDate) throw new Error("Reversed event");
      candidates.push(
        candidate("event", {
          ts: isoInZone(startDate, zone),
          start: start.isDate ? start.toString() : isoInZone(startDate, zone),
          end: end.isDate ? end.toString() : isoInZone(instant(end), zone),
          title: event.summary ?? "",
          calendar: name,
          external_id: `${event.uid}/${startDate.toISOString()}`,
          source: "ics",
        }),
      );
    };
    for (const component of masters) {
      const uid = component.getFirstPropertyValue("uid");
      if (typeof uid !== "string" || !uid || uids.has(uid)) throw new Error("Invalid UID");
      uids.add(uid);
      const exceptions = components.filter(
        (item) => item.hasProperty("recurrence-id") && item.getFirstPropertyValue("uid") === uid,
      );
      const event = new ICAL.Event(component, { exceptions, strictExceptions: true });
      if (component.getFirstPropertyValue("status") === "CANCELLED") continue;
      if (!event.isRecurring()) {
        add(event, event.startDate, event.endDate);
        continue;
      }
      // 改期可把窗口后的发生移入窗口；停止位置需包含最大向前移动量。
      const backward = Math.max(
        0,
        ...exceptions.map((item) => {
          const exception = new ICAL.Event(item);
          return +instant(exception.recurrenceId) - +instant(exception.startDate);
        }),
      );
      const iterator = event.iterator();
      let iterations = 0;
      for (let occurrence = iterator.next(); occurrence; occurrence = iterator.next()) {
        if (++iterations > 1000000) throw new Error("Recurrence expansion too large");
        if (+instant(occurrence) >= upper + backward) break;
        const details = event.getOccurrenceDetails(occurrence);
        add(details.item, details.startDate, details.endDate);
      }
    }
    // 某些导出只包含改期后的实例，没有系列主事件。
    for (const component of components.filter((item) => item.hasProperty("recurrence-id"))) {
      const event = new ICAL.Event(component);
      if (!uids.has(event.uid)) add(event, event.startDate, event.endDate);
    }
  } catch {
    throw new KaituError("无法解析日历文件或其中的时区、循环事件", "INVALID_IMPORT");
  }
  return importBatch(ws, "ics", candidates, {
    dryRun: opts.dryRun,
    scope: (record) => record.calendar === name,
    deleteMissing: (record) => {
      const start = String(record.start);
      const day = start.length === 10 ? start : localDate(new Date(start), zone);
      return day >= from && day <= to;
    },
  });
}
