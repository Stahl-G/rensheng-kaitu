import { expect, it } from "vitest";
import { addRecord, updateRecord } from "../src/records.js";
import { type SleepStage, sleepStageMinutes, sleepStageTimeline } from "../src/sleep-stages.js";
import { freshWorkspace } from "./helpers.js";

it("睡眠阶段按实际时刻去重，冲突不猜分期，夏令时回拨仍按真实时长", () => {
  const stages: SleepStage[] = [
    { start: "2026-11-01T00:30:00-04:00", end: "2026-11-01T02:30:00-05:00", stage: "in_bed" },
    { start: "2026-11-01T00:30:00-04:00", end: "2026-11-01T02:00:00-05:00", stage: "asleep_unspecified" },
    { start: "2026-11-01T01:00:00-04:00", end: "2026-11-01T01:30:00-05:00", stage: "asleep_core" },
    { start: "2026-11-01T01:15:00-05:00", end: "2026-11-01T02:00:00-05:00", stage: "asleep_deep" },
    { start: "2026-11-01T02:00:00-05:00", end: "2026-11-01T02:15:00-05:00", stage: "awake" },
  ];
  const timeline = sleepStageTimeline([...stages, stages[2] as SleepStage]);
  expect(sleepStageMinutes(timeline)).toEqual({
    asleep_core: 75,
    asleep_deep: 30,
    asleep_rem: 0,
    asleep_unspecified: 45,
    awake: 15,
    in_bed: 15,
  });
  expect(timeline.every((s, i) => i === 0 || s.start >= (timeline[i - 1]?.end ?? ""))).toBe(true);
  expect(sleepStageTimeline([])).toEqual([]);
});

it("旧睡眠可读写，可选阶段仍严格拒绝未知阶段及越界/倒序时间", async () => {
  const ws = await freshWorkspace();
  const row = addRecord(ws, "sleep", {
    start: "2026-10-14T23:00:00+07:00",
    end: "2026-10-15T07:00:00+07:00",
    duration_min: 480,
    source: "manual",
  }).record;
  expect(row.stages).toBeUndefined();
  for (const stage of [
    { start: row.start, end: row.end, stage: "guessed_deep" },
    { start: "2026-10-14T22:59:59+07:00", end: row.end, stage: "asleep_core" },
    { start: row.end, end: row.start, stage: "awake" },
  ])
    expect(() => updateRecord(ws, "sleep", row.id, { stages: [stage] })).toThrow();
  expect(
    updateRecord(ws, "sleep", row.id, {
      stages: [{ start: row.start, end: row.end, stage: "asleep_unspecified" }],
    }).record.id,
  ).toBe(row.id);
});
