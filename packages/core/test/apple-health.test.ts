import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { strToU8, zipSync } from "fflate";
import { expect, it } from "vitest";
import { history, restore } from "../src/history.js";
import { importAppleHealth, importHealthShortcut } from "../src/importers/apple-health.js";
import { readRecords } from "../src/records.js";
import { validateWorkspace } from "../src/validate.js";
import { freshWorkspace, tmp } from "./helpers.js";

const fixture = new URL("../../../examples/apple-health/export.xml", import.meta.url);

it("Apple Health：流式 zip 映射、按来源聚合、跨月切分，幂等且整次可恢复", async () => {
  const ws = await freshWorkspace();
  const initial = (await history(ws))[0]?.oid as string;
  const zip = join(tmp(), "export.zip");
  writeFileSync(
    zip,
    zipSync({
      "apple_health_export/export.xml": readFileSync(fixture),
      "apple_health_export/export_cda.xml": strToU8("不是 HealthData"),
    }),
  );
  const preview = await importAppleHealth(ws, zip, { dryRun: true });
  expect(preview.added).toBe(10);
  expect(readRecords(ws, "metric")).toEqual([]);
  expect(await history(ws)).toHaveLength(1);
  const result = await importAppleHealth(ws, zip);
  expect(result.version).not.toBeNull();
  expect(result.ignored.unsupported).toBe(3);
  const metrics = readRecords(ws, "metric");
  expect(metrics).toHaveLength(6);
  expect(metrics.find((r) => r.kind === "weight")).toMatchObject({
    value: 154 * 0.45359237,
    ts: "2026-10-01T04:00:00+08:00",
    unit: "kg",
    by: "import:apple-health",
  });
  for (const [kind, value] of [
    ["body_fat", 18],
    ["height", 175],
    ["glucose", 5],
    ["resting_hr", 58],
    ["bp", "120/80"],
  ]) {
    expect(metrics.find((r) => r.kind === kind)?.value).toBe(value);
  }
  expect(readRecords(ws, "activity")).toMatchObject([
    { date: "2026-09-30", steps: 100 },
    { date: "2026-10-01", steps: 400, active_kcal: 300, total_kcal: 1800 },
  ]);
  expect(readRecords(ws, "sleep")).toMatchObject([
    {
      start: "2026-09-30T23:00:00+08:00",
      end: "2026-10-01T06:00:00+08:00",
      duration_min: 390,
    },
  ]);
  expect(readRecords(ws, "workout")).toMatchObject([
    { modality: "cardio", exercise: "跑步", duration_min: 60, ts: "2026-10-01T09:00:00+08:00" },
  ]);
  expect(validateWorkspace(ws)).toEqual([]);
  const versions = await history(ws);
  expect(versions).toHaveLength(2);
  expect((await importAppleHealth(ws, fixture.pathname)).version).toBeNull();
  expect(await history(ws)).toEqual(versions);
  await restore(ws, initial);
  for (const type of ["metric", "activity", "sleep", "workout"]) expect(readRecords(ws, type)).toEqual([]);
});

it("Apple Health：非法 XML 不留下整批中的前一条记录", async () => {
  const ws = await freshWorkspace();
  const file = join(tmp(), "export.xml");
  writeFileSync(file, readFileSync(fixture, "utf8").replace("</HealthData>", "<broken></HealthData>"));
  await expect(importAppleHealth(ws, file)).rejects.toThrow();
  expect(readRecords(ws, "metric")).toEqual([]);
  expect(await history(ws)).toHaveLength(1);
});

