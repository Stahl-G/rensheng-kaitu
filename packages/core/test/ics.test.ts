import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import ICAL from "ical.js";
import { expect, it } from "vitest";
import { history, restore } from "../src/history.js";
import { importIcs } from "../src/importers/ics.js";
import { findRecordType } from "../src/modules.js";
import { addRecord, readRecords, recordLines } from "../src/records.js";
import { validateWorkspace } from "../src/validate.js";
import { freshWorkspace, tmp } from "./helpers.js";

const fixture = fileURLToPath(new URL("../../../examples/calendar.ics", import.meta.url));
const window = { from: "2026-10-01", to: "2026-10-31" };

it("ICS：循环、排除与改期、全天、VTIMEZONE / IANA、跨月，幂等与恢复", async () => {
  const ws = await freshWorkspace();
  const initial = (await history(ws))[0]?.oid as string;
  expect((await importIcs(ws, fixture, { ...window, dryRun: true })).added).toBe(5);
  expect(readRecords(ws, "event")).toEqual([]);
  expect(await history(ws)).toHaveLength(1);
  await importIcs(ws, fixture, window);
  const events = readRecords(ws, "event");
  expect(events).toHaveLength(5);
  expect(
    events
      .filter((event) => String(event.external_id).startsWith("weekly-demo/"))
      .map((event) => [event.start, event.end]),
  ).toEqual([
    ["2026-10-05T09:00:00+08:00", "2026-10-05T10:00:00+08:00"],
    ["2026-10-20T11:00:00+08:00", "2026-10-20T12:00:00+08:00"],
    ["2026-10-26T09:00:00+08:00", "2026-10-26T10:00:00+08:00"],
  ]);
  expect(events.find((event) => String(event.external_id).startsWith("day-demo/"))).toMatchObject({
    start: "2026-10-01",
    end: "2026-10-02",
    calendar: "合成日历",
  });
  expect(events.find((event) => String(event.external_id).startsWith("iana-demo/"))).toMatchObject({
    start: "2026-10-01T11:30:00+08:00",
    end: "2026-10-01T12:30:00+08:00",
    external_id: "iana-demo/2026-10-01T03:30:00.000Z",
  });
  expect(validateWorkspace(ws)).toEqual([]);
  const versions = await history(ws);
  expect(versions).toHaveLength(2);
  expect((await importIcs(ws, fixture, window)).version).toBeNull();
  expect(await history(ws)).toEqual(versions);
  await restore(ws, initial);
  expect(readRecords(ws, "event")).toEqual([]);

  const dstFile = join(tmp(), "dst.ics");
  const calendar = ICAL.Component.fromString(readFileSync(fixture, "utf8"));
  for (const component of calendar.getAllSubcomponents("vevent")) {
    if (component.getFirstPropertyValue("uid") !== "iana-demo") calendar.removeSubcomponent(component);
    else {
      component.updatePropertyWithValue("dtstart", ICAL.Time.fromDateTimeString("2026-10-25T09:00:00"));
      component.updatePropertyWithValue("dtend", ICAL.Time.fromDateTimeString("2026-10-25T10:00:00"));
      component.addPropertyWithValue("rrule", ICAL.Recur.fromString("FREQ=WEEKLY;COUNT=3"));
      const excluded = new ICAL.Property("exdate");
      excluded.setParameter("tzid", "America/New_York");
      excluded.setValue(ICAL.Time.fromDateTimeString("2026-11-01T09:00:00"));
      component.addProperty(excluded);
    }
  }
  writeFileSync(dstFile, calendar.toString());
  await importIcs(ws, dstFile, { from: "2026-10-01", to: "2026-11-30" });
  expect(readRecords(ws, "event").map((event) => event.start)).toEqual([
    "2026-10-25T21:00:00+08:00",
    "2026-11-08T22:00:00+08:00",
  ]);
});

it("ICS：快照删除只影响同来源、同日历、窗口内，追加标记且可恢复", async () => {
  const ws = await freshWorkspace();
  const file = join(tmp(), "calendar.ics");
  const calendar = ICAL.Component.fromString(readFileSync(fixture, "utf8"));
  const outside = new ICAL.Component("vevent");
  outside.addPropertyWithValue("uid", "outside-demo");
  outside.addPropertyWithValue("dtstart", ICAL.Time.fromDateString("2026-09-01"));
  outside.addPropertyWithValue("summary", "窗口外");
  calendar.addSubcomponent(outside);
  writeFileSync(file, calendar.toString());
  await importIcs(ws, file, { from: "2026-09-01", to: window.to });
  const removed = readRecords(ws, "event").find((event) => String(event.external_id).startsWith("day-demo/"));
  addRecord(
    ws,
    "event",
    {
      ts: removed?.ts,
      start: removed?.start,
      end: removed?.end,
      title: "手动记录",
      calendar: "合成日历",
      source: "manual",
    },
    { by: "user" },
  );
  await importIcs(ws, file, { ...window, calendar: "其他日历" });
  const before = (await history(ws))[0]?.oid as string;
  for (const event of calendar.getAllSubcomponents("vevent")) {
    if (["day-demo", "outside-demo"].includes(String(event.getFirstPropertyValue("uid"))))
      calendar.removeSubcomponent(event);
  }
  writeFileSync(file, calendar.toString());
  const preview = await importIcs(ws, file, { ...window, dryRun: true });
  expect(preview.deleted).toBe(1);
  expect(readRecords(ws, "event").some((event) => event.id === removed?.id)).toBe(true);
  const result = await importIcs(ws, file, window);
  expect(result.deleted).toBe(1);
  const remaining = readRecords(ws, "event");
  expect(remaining.some((event) => event.id === removed?.id)).toBe(false);
  expect(remaining.some((event) => String(event.external_id).startsWith("outside-demo/"))).toBe(true);
  expect(remaining.filter((event) => event.calendar === "其他日历")).toHaveLength(5);
  expect(remaining.some((event) => event.by === "user")).toBe(true);
  const lines = recordLines(ws, findRecordType(ws, "event")).map((line) => JSON.parse(line.raw));
  expect(
    lines.some((record) => record.id === removed?.id && record.deleted === true && record.rev === 2),
  ).toBe(true);
  expect((await importIcs(ws, file, window)).version).toBeNull();
  await restore(ws, before);
  expect(readRecords(ws, "event").some((event) => event.id === removed?.id)).toBe(true);
});
