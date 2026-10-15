import { createReadStream, readFileSync } from "node:fs";
import { Unzip, UnzipInflate } from "fflate";
import { SaxesParser } from "saxes";
import { KaituError } from "../errors.js";
import { isoInZone, localDate, localTimeToInstant, parseTs } from "../time.js";
import type { Workspace } from "../workspace.js";
import { type BatchOptions, type Candidate, candidate, importBatch } from "./batch.js";

const QUANTITY = "HKQuantityTypeIdentifier";
const ASLEEP = new Set(["Asleep", "AsleepCore", "AsleepDeep", "AsleepREM", "AsleepUnspecified"]);
interface Segment {
  start: number;
  end: number;
}
interface Session extends Segment {
  duration: number;
}

function healthDate(value: string): Date {
  return parseTs(value.replace(" ", "T").replace(/ ([+-]\d{2})(\d{2})$/, "$1:$2"));
}

function nextDay(day: string): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
}

function sessions(segments: Segment[]): Session[] {
  const out: Session[] = [];
  for (const segment of segments.sort((a, b) => a.start - b.start || a.end - b.end)) {
    const last = out.at(-1);
    if (!last || segment.start - last.end >= 3600000) {
      out.push({ ...segment, duration: segment.end - segment.start });
    } else {
      last.duration += Math.max(0, segment.end - Math.max(segment.start, last.end));
      last.end = Math.max(last.end, segment.end);
    }
  }
  return out;
}

export interface HealthSample {
  type: string;
  start: string;
  end: string;
  value?: number | string;
  unit?: string;
  source: string;
  workout?: {
    activity: string;
    duration_min: number;
    distance_km?: number;
    kcal?: number;
    avg_hr?: number;
  };
}

const ACTIVITIES: Record<string, string> = {
  running: "跑步",
  cycling: "骑行",
  walking: "步行",
  hiking: "徒步",
  swimming: "游泳",
  traditional_strength_training: "传统力量训练",
  functional_strength_training: "功能性力量训练",
  yoga: "瑜伽",
  pilates: "普拉提",
  elliptical: "椭圆机",
  rowing: "划船",
  stair_climbing: "爬楼",
  high_intensity_interval_training: "高强度间歇训练",
  core_training: "核心训练",
  mixed_cardio: "混合有氧",
  dance: "舞蹈",
  basketball: "篮球",
  soccer: "足球",
  tennis: "网球",
  badminton: "羽毛球",
  jump_rope: "跳绳",
  cooldown: "放松",
  flexibility: "柔韧训练",
  other: "其他训练",
};

function activityName(value: string): string {
  const key = value
    .replace(/^HKWorkoutActivityType/, "")
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .toLowerCase();
  return ACTIVITIES[key] ?? (/\p{Script=Han}/u.test(value) ? value : "体能训练");
}

function healthEventType(type: string) {
  if (type.startsWith("symptom_")) return "symptom" as const;
  if (type === "state_of_mind") return "mood" as const;
  if (type === "heart_notification") return "heart_notification" as const;
}

