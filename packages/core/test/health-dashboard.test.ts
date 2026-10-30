import { expect, it } from "vitest";
import { buildHealthDashboard } from "../src/health-dashboard.js";
import { readHealthPage } from "../src/health-page.js";
import { holdOverview } from "../src/overview.js";
import { type StoredRecord, addRecord, deleteRecord, updateRecord } from "../src/records.js";
import { freshWorkspace } from "./helpers.js";

it("健康趋势读满12周并折叠修订，BMI只配同期身高，缺记录不冒充零", async () => {
  const ws = await freshWorkspace("Asia/Ho_Chi_Minh");
  holdOverview(ws);
  const metric = (ts: string, kind: string, value: number, unit: string) =>
    addRecord(ws, "metric", { ts: `${ts}+07:00`, kind, value, unit, source: "manual" }).record;
  metric("2026-08-01T08:00:00", "weight", 60, "kg");
  metric("2026-08-15T08:00:00", "weight", 70, "kg");
  const corrected = metric("2026-10-01T08:00:00", "weight", 900, "kg");
  updateRecord(ws, "metric", corrected.id, { value: 75 });
  const deleted = metric("2026-10-20T08:00:00", "weight", 100, "kg");
  deleteRecord(ws, "metric", deleted.id);
  metric("2026-10-29T07:00:00", "height", 190, "cm");
  const latestWeight = metric("2026-10-30T08:00:00", "weight", 80, "kg");
  updateRecord(ws, "metric", latestWeight.id, { source: "estimate" });
  metric("2026-10-31T08:00:00", "weight", 99, "kg");
  const now = new Date("2026-10-30T12:00:00+07:00");
  expect(readHealthPage(ws, now).dashboard.bmi).toBeNull();
  metric("2026-10-30T07:00:00", "height", 180, "cm");
  metric("2026-10-30T10:00:00", "height", 150, "cm");
  addRecord(ws, "activity", {
    ts: "2026-10-30T00:00:00+07:00",
    date: "2026-10-30",
    steps: 0,
    active_kcal: 300,
    total_kcal: 1800,
    source: "manual",
  });
  const result = readHealthPage(ws, now).dashboard;
  expect(result.bmi?.value).toBeCloseTo(80 / 1.8 ** 2);
  expect(result.bmi?.estimated).toBe(true);
  expect(result.metrics.find((m) => m.kind === "weight")?.points.map((p) => p.value)).toEqual([70, 75, 80]);
  expect(result.metrics.find((m) => m.kind === "weight")).toMatchObject({
    change: 10,
    range: { q1: 72.5, q3: 77.5 },
  });
  expect(result.activity.at(-1)).toMatchObject({
    steps: 0,
    activeKcal: 300,
    basalKcal: 1500,
    distanceKm: null,
  });
  expect(result.activity[0]?.steps).toBeNull();
  expect(result.sleep).toEqual([]);
  expect(result.mood.every((d) => d.valence === null)).toBe(true);
});

it("一年睡眠保持醒来日与未知阶段，坏分期隔离，训练能量和心率不在投影时丢失", async () => {
  const ws = await freshWorkspace("Asia/Ho_Chi_Minh");
  holdOverview(ws);
  const sleep = {
    ts: "2026-01-01T23:00:00+07:00",
    start: "2026-01-01T23:00:00+07:00",
    end: "2026-01-02T07:00:00+07:00",
    duration_min: 480,
    source: "estimate",
  };
  addRecord(ws, "sleep", sleep);
  addRecord(ws, "workout", {
    ts: "2026-10-30T09:00:00+07:00",
    modality: "cardio",
    exercise: "跑步",
    duration_min: 30,
    distance_km: 5,
    kcal: 320,
    avg_hr: 138,
    avg_pace_s_per_km: 360,
  });
  const now = new Date("2026-10-30T12:00:00+07:00");
  const page = readHealthPage(ws, now);
  expect(page.dashboard.sleep).toMatchObject([
    { date: "2026-01-02", durationMin: 480, stages: null, stageMinutes: null, estimated: true },
  ]);
  expect(page.training.recent[0]?.exercises[0]).toMatchObject({ kcal: 320, avgHr: 138, pace: 360 });
  expect(page.training.heatmap.find((d) => d.date === "2026-10-30")).toMatchObject({
    sessions: 1,
    minutes: 30,
  });
  const bad = {
    ...sleep,
    id: "bad-sleep",
    by: "user",
    stages: [{ start: sleep.end, end: sleep.start, stage: "asleep_deep" }],
  } as StoredRecord;
  const warnings: Parameters<typeof buildHealthDashboard>[4] = [];
  expect(
    buildHealthDashboard({ sleep: [bad] }, "2026-10-30", "Asia/Ho_Chi_Minh", now, warnings).sleep[0]?.stages,
  ).toBeNull();
  expect(warnings).toHaveLength(1);
});
