import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { strToU8, zipSync } from "fflate";
import { expect, it } from "vitest";
import { history, restore } from "../src/history.js";
import { importAppleHealth, importHealthShortcut } from "../src/importers/apple-health.js";
import { addRecord, deleteRecord, readRecords, updateRecord } from "../src/records.js";
import { validateWorkspace } from "../src/validate.js";
import { freshWorkspace, tmp } from "./helpers.js";

const fixture = fileURLToPath(new URL("../../../examples/apple-health/export.xml", import.meta.url));

it("完整日补导替换日总量且重放不累加，整夜片段补导保持同一睡眠记录", async () => {
  const ws = await freshWorkspace();
  const file = join(tmp(), "whole-day.health.json");
  const steps = (value: number, start: string, end: string) => ({
    type: "step_count",
    value,
    unit: "count",
    source: "Watch",
    start,
    end,
  });
  const first = steps(3000, "2026-10-14T09:00:00+08:00", "2026-10-14T10:00:00+08:00");
  const later = steps(2500, "2026-10-14T10:00:00+08:00", "2026-10-14T12:00:00+08:00");
  const sleep = (start: string, end: string) => ({
    type: "sleep_analysis",
    value: "asleep",
    unit: "",
    source: "Watch",
    start,
    end,
  });
  const earlySleep = sleep("2026-10-13T23:00:00+08:00", "2026-10-14T03:00:00+08:00");
  const lateSleep = sleep("2026-10-14T03:10:00+08:00", "2026-10-14T07:00:00+08:00");
  const deliver = async (samples: unknown[]) => {
    writeFileSync(
      file,
      JSON.stringify({ format: "kaitu.health.v1", exported_at: "2026-10-14T12:00:00+08:00", samples }),
    );
    return importHealthShortcut(ws, file);
  };
  await deliver([first, earlySleep]);
  const activityID = readRecords(ws, "activity")[0]?.id;
  const sleepID = readRecords(ws, "sleep")[0]?.id;
  await deliver([first, later, earlySleep, lateSleep]);
  expect(readRecords(ws, "activity")).toMatchObject([{ id: activityID, steps: 5500 }]);
  expect(readRecords(ws, "sleep")).toMatchObject([
    { id: sleepID, duration_min: 470, end: "2026-10-14T07:00:00+08:00" },
  ]);
  expect((await deliver([first, later, earlySleep, lateSleep])).version).toBeNull();
  expect(readRecords(ws, "activity")).toHaveLength(1);
  expect(readRecords(ws, "sleep")).toHaveLength(1);
});

it("Apple训练泛名升级保留id且重放幂等，人工修订和删除保持优先", async () => {
  const ws = await freshWorkspace();
  const file = join(tmp(), "workout-rename.health.json");
  const starts = [
    "2026-10-14T09:00:00+08:00",
    "2026-10-14T10:00:00+08:00",
    "2026-10-14T11:00:00+08:00",
    "2026-10-14T12:00:00+08:00",
  ];
  const old = starts.map(
    (ts, index) =>
      addRecord(
        ws,
        "workout",
        { ts, modality: "cardio", exercise: index === 3 ? "其他训练" : "体能训练", duration_min: 30 },
        { by: "import:apple-health" },
      ).record,
  );
  updateRecord(ws, "workout", old[1]?.id as string, { exercise: "我核对的训练" }, { by: "user" });
  deleteRecord(ws, "workout", old[2]?.id as string, { by: "user" });
  const samples = starts.map((start, index) => ({
    type: "workout",
    start,
    end: start.replace(":00:00", ":30:00"),
    source: "Watch",
    value: 30,
    unit: "min",
    workout: { activity: index === 3 ? "pilates" : "hiit", duration_min: 30 },
  }));
  writeFileSync(
    file,
    JSON.stringify({ format: "kaitu.health.v1", exported_at: "2026-10-14T12:00:00+08:00", samples }),
  );
  const result = await importHealthShortcut(ws, file);
  expect(result).toMatchObject({ added: 0, updated: 2, skipped: 2 });
  expect(readRecords(ws, "workout")).toMatchObject([
    { id: old[0]?.id, exercise: "高强度间歇训练", rev: 2 },
    { id: old[1]?.id, exercise: "我核对的训练", by: "user" },
    { id: old[3]?.id, exercise: "普拉提", rev: 2 },
  ]);
  expect((await importHealthShortcut(ws, file)).version).toBeNull();
  const alongside = addRecord(
    ws,
    "workout",
    { ts: starts[0], modality: "cardio", exercise: "跑步", duration_min: 20 },
    { by: "import:apple-health" },
  ).record;
  writeFileSync(
    file,
    JSON.stringify({
      format: "kaitu.health.v1",
      exported_at: "2026-10-14T12:00:00+08:00",
      samples: [{ ...samples[0], workout: { activity: "unknown_sport", duration_min: 30 } }],
    }),
  );
  expect((await importHealthShortcut(ws, file)).version).toBeNull();
  expect(readRecords(ws, "workout").find((row) => row.id === old[0]?.id)?.exercise).toBe("高强度间歇训练");
  expect(readRecords(ws, "workout").find((row) => row.id === alongside.id)?.exercise).toBe("跑步");
  const ambiguous = addRecord(
    ws,
    "workout",
    { ts: "2026-10-14T13:00:00+08:00", modality: "cardio", exercise: "其他训练", duration_min: 30 },
    { by: "import:apple-health" },
  ).record;
  writeFileSync(
    file,
    JSON.stringify({
      format: "kaitu.health.v1",
      samples: ["running", "pickleball"].map((activity) => ({
        ...samples[0],
        start: ambiguous.ts,
        end: "2026-10-14T13:30:00+08:00",
        workout: { activity, duration_min: 30 },
      })),
    }),
  );
  expect(await importHealthShortcut(ws, file)).toMatchObject({ added: 2, updated: 0 });
  expect(readRecords(ws, "workout").find((row) => row.id === ambiguous.id)).toMatchObject({
    exercise: "其他训练",
    duration_min: 30,
  });
  expect((await importHealthShortcut(ws, file)).version).toBeNull();
  expect(validateWorkspace(ws)).toEqual([]);
});

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
  expect((await importAppleHealth(ws, fixture)).version).toBeNull();
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