it("快捷指令复用映射：本地日期、两来源步数、睡眠合并与训练，XML 重导入不产生版本", async () => {
  const ws = await freshWorkspace("America/New_York");
  const file = join(tmp(), "daily.health.json");
  const raw = {
    format: "kaitu.health.v1",
    exported_at: "2026-10-02T08:30:00-04:00",
    device: "iPhone",
    samples: [
      {
        type: "step_count",
        start: "2026-10-01T03:30:00Z",
        end: "2026-10-01T04:30:00Z",
        value: 200,
        unit: "count",
        source: "Watch",
      },
      {
        type: "step_count",
        start: "2026-10-01T04:00:00Z",
        end: "2026-10-01T05:00:00Z",
        value: 80,
        unit: "count",
        source: "Phone",
      },
      {
        type: "sleep_analysis",
        start: "2026-10-01T03:00:00Z",
        end: "2026-10-01T06:00:00Z",
        value: "asleep_core",
        unit: "",
        source: "Watch",
      },
      {
        type: "sleep_analysis",
        start: "2026-10-01T05:00:00Z",
        end: "2026-10-01T10:00:00Z",
        value: "asleep_rem",
        unit: "",
        source: "Watch",
      },
      {
        type: "sleep_analysis",
        start: "2026-10-01T03:00:00Z",
        end: "2026-10-01T08:00:00Z",
        value: "asleep",
        unit: "",
        source: "Phone",
      },
      {
        type: "body_mass",
        start: "2026-10-01T12:00:00Z",
        end: "2026-10-01T12:00:00Z",
        value: 154,
        unit: "lb",
        source: "Scale",
      },
      {
        type: "body_fat_percentage",
        start: "2026-10-01T12:00:00Z",
        end: "2026-10-01T12:00:00Z",
        value: 18,
        unit: "%",
        source: "Scale",
      },
      {
        type: "workout",
        start: "2026-10-01T13:00:00Z",
        end: "2026-10-01T13:30:00Z",
        value: 30,
        unit: "min",
        source: "Watch",
        workout: { activity: "running", duration_min: 30, distance_km: 5, kcal: 300, avg_hr: 145 },
      },
      {
        type: "workout",
        start: "2026-10-01T14:00:00Z",
        end: "2026-10-01T14:20:00Z",
        value: 20,
        unit: "min",
        source: "Watch",
        workout: { activity: "traditional_strength_training", duration_min: 20 },
      },
    ],
  };
  writeFileSync(file, JSON.stringify(raw));
  const result = await importHealthShortcut(ws, file);
  expect(result.added).toBe(7);
  expect(readRecords(ws, "activity")).toMatchObject([
    { date: "2026-09-30", steps: 100 },
    { date: "2026-10-01", steps: 100 },
  ]);
  expect(readRecords(ws, "sleep")).toMatchObject([
    { start: "2026-09-30T23:00:00-04:00", end: "2026-10-01T06:00:00-04:00", duration_min: 420 },
  ]);
  expect(readRecords(ws, "metric")).toMatchObject([
    { kind: "weight", value: 154 * 0.45359237, unit: "kg" },
    { kind: "body_fat", value: 18, unit: "%" },
  ]);
  expect(readRecords(ws, "workout")).toMatchObject([
    { modality: "cardio", exercise: "跑步", duration_min: 30, distance_km: 5, kcal: 300, avg_hr: 145 },
    { modality: "cardio", exercise: "传统力量训练", duration_min: 20 },
  ]);
  const versions = await history(ws);
  expect((await importHealthShortcut(ws, file)).version).toBeNull();
  // 同一个原始训练换成官方 XML 入口，仍命中同一条自然键。
  const xml = join(tmp(), "export.xml");
  writeFileSync(
    xml,
    `<HealthData><Workout workoutActivityType="HKWorkoutActivityTypeRunning"
    startDate="2026-10-01 13:00:00 +0000" endDate="2026-10-01 13:30:00 +0000" duration="1800" durationUnit="s">
    <WorkoutStatistics type="HKQuantityTypeIdentifierDistanceWalkingRunning" sum="5000" unit="m"/>
    <WorkoutStatistics type="HKQuantityTypeIdentifierActiveEnergyBurned" sum="1255.2" unit="kJ"/>
    <WorkoutStatistics type="HKQuantityTypeIdentifierHeartRate" average="145" unit="count/min"/>
    </Workout></HealthData>`,
  );
  expect((await importAppleHealth(ws, xml)).version).toBeNull();
  expect(await history(ws)).toEqual(versions);
  expect(validateWorkspace(ws)).toEqual([]);
});

