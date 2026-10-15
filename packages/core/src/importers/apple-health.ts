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
  return ACTIVITIES[key] ?? "体能训练";
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
    if (
      ![
        "BodyMass",
        "BodyFatPercentage",
        "Height",
        "BloodPressureSystolic",
        "BloodPressureDiastolic",
        "BloodGlucose",
        "RestingHeartRate",
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
      candidates.push(
        candidate("activity", {
          ts: isoInZone(localTimeToInstant(`${date}T00:00:00`, zone), zone),
          date,
          ...(steps === undefined ? {} : { steps: Math.round(steps) }),
          ...(active === undefined ? {} : { active_kcal: active }),
          ...(active === undefined && basal === undefined
            ? {}
            : { total_kcal: (active ?? 0) + (basal ?? 0) }),
          source: "apple-health",
        }),
      );
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

const SHORTCUT_TYPES: Record<string, string> = {
  step_count: "StepCount",
  body_mass: "BodyMass",
  body_fat_percentage: "BodyFatPercentage",
  resting_heart_rate: "RestingHeartRate",
  sleep_analysis: "HKCategoryTypeIdentifierSleepAnalysis",
  active_energy: "ActiveEnergyBurned",
  basal_energy: "BasalEnergyBurned",
  workout: "workout",
};
const SLEEP_VALUES: Record<string, string> = {
  asleep: "Asleep",
  asleep_core: "AsleepCore",
  asleep_deep: "AsleepDeep",
  asleep_rem: "AsleepREM",
  asleep_unspecified: "AsleepUnspecified",
  awake: "Awake",
  in_bed: "InBed",
};

export function parseHealthShortcut(inputFile: string, zone: string) {
  try {
    const raw = JSON.parse(readFileSync(inputFile, "utf8"));
    if (raw.format !== "kaitu.health.v1" || typeof raw.device !== "string" || !Array.isArray(raw.samples))
      throw new Error("Invalid health shortcut envelope");
    parseTs(raw.exported_at);
    const collector = healthCandidates(zone);
    for (const sample of raw.samples) {
      const type = SHORTCUT_TYPES[sample.type];
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
            ? (SLEEP_VALUES[sample.value] ?? sample.value)
            : sample.value,
        workout,
      });
    }
    return collector.finish();
  } catch {
    throw new KaituError("无法解析快捷指令健康文件", "INVALID_IMPORT");
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