it("并列列表里一行读不出只跳过那一行，其余照常导入", async () => {
  const ws = await freshWorkspace("Asia/Shanghai");
  const file = join(tmp(), "steps.health.json");
  writeFileSync(
    file,
    JSON.stringify({
      type: "step_count",
      values: "8000\n\n9000",
      starts: "2026-10-14T08:00:00+08:00\n2026-10-15T08:00:00+08:00\n2026-10-16T08:00:00+08:00",
    }),
  );
  const result = await importHealthShortcut(ws, file);
  expect(result.ignored).toMatchObject({ invalid: 1 });
  expect(readRecords(ws, "activity").map((row) => row.steps)).toEqual([8000, 9000]);
});

it("扩展指标：步行心率、最大摄氧、呼吸、体温华氏转摄氏、身高与血糖照常入指标", async () => {
  const ws = await freshWorkspace("Asia/Shanghai");
  const file = join(tmp(), "extended.health.json");
  const raw = {
    format: "kaitu.health.v1",
    samples: [
      {
        type: "walking_heart_rate",
        start: "2026-10-01T09:00:00+08:00",
        end: "2026-10-01T09:00:00+08:00",
        value: 88,
        unit: "bpm",
        source: "Watch",
      },
      {
        type: "vo2max",
        start: "2026-10-01T18:00:00+08:00",
        end: "2026-10-01T18:00:00+08:00",
        value: 42.5,
        unit: "ml/kg·min",
        source: "Watch",
      },
      {
        type: "respiratory_rate",
        start: "2026-10-02T07:00:00+08:00",
        end: "2026-10-02T07:00:00+08:00",
        value: 14,
        unit: "count/min",
        source: "Watch",
      },
      {
        type: "body_temperature",
        start: "2026-10-02T08:00:00+08:00",
        end: "2026-10-02T08:00:00+08:00",
        value: 98.6,
        unit: "°F",
        source: "Watch",
      },
      {
        type: "body_temperature",
        start: "2026-10-04T08:00:00+08:00",
        end: "2026-10-04T08:00:00+08:00",
        value: 99.1,
        unit: "degF",
        source: "Watch",
      },
      {
        type: "VO2Max",
        start: "2026-10-04T09:00:00+08:00",
        end: "2026-10-04T09:00:00+08:00",
        value: 41.2,
        unit: "mL/min·kg",
        source: "Watch",
      },
      {
        type: "height",
        start: "2026-10-01T08:00:00+08:00",
        end: "2026-10-01T08:00:00+08:00",
        value: 175,
        unit: "cm",
        source: "iPhone",
      },
      {
        type: "glucose",
        start: "2026-10-03T07:30:00+08:00",
        end: "2026-10-03T07:30:00+08:00",
        value: 5.6,
        unit: "mmol/L",
        source: "Meter",
      },
    ],
  };
  writeFileSync(file, JSON.stringify(raw));
  const result = await importHealthShortcut(ws, file);
  expect(result.added).toBe(8);
  const metrics = readRecords(ws, "metric").map(({ kind, value, unit }) => ({ kind, value, unit }));
  expect(metrics).toEqual(
    expect.arrayContaining([
      { kind: "walking_hr", value: 88, unit: "bpm" },
      { kind: "vo2max", value: 42.5, unit: "ml/kg·min" },
      { kind: "respiratory_rate", value: 14, unit: "count/min" },
      { kind: "body_temperature", unit: "°C", value: 37 },
      { kind: "body_temperature", unit: "°C", value: (99.1 - 32) * (5 / 9) },
      { kind: "vo2max", value: 41.2, unit: "ml/kg·min" },
      { kind: "height", value: 175, unit: "cm" },
      { kind: "glucose", value: 5.6, unit: "mmol/L" },
    ]),
  );
  expect(validateWorkspace(ws)).toEqual([]);
});