export function healthCandidates(zone: string) {
  const candidates: Candidate[] = [];
  const ignored: Record<string, number> = { unsupported: 0, incomplete_bp: 0 };
  const pressure = new Map<string, { ts: string; systolic?: number; diastolic?: number }>();
  const daily = new Map<string, Map<string, Map<string, number>>>();
  const sleep = new Map<string, Segment[]>();
  function add(sample: HealthSample) {
    const type = sample.type;
    if (type === "workout") {
      const workout = sample.workout;
      if (!workout || !Number.isFinite(workout.duration_min) || workout.duration_min <= 0)
        throw new Error("Invalid workout duration");
      if (+parseTs(sample.end) < +parseTs(sample.start)) throw new Error("Invalid workout interval");
      const { activity, ...data } = workout;
      candidates.push(
        candidate("workout", {
          ts: isoInZone(parseTs(sample.start), zone),
          modality: "cardio",
          exercise: activityName(activity),
          ...data,
        }),
      );
      return;
    }
    const eventType = healthEventType(type);
    if (eventType) {
      if (sample.unit !== "" || typeof sample.value !== "string")
        throw new Error("健康事件必须使用字符串值与空单位");
      const start = parseTs(sample.start);
      if (+parseTs(sample.end) < +start) throw new Error("Invalid health event interval");
      const data: Record<string, unknown> = {
        ts: isoInZone(start, zone),
        source: "apple-health",
      };
      if (eventType === "symptom") {
        data.kind = type.slice("symptom_".length);
        data[data.kind === "appetite_changes" ? "appetite_change" : "severity"] = sample.value;
      } else data[eventType === "mood" ? "valence" : "kind"] = sample.value;
      candidates.push(candidate(eventType, data));
      return;
    }
    if (
      ![
        "BodyMass",
        "BodyFatPercentage",
        "Height",
        "BloodPressureSystolic",
        "BloodPressureDiastolic",
        "BloodGlucose",
        "RestingHeartRate",
        "HeartRateVariabilitySDNN",
        "StepCount",
        "ActiveEnergyBurned",
        "BasalEnergyBurned",
        "HKCategoryTypeIdentifierSleepAnalysis",
      ].includes(type)
    ) {
      ignored.unsupported = (ignored.unsupported ?? 0) + 1;
      return;
    }
    const start = parseTs(sample.start);
    const ts = isoInZone(start, zone);
    const source = sample.source;
    if (type === "HKCategoryTypeIdentifierSleepAnalysis") {
      if (!ASLEEP.has(String(sample.value ?? "").replace("HKCategoryValueSleepAnalysis", ""))) {
        ignored.unsupported = (ignored.unsupported ?? 0) + 1;
        return;
      }
      const end = parseTs(sample.end).getTime();
      if (end < +start) throw new Error("Invalid sleep interval");
      const segments = sleep.get(source) ?? [];
      segments.push({ start: +start, end });
      sleep.set(source, segments);
      return;
    }
    const value = Number(sample.value);
    if (sample.value === undefined || !Number.isFinite(value) || value < 0)
      throw new Error("Invalid quantity");
    const unit = sample.unit;
    const metric = (kind: string, amount: number | string, outputUnit: string) => {
      candidates.push(
        candidate("metric", { ts, kind, value: amount, unit: outputUnit, source: "apple-health" }),
      );
    };
    const convert = (units: Record<string, number>) => {
      const factor = unit === undefined ? undefined : units[unit];
      if (factor === undefined) throw new Error("Unsupported unit");
      return value * factor;
    };
    switch (type) {
      case "BodyMass":
        metric("weight", convert({ kg: 1, lb: 0.45359237, g: 0.001 }), "kg");
        break;
      case "BodyFatPercentage":
        metric("body_fat", convert({ "%": 1, fraction: 100 }), "%");
        break;
      case "Height":
        metric("height", convert({ cm: 1, m: 100, in: 2.54, ft: 30.48 }), "cm");
        break;
      case "BloodGlucose":
        metric("glucose", convert({ "mmol/L": 1, "mg/dL": 1 / 18.0182 }), "mmol/L");
        break;
      case "RestingHeartRate":
        metric("resting_hr", convert({ bpm: 1, "count/min": 1 }), "bpm");
        break;
      case "HeartRateVariabilitySDNN":
        metric("hrv_sdnn", convert({ ms: 1, s: 1000 }), "ms");
        break;
      case "BloodPressureSystolic":
      case "BloodPressureDiastolic": {
        const pair = pressure.get(ts) ?? { ts };
        if (type === "BloodPressureSystolic") pair.systolic = value;
        else pair.diastolic = value;
        pressure.set(ts, pair);
        break;
      }
      default: {
        const amount =
          type === "StepCount" ? convert({ count: 1 }) : convert({ kcal: 1, kJ: 1 / 4.184, cal: 0.001 });
        const end = parseTs(sample.end);
        if (+end < +start) throw new Error("Invalid activity interval");
        let cursor = +start;
        do {
          const day = localDate(new Date(cursor), zone);
          const until = Math.min(+end, +localTimeToInstant(`${nextDay(day)}T00:00:00`, zone));
          const fraction = +end === +start ? 1 : (until - cursor) / (+end - +start);
          const types = daily.get(day) ?? new Map<string, Map<string, number>>();
          const sources = types.get(type) ?? new Map<string, number>();
          sources.set(source, (sources.get(source) ?? 0) + amount * fraction);
          types.set(type, sources);
          daily.set(day, types);
          cursor = until;
        } while (cursor < +end);
      }
    }
  }
  function finish() {
    for (const pair of pressure.values()) {
      if (pair.systolic === undefined || pair.diastolic === undefined) {
        ignored.incomplete_bp = (ignored.incomplete_bp ?? 0) + 1;
        continue;
      }
      candidates.push(
        candidate("metric", {
          ts: pair.ts,
          kind: "bp",
          value: `${pair.systolic}/${pair.diastolic}`,
          unit: "mmHg",
          source: "apple-health",
        }),
      );
    }
    for (const [date, types] of daily) {
      const max = (type: string) => {
        const sources = types.get(type);
        return sources ? Math.max(...sources.values()) : undefined;
      };
      const steps = max("StepCount");
      const active = max("ActiveEnergyBurned");
      const basal = max("BasalEnergyBurned");
      candidates.push({
        ...candidate("activity", {
          ts: isoInZone(localTimeToInstant(`${date}T00:00:00`, zone), zone),
          date,
          ...(steps === undefined ? {} : { steps: Math.round(steps) }),
          ...(active === undefined ? {} : { active_kcal: active }),
          ...(active === undefined && basal === undefined
            ? {}
            : { total_kcal: (active ?? 0) + (basal ?? 0) }),
          source: "apple-health",
        }),
        activityTotals: { basalKcal: basal },
      });
    }
    const nights = new Map<string, Map<string, Session[]>>();
    for (const [source, segments] of sleep) {
      for (const session of sessions(segments)) {
        // 用醒来时间向前移十二小时区分夜间睡眠与次日夜晚，保留同来源的独立小睡。
        const night = localDate(new Date(session.end - 43200000), zone);
        const sources = nights.get(night) ?? new Map<string, Session[]>();
        sources.set(source, [...(sources.get(source) ?? []), session]);
        nights.set(night, sources);
      }
    }
    for (const sources of nights.values()) {
      const selected = [...sources.entries()].sort(
        ([a, left], [b, right]) =>
          right.reduce((sum, s) => sum + s.duration, 0) - left.reduce((sum, s) => sum + s.duration, 0) ||
          a.localeCompare(b),
      )[0];
      for (const session of selected?.[1] ?? []) {
        const start = isoInZone(new Date(session.start), zone);
        candidates.push(
          candidate("sleep", {
            ts: start,
            start,
            end: isoInZone(new Date(session.end), zone),
            duration_min: session.duration / 60000,
            source: "apple-health",
          }),
        );
      }
    }
    return { candidates, ignored };
  }
  return { add, finish };
}