it("健康并列列表中文睡眠阶段跨午夜合并，重叠只计一次，清醒与在床不计时长", async () => {
  const ws = await freshWorkspace("Asia/Ho_Chi_Minh");
  const file = join(tmp(), "sleep.health.json");
  writeFileSync(
    file,
    JSON.stringify({
      type: "sleep_analysis",
      values: "在床上\n核心\n深度\n清醒\n快速动眼",
      starts: [
        "2026-10-14T22:00:00+07:00",
        "2026-10-14T23:30:00+07:00",
        "2026-10-15T00:30:00+07:00",
        "2026-10-15T02:30:00+07:00",
        "2026-10-15T03:00:00+07:00",
      ].join("\n"),
      ends: [
        "2026-10-15T07:00:00+07:00",
        "2026-10-15T01:00:00+07:00",
        "2026-10-15T02:30:00+07:00",
        "2026-10-15T03:00:00+07:00",
        "2026-10-15T06:00:00+07:00",
      ].join("\n"),
    }),
  );
  await importHealthShortcut(ws, file);
  expect(readRecords(ws, "sleep")).toMatchObject([
    { start: "2026-10-14T23:30:00+07:00", end: "2026-10-15T06:00:00+07:00", duration_min: 360 },
  ]);
  expect(validateWorkspace(ws)).toEqual([]);
});

it("快捷指令样本写法不一时照常导入，不支持的类型和坏样本只跳过那一条", async () => {
  const ws = await freshWorkspace("Asia/Shanghai");
  const file = join(tmp(), "loose.health.json");
  writeFileSync(
    file,
    JSON.stringify([
      {
        type: "HKQuantityTypeIdentifierStepCount",
        start: "2026-10-15 08:00",
        end: "2026-10-15 09:00",
        value: "8,532 步",
      },
      {
        type: "heart_rate",
        start: "2026-10-15T08:00:00+08:00",
        end: "2026-10-15T08:00:00+08:00",
        value: 72,
        unit: "count/min",
        source: "Watch",
      },
      {
        type: "sleep_analysis",
        start: "2026-10-14T23:30:00+08:00",
        end: "2026-10-15T06:30:00+08:00",
        value: "Core",
      },
      { type: "body_mass", start: "2026-10-15T07:00:00+08:00", value: null },
    ]),
  );
  const result = await importHealthShortcut(ws, file);
  expect(result.ignored).toMatchObject({ unsupported: 1, invalid: 1 });
  expect(readRecords(ws, "activity")).toMatchObject([{ date: "2026-10-15", steps: 8532 }]);
  expect(readRecords(ws, "sleep")).toMatchObject([{ duration_min: 420 }]);
  // 一条都导入不了（类型都不支持）时报错转待整理，不能当成功归档。
  const unsupported = join(tmp(), "unsupported.health.json");
  writeFileSync(
    unsupported,
    JSON.stringify([
      { type: "heart_rate", start: "2026-10-15T08:00:00+08:00", value: 72, unit: "count/min" },
    ]),
  );
  await expect(importHealthShortcut(ws, unsupported)).rejects.toThrow(/没有能导入的样本：1 条类型暂不支持/);
  // 读得出但不合记录格式的单条（心情写成 happy）只跳过这一条。
  const mixed = join(tmp(), "mixed.health.json");
  writeFileSync(
    mixed,
    JSON.stringify([
      { type: "body_mass", start: "2026-10-16T07:00:00+08:00", value: 70.2, unit: "kg" },
      { type: "state_of_mind", start: "2026-10-16T08:00:00+08:00", value: "happy", unit: "" },
      // 写了却读不出的距离不悄悄丢掉，这条样本算读不出
      { type: "workout", start: "2026-10-16T18:00:00+08:00", value: 30, workout: { distance_km: "five" } },
    ]),
  );
  expect((await importHealthShortcut(ws, mixed)).ignored).toMatchObject({ invalid: 2 });
  expect(readRecords(ws, "metric").some((row) => row.value === 70.2)).toBe(true);
});