it("复合值：血压 120/80、心率与血氧日聚合 最小/均值/最大 字符串原样入指标", async () => {
  const ws = await freshWorkspace("Asia/Shanghai");
  const file = join(tmp(), "compound.health.json");
  const raw = {
    format: "kaitu.health.v1",
    samples: [
      {
        type: "blood_pressure",
        start: "2026-10-01T08:00:00+08:00",
        end: "2026-10-01T08:00:00+08:00",
        value: "120/80",
        unit: "mmHg",
        source: "Cuff",
      },
      {
        type: "heart_rate_daily",
        start: "2026-10-01T00:00:00+08:00",
        end: "2026-10-01T00:00:00+08:00",
        value: "52/68/98",
        unit: "bpm",
        source: "Watch",
      },
      {
        type: "blood_oxygen",
        start: "2026-10-01T00:00:00+08:00",
        end: "2026-10-01T00:00:00+08:00",
        value: "95/97/100",
        unit: "%",
        source: "Watch",
      },
    ],
  };
  writeFileSync(file, JSON.stringify(raw));
  const result = await importHealthShortcut(ws, file);
  expect(result.added).toBe(3);
  const metrics = readRecords(ws, "metric").map(({ kind, value, unit }) => ({ kind, value, unit }));
  expect(metrics).toEqual(
    expect.arrayContaining([
      { kind: "bp", value: "120/80", unit: "mmHg" },
      { kind: "heart_rate_daily", value: "52/68/98", unit: "bpm" },
      { kind: "blood_oxygen", value: "95/97/100", unit: "%" },
    ]),
  );
  expect(validateWorkspace(ws)).toEqual([]);
});

it("复合指标按类型补非空单位并拒绝错误分量和不兼容单位", async () => {
  const ws = await freshWorkspace("Asia/Shanghai");
  const file = join(tmp(), "compound-boundaries.health.json");
  const valid = [
    ["BloodPressureRecord", "120/80"],
    ["HeartRateDaily", "52/68/98"],
    ["BloodOxygenDaily", "95/97/100"],
  ];
  const samples = valid.flatMap(([type, value]) => [
    { type, value, unit: "   " },
    { type, value },
  ]);
  const invalid = [
    { type: "blood_pressure", value: "120/80/70" },
    { type: "heart_rate_daily", value: "52/68" },
    { type: "blood_oxygen", value: "95/97" },
    { type: "blood_pressure", value: "120/80", unit: "bpm" },
    { type: "heart_rate_daily", value: "52/68/98", unit: "mmHg" },
    { type: "blood_oxygen", value: "95/97/100", unit: "bpm" },
  ];
  writeFileSync(
    file,
    JSON.stringify({
      format: "kaitu.health.v1",
      samples: [...samples, { type: "HeartRateDaily", value: "50/60/90", unit: "count/min" }, ...invalid].map(
        (sample, index) => ({
          ...sample,
          start: `2026-10-01T08:${String(index).padStart(2, "0")}:00+08:00`,
          source: "Synthetic",
        }),
      ),
    }),
  );
  const result = await importHealthShortcut(ws, file);
  expect(result).toMatchObject({ added: 7, ignored: { invalid: 6 } });
  const metrics = readRecords(ws, "metric");
  expect(metrics.map(({ kind, value, unit }) => ({ kind, value, unit }))).toEqual([
    { kind: "bp", value: "120/80", unit: "mmHg" },
    { kind: "bp", value: "120/80", unit: "mmHg" },
    { kind: "heart_rate_daily", value: "52/68/98", unit: "bpm" },
    { kind: "heart_rate_daily", value: "52/68/98", unit: "bpm" },
    { kind: "blood_oxygen", value: "95/97/100", unit: "%" },
    { kind: "blood_oxygen", value: "95/97/100", unit: "%" },
    { kind: "heart_rate_daily", value: "50/60/90", unit: "bpm" },
  ]);
  expect(validateWorkspace(ws)).toEqual([]);
});