export async function parseAppleHealth(inputFile: string, zone: string) {
  const collector = healthCandidates(zone);
  const parser = new SaxesParser();
  let root = false;
  let workout: HealthSample | undefined;
  parser.on("opentag", (tag) => {
    if (tag.name === "HealthData") root = true;
    const attr = tag.attributes as Record<string, string>;
    if (tag.name === "Record") {
      const type = (attr.type ?? "").replace(QUANTITY, "");
      collector.add({
        type,
        start: healthDate(attr.startDate ?? "").toISOString(),
        end: healthDate(attr.endDate ?? attr.startDate ?? "").toISOString(),
        value: attr.value,
        unit: type === "BodyFatPercentage" ? "fraction" : attr.unit,
        source: attr.sourceName ?? "",
      });
    }
    if (tag.name === "Workout") {
      const start = healthDate(attr.startDate ?? "");
      const end = healthDate(attr.endDate ?? "");
      const scale = (value: string | undefined, unit: string | undefined, units: Record<string, number>) => {
        if (value === undefined) return undefined;
        const factor = units[unit ?? ""];
        if (factor === undefined) throw new Error("Unsupported workout unit");
        const amount = Number(value) * factor;
        if (!Number.isFinite(amount) || amount < 0) throw new Error("Invalid workout quantity");
        return amount;
      };
      workout = {
        type: "workout",
        start: start.toISOString(),
        end: end.toISOString(),
        source: attr.sourceName ?? "",
        workout: {
          activity: attr.workoutActivityType ?? "other",
          duration_min:
            scale(attr.duration, attr.durationUnit, { min: 1, s: 1 / 60, hr: 60 }) ?? (+end - +start) / 60000,
          distance_km: scale(attr.totalDistance, attr.totalDistanceUnit, {
            km: 1,
            m: 0.001,
            mi: 1.609344,
            yd: 0.0009144,
          }),
          kcal: scale(attr.totalEnergyBurned, attr.totalEnergyBurnedUnit, {
            kcal: 1,
            kJ: 1 / 4.184,
            cal: 0.001,
          }),
        },
      };
    }
    if (tag.name === "WorkoutStatistics" && workout?.workout) {
      const type = (attr.type ?? "").replace(QUANTITY, "");
      if (type.startsWith("Distance") && attr.sum !== undefined) {
        const factor = { km: 1, m: 0.001, mi: 1.609344, yd: 0.0009144 }[attr.unit ?? "km"];
        if (factor === undefined) throw new Error("Unsupported workout distance unit");
        workout.workout.distance_km = Number(attr.sum) * factor;
      }
      if (type === "ActiveEnergyBurned" && attr.sum !== undefined) {
        const factor = { kcal: 1, kJ: 1 / 4.184, cal: 0.001 }[attr.unit ?? "kcal"];
        if (factor === undefined) throw new Error("Unsupported workout energy unit");
        workout.workout.kcal = Number(attr.sum) * factor;
      }
      if (type === "HeartRate" && attr.average !== undefined) workout.workout.avg_hr = Number(attr.average);
    }
  });
  parser.on("closetag", (tag) => {
    if (tag.name === "Workout" && workout) {
      collector.add(workout);
      workout = undefined;
    }
  });
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const pushXml = (data: Uint8Array, final: boolean) => {
    parser.write(decoder.decode(data, { stream: !final }));
    if (final) parser.close();
  };
  try {
    if (inputFile.toLowerCase().endsWith(".zip")) {
      let found = false;
      let finished = false;
      const unzip = new Unzip((file) => {
        if (file.name !== "apple_health_export/export.xml") {
          // 未启动的条目会被 fflate 缓存；消费并丢弃，避免 CDA、路线文件积满内存。
          file.ondata = (err) => {
            if (err) throw err;
          };
          file.start();
          return;
        }
        if (found) throw new Error("Duplicate export.xml");
        found = true;
        file.ondata = (err, data, final) => {
          if (err) throw err;
          pushXml(data, final);
          if (final) finished = true;
        };
        file.start();
      });
      unzip.register(UnzipInflate);
      for await (const chunk of createReadStream(inputFile)) unzip.push(chunk);
      unzip.push(new Uint8Array(), true);
      if (!found || !finished) throw new Error("Missing export.xml");
    } else {
      for await (const chunk of createReadStream(inputFile)) pushXml(chunk, false);
      pushXml(new Uint8Array(), true);
    }
    if (!root) throw new Error("Missing HealthData");
  } catch {
    throw new KaituError("无法解析 Apple Health 导出文件", "INVALID_IMPORT");
  }
  return collector.finish();
}

export async function importAppleHealth(ws: Workspace, inputFile: string, opts: BatchOptions = {}) {
  const { candidates, ignored } = await parseAppleHealth(inputFile, ws.timeZone());
  return importBatch(ws, "apple-health", candidates, { ...opts, ignored });
}

const SHORTCUT_TYPES: Record<string, { type: string; unit: string }> = {
  step_count: { type: "StepCount", unit: "count" },
  body_mass: { type: "BodyMass", unit: "kg" },
  body_fat_percentage: { type: "BodyFatPercentage", unit: "fraction" },
  resting_heart_rate: { type: "RestingHeartRate", unit: "bpm" },
  hrv_sdnn: { type: "HeartRateVariabilitySDNN", unit: "ms" },
  sleep_analysis: { type: "HKCategoryTypeIdentifierSleepAnalysis", unit: "" },
  active_energy: { type: "ActiveEnergyBurned", unit: "kcal" },
  basal_energy: { type: "BasalEnergyBurned", unit: "kcal" },
  workout: { type: "workout", unit: "min" },
};
const SLEEP_VALUES: Record<string, string> = {
  asleep: "Asleep",
  asleep_core: "AsleepCore",
  asleep_deep: "AsleepDeep",
  asleep_rem: "AsleepREM",
  asleep_unspecified: "AsleepUnspecified",
  awake: "Awake",
  in_bed: "InBed",
  core: "AsleepCore",
  deep: "AsleepDeep",
  rem: "AsleepREM",
  "in bed": "InBed",
  核心: "AsleepCore",
  深度: "AsleepDeep",
  快速动眼: "AsleepREM",
  快速眼动: "AsleepREM",
  清醒: "Awake",
  在床上: "InBed",
  睡眠: "Asleep",
  睡着: "Asleep",
  已入睡: "Asleep",
  核心睡眠: "AsleepCore",
  深度睡眠: "AsleepDeep",
  快速动眼睡眠: "AsleepREM",
};