it("累计爬升下降允许零和正值，负值训练逐条跳过", async () => {
  const ws = await freshWorkspace("Asia/Shanghai");
  const file = join(tmp(), "workout-elevation-boundary.health.json");
  const amounts = [
    [0, 0],
    [12, 5],
    [-1, 0],
    [0, -1],
  ];
  writeFileSync(
    file,
    JSON.stringify({
      format: "kaitu.health.v1",
      samples: amounts.map(([elevation_up_m, elevation_down_m], index) => ({
        type: "workout",
        start: `2026-10-01T0${index}:00:00+08:00`,
        end: `2026-10-01T0${index}:15:00+08:00`,
        unit: "min",
        value: 15,
        source: "Synthetic",
        workout: { activity: "hiking", duration_min: 15, elevation_up_m, elevation_down_m },
      })),
    }),
  );
  const result = await importHealthShortcut(ws, file);
  expect(result).toMatchObject({ added: 2, ignored: { invalid: 2 } });
  expect(readRecords(ws, "workout")).toMatchObject([
    { elevation_up_m: 0, elevation_down_m: 0 },
    { elevation_up_m: 12, elevation_down_m: 5 },
  ]);
  expect(validateWorkspace(ws)).toEqual([]);
});

it("活动扩展：锻炼分钟、爬楼、步行跑步距离按天入 activity 记录", async () => {
  const ws = await freshWorkspace("Asia/Shanghai");
  const file = join(tmp(), "activity-ext.health.json");
  const raw = {
    format: "kaitu.health.v1",
    samples: [
      {
        type: "exercise_minutes",
        start: "2026-10-01T00:00:00+08:00",
        end: "2026-10-02T00:00:00+08:00",
        value: 62,
        unit: "min",
        source: "Watch",
      },
      {
        type: "flights_climbed",
        start: "2026-10-01T00:00:00+08:00",
        end: "2026-10-02T00:00:00+08:00",
        value: 11,
        unit: "count",
        source: "Watch",
      },
      {
        type: "distance_walking_running",
        start: "2026-10-01T00:00:00+08:00",
        end: "2026-10-02T00:00:00+08:00",
        value: 6.25,
        unit: "km",
        source: "Watch",
      },
    ],
  };
  writeFileSync(file, JSON.stringify(raw));
  const result = await importHealthShortcut(ws, file);
  expect(result.added).toBe(1);
  expect(readRecords(ws, "activity")).toMatchObject([
    { date: "2026-10-01", exercise_min: 62, flights_climbed: 11, distance_km: 6.25 },
  ]);
  expect(validateWorkspace(ws)).toEqual([]);
});

it("训练扩展：新运动名与爬升、METs、配速、最大心率原样落记录", async () => {
  const ws = await freshWorkspace("Asia/Shanghai");
  const file = join(tmp(), "workout-ext.health.json");
  const raw = {
    format: "kaitu.health.v1",
    samples: [
      {
        type: "workout",
        start: "2026-10-01T07:00:00+08:00",
        end: "2026-10-01T08:00:00+08:00",
        value: 60,
        unit: "min",
        source: "Watch",
        workout: {
          activity: "pickleball",
          duration_min: 60,
          distance_km: 8.2,
          kcal: 540,
          avg_hr: 142,
          max_hr: 168,
          elevation_up_m: 320,
          elevation_down_m: 310,
          mets: 7.6,
          avg_pace_s_per_km: 439,
          avg_cadence: 170,
        },
      },
      {
        type: "workout",
        start: "2026-10-02T19:00:00+08:00",
        end: "2026-10-02T19:45:00+08:00",
        value: 45,
        unit: "min",
        source: "Watch",
        workout: { activity: "hiit", duration_min: 45, max_hr: 172 },
      },
    ],
  };
  writeFileSync(file, JSON.stringify(raw));
  const result = await importHealthShortcut(ws, file);
  expect(result.added).toBe(2);
  expect(readRecords(ws, "workout")).toMatchObject([
    {
      modality: "cardio",
      exercise: "匹克球",
      duration_min: 60,
      distance_km: 8.2,
      kcal: 540,
      avg_hr: 142,
      max_hr: 168,
      elevation_up_m: 320,
      elevation_down_m: 310,
      mets: 7.6,
      avg_pace_s_per_km: 439,
      avg_cadence: 170,
    },
    { modality: "cardio", exercise: "高强度间歇训练", duration_min: 45, max_hr: 172 },
  ]);
  expect(validateWorkspace(ws)).toEqual([]);
});