function parallelSamples(raw: Record<string, unknown>) {
  const type = typeof raw.type === "string" ? raw.type : "";
  const definition = SHORTCUT_TYPES[type];
  if (!definition) throw new Error(`未知健康类型：${type}`);
  // 没有样本时快捷指令发来空字符串（如不戴表睡觉），直接归档，不生成笔记。
  if (raw.values === "" && raw.starts === "") return [];
  const columns: Record<string, string[]> = {};
  for (const key of ["values", "starts", "ends", "units", "names", "sources"]) {
    const value = raw[key];
    if (value === undefined && !["values", "starts"].includes(key)) continue;
    if (typeof value !== "string") throw new Error(`${key} 必须是换行分隔的字符串`);
    const lines = value.split(/\r\n|\n|\r/).map((line) => line.trim());
    const count = columns.values?.length;
    if (count !== undefined && lines.length !== count)
      throw new Error(`${key} 有 ${lines.length} 行，与 values 的 ${count} 行不一致`);
    columns[key] = lines;
  }
  if (type === "sleep_analysis" && !columns.ends) throw new Error("sleep_analysis 缺少 ends");
  return (columns.values ?? []).map((value, index) => {
    const start = columns.starts?.[index] ?? "";
    if (!value || !start) throw new Error(`第 ${index + 1} 行的 values 或 starts 为空`);
    const end = columns.ends?.[index] ?? start;
    parseTs(end);
    if (+parseTs(end) < +parseTs(start)) throw new Error(`第 ${index + 1} 行的 ends 早于 starts`);
    const daily = ["step_count", "active_energy", "basal_energy"].includes(type);
    return {
      type,
      start,
      // 并列列表的活动值已经按天汇总，不按首条样本至 ends 的时长分摊。
      end: daily ? start : end,
      value,
      unit: columns.units?.[index] ?? definition.unit,
      source: columns.sources?.[index] ?? "快捷指令",
      ...(type === "workout"
        ? { workout: { activity: columns.names?.[index] ?? "other", duration_min: Number(value) } }
        : {}),
    };
  });
}

export function parseHealthShortcut(inputFile: string, zone: string) {
  try {
    const raw = JSON.parse(readFileSync(inputFile, "utf8"));
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
      throw new Error("Invalid health shortcut envelope");
    const parallel = "values" in raw && "starts" in raw && "type" in raw;
    let samples = raw.samples;
    if (parallel) {
      if (raw.format !== undefined && raw.format !== "kaitu.health.v1")
        throw new Error("Invalid health shortcut format");
      samples = parallelSamples(raw);
    } else {
      if (raw.format !== "kaitu.health.v1" || typeof raw.device !== "string" || !Array.isArray(samples))
        throw new Error("Invalid health shortcut envelope");
      parseTs(raw.exported_at);
    }
    const collector = healthCandidates(zone);
    for (const sample of samples) {
      const type =
        SHORTCUT_TYPES[sample.type]?.type ??
        (typeof sample.type === "string" && healthEventType(sample.type) ? sample.type : undefined);
      if (
        !type ||
        typeof sample.source !== "string" ||
        typeof sample.unit !== "string" ||
        !["number", "string"].includes(typeof sample.value)
      )
        throw new Error("Invalid health sample");
      parseTs(sample.start);
      parseTs(sample.end);
      let workout: HealthSample["workout"];
      if (type === "workout") {
        const data = sample.workout;
        if (!data || typeof data.activity !== "string" || typeof data.duration_min !== "number")
          throw new Error("Invalid workout");
        workout = { activity: data.activity, duration_min: data.duration_min };
        for (const key of ["distance_km", "kcal", "avg_hr"] as const) {
          if (data[key] !== undefined) {
            if (typeof data[key] !== "number") throw new Error("Invalid workout quantity");
            workout[key] = data[key];
          }
        }
      }
      collector.add({
        type,
        start: sample.start,
        end: sample.end,
        source: sample.source,
        unit: sample.unit,
        value:
          type === "HKCategoryTypeIdentifierSleepAnalysis"
            ? (SLEEP_VALUES[String(sample.value).toLowerCase()] ?? sample.value)
            : sample.value,
        workout,
      });
    }
    return collector.finish();
  } catch (error) {
    throw new KaituError(`无法解析快捷指令健康文件：${(error as Error).message}`, "INVALID_IMPORT");
  }
}

export async function importHealthShortcut(ws: Workspace, inputFile: string, opts: BatchOptions = {}) {
  const { candidates, ignored } = parseHealthShortcut(inputFile, ws.timeZone());
  return importBatch(ws, "apple-health", candidates, {
    ...opts,
    ignored,
    message: (count) => `从 Apple 健康同步了 ${count} 条记录（快捷指令）`,
  });
}