it("手机采集窗口按另一时区的零点开始时，只写盖满的整天，不把已有整天步数改成半天", async () => {
  const ws = await freshWorkspace("Asia/Shanghai");
  addRecord(
    ws,
    "activity",
    { ts: "2026-10-14T00:00:00+08:00", date: "2026-10-14", steps: 9000, source: "apple-health" },
    { by: "import:apple-health" },
  );
  const file = join(tmp(), "window.health.json");
  const step = (start: string, value: number) => ({
    type: "step_count",
    start,
    end: start,
    value,
    unit: "count",
  });
  writeFileSync(
    file,
    JSON.stringify({
      format: "kaitu.health.v1",
      // 手机在 +07:00，窗口从手机的 10-14 零点开始，即上海 10-14 01:00。
      exported_at: "2026-10-16T00:00:00+08:00",
      window: { start: "2026-10-14T00:00:00+07:00", end: "2026-10-16T00:00:00+08:00" },
      samples: [step("2026-10-14T08:00:00+07:00", 1200), step("2026-10-15T08:00:00+07:00", 3000)],
    }),
  );
  await importHealthShortcut(ws, file);
  const days = Object.fromEntries(readRecords(ws, "activity").map((row) => [row.date, row.steps]));
  expect(days).toEqual({ "2026-10-14": 9000, "2026-10-15": 3000 });
});

it("当天累计保留导出顺序，旧文件和重放不覆盖，较新删除纠正允许下降", async () => {
  const ws = await freshWorkspace("UTC");
  const file = join(tmp(), "ordered.health.json");
  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  const start = `${day}T00:00:00Z`;
  const elapsed = +now - Date.parse(start);
  const early = new Date(Date.parse(start) + Math.floor(elapsed / 3)).toISOString();
  const middle = new Date(Date.parse(start) + Math.floor((elapsed * 2) / 3)).toISOString();
  const deliver = async (value: number, exported_at: string) => {
    writeFileSync(
      file,
      JSON.stringify({
        format: "kaitu.health.v1",
        exported_at,
        window: { start },
        samples: [{ type: "step_count", start, end: start, value, unit: "count" }],
      }),
    );
    return importHealthShortcut(ws, file);
  };
  await deliver(3000, early);
  const id = readRecords(ws, "activity")[0].id;
  await deliver(9000, middle);
  expect((await deliver(3000, early)).version).toBeNull();
  expect(readRecords(ws, "activity")).toMatchObject([{ id, steps: 9000 }]);
  // 数值未变也记住较新的截止，避免随后到达的中间快照回退它。
  await deliver(9000, now.toISOString());
  expect((await deliver(5000, middle)).version).toBeNull();
  const corrected = new Date().toISOString();
  await deliver(2000, corrected);
  expect(readRecords(ws, "activity")).toMatchObject([{ id, steps: 2000, source_exported_at: corrected }]);
  expect((await deliver(2000, corrected)).version).toBeNull();
  expect(validateWorkspace(ws)).toEqual([]);
});

it("延迟到达的历史未完整尾日跳过，完整日仍能以较新导出纠正", async () => {
  const ws = await freshWorkspace("UTC");
  const file = join(tmp(), "delayed.health.json");
  const end = `${new Date().toISOString().slice(0, 10)}T00:00:00Z`;
  const start = new Date(Date.parse(end) - 86400000).toISOString();
  const partial = new Date(Date.parse(start) + 3600000).toISOString();
  const deliver = async (value: number, exported_at: string, window: { start: string; end?: string }) => {
    writeFileSync(
      file,
      JSON.stringify({
        format: "kaitu.health.v1",
        exported_at,
        window,
        samples: [{ type: "step_count", start, end: start, value, unit: "count" }],
      }),
    );
    return importHealthShortcut(ws, file);
  };
  await deliver(9000, end, { start, end });
  const stale = await deliver(3000, partial, { start });
  expect(stale.ignored.partial_day).toBe(1);
  expect(stale.version).toBeNull();
  expect(readRecords(ws, "activity")[0].steps).toBe(9000);
  await deliver(2500, new Date().toISOString(), { start, end });
  expect(readRecords(ws, "activity")[0].steps).toBe(2500);
  expect(validateWorkspace(ws)).toEqual([]);
});
