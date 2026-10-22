import { createReadStream, readFileSync, statSync } from "node:fs";
import { Unzip, UnzipInflate } from "fflate";
import { SaxesParser } from "saxes";
import { KaituError } from "../errors.js";
import { isoInZone, localDate, localTimeToInstant, parseTs } from "../time.js";
import type { Workspace } from "../workspace.js";
import { type BatchOptions, type Candidate, candidate, importBatch } from "./batch.js";

const MAX_SAMPLES = 100000;
const MAX_RECORDS = 20000;
const MAX_BYTES = 32 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 128 * 1024 * 1024;
function importLimit(message: string): never {
  throw new KaituError(message, "IMPORT_LIMIT");
}
function checkInput(file: string): void {
  if (statSync(file).size > MAX_BYTES) importLimit("健康文件超过 32 MiB，请分批导入");
}

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
    elevation_up_m?: number;
    elevation_down_m?: number;
    mets?: number;
    avg_pace_s_per_km?: number;
    max_hr?: number;
    avg_cadence?: number;
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
  hiit: "高强度间歇训练",
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
  american_football: "美式橄榄球",
  archery: "射箭",
  australian_football: "澳式橄榄球",
  baseball: "棒球",
  bowling: "保龄球",
  boxing: "拳击",
  climbing: "攀岩",
  cricket: "板球",
  cross_training: "交叉训练",
  curling: "冰壶",
  dance_inspired_training: "舞蹈健身",
  disc_sports: "飞盘",
  equestrian_sports: "马术",
  fencing: "击剑",
  fishing: "钓鱼",
  fitness_gaming: "体感游戏",
  golf: "高尔夫",
  gymnastics: "体操",
  handball: "手球",
  hand_cycling: "手摇车",
  hockey: "曲棍球",
  hunting: "狩猎",
  lacrosse: "长曲棍球",
  martial_arts: "武术",
  mind_and_body: "身心训练",
  mixed_metabolic_cardio_training: "混合代谢有氧",
  paddle_sports: "桨类运动",
  pickleball: "匹克球",
  play: "游玩",
  preparation_and_recovery: "热身与放松",
  racquetball: "短式壁球",
  rugby: "英式橄榄球",
  sailing: "帆船",
  skating: "滑冰",
  snow_sports: "雪上运动",
  softball: "垒球",
  squash: "壁球",
  surfing: "冲浪",
  table_tennis: "乒乓球",
  volleyball: "排球",
  water_fitness: "水中健身",
  water_polo: "水球",
  water_sports: "水上运动",
  wrestling: "摔跤",
  barre: "芭杆训练",
  tai_chi: "太极",
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

/** 手机端预合并的复合值指标：内部类型 → metric kind。 */
const COMPOUND_METRICS: Record<string, { kind: string; parts: number; unit: string }> = {
  BloodPressureRecord: { kind: "bp", parts: 2, unit: "mmHg" },
  HeartRateDaily: { kind: "heart_rate_daily", parts: 3, unit: "bpm" },
  BloodOxygenDaily: { kind: "blood_oxygen", parts: 3, unit: "%" },
};

/** 按天聚合的活动量的单位换算表；能量类沿用默认 kcal 换算。 */
const DAILY_UNITS: Record<string, Record<string, number>> = {
  StepCount: { count: 1 },
  AppleExerciseTime: { min: 1, s: 1 / 60, h: 60 },
  FlightsClimbed: { count: 1 },
  DistanceWalkingRunning: { km: 1, m: 0.001, mi: 1.609344 },
};

/** 手机交来的采集起止时间；end 省略表示采到导出时为止。 */
export interface HealthWindow {
  start: Date;
  end?: Date;
  exportedAt: Date;
}

export function healthCandidates(zone: string, window?: HealthWindow) {
  const candidates: Candidate[] = [];
  let samples = 0;
  function emit(...items: Candidate[]) {
    if (candidates.length + items.length > MAX_RECORDS) importLimit("健康导入超过 20000 条输出记录");
    candidates.push(...items);
  }
  const ignored: Record<string, number> = { unsupported: 0, incomplete_bp: 0 };
  const pressure = new Map<string, { ts: string; systolic?: number; diastolic?: number }>();
  const daily = new Map<string, Map<string, Map<string, number>>>();
  const sleep = new Map<string, Segment[]>();
  function add(sample: HealthSample) {
    if (++samples > MAX_SAMPLES) importLimit("健康文件超过 100000 个样本");
    const span = +parseTs(sample.end) - +parseTs(sample.start);
    if (span < 0 || span > 7 * 86400000) importLimit("健康样本时间跨度须在 7 天以内");
    const type = sample.type;
    if (type === "workout") {
      const workout = sample.workout;
      if (!workout || !Number.isFinite(workout.duration_min) || workout.duration_min <= 0)
        throw new Error("Invalid workout duration");
      if (+parseTs(sample.end) < +parseTs(sample.start)) throw new Error("Invalid workout interval");
      const { activity, ...data } = workout;
      emit(
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
      emit(candidate(eventType, data));
      return;
    }
    // 手机端已合并的复合值：血压 120/80、心率/血氧日聚合 最小/均值/最大。
    const compound = COMPOUND_METRICS[type];
    if (compound) {
      const text = typeof sample.value === "string" ? sample.value.trim() : "";
      const parts = text.split("/");
      if (parts.length !== compound.parts || parts.some((part) => !/^\d+(?:\.\d+)?$/.test(part)))
        throw new Error("复合健康值格式不对");
      const unit = sample.unit?.trim() || compound.unit;
      if (unit !== compound.unit && !(compound.kind === "heart_rate_daily" && unit === "count/min"))
        throw new Error("Unsupported unit");
      emit(
        candidate("metric", {
          ts: isoInZone(parseTs(sample.start), zone),
          kind: compound.kind,
          value: text,
          unit: compound.unit,
          source: "apple-health",
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
        "WalkingHeartRateAverage",
        "HeartRateVariabilitySDNN",
        "VO2Max",
        "RespiratoryRate",
        "BodyTemperature",
        "StepCount",
        "ActiveEnergyBurned",
        "BasalEnergyBurned",
        "AppleExerciseTime",
        "FlightsClimbed",
        "DistanceWalkingRunning",
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
      emit(candidate("metric", { ts, kind, value: amount, unit: outputUnit, source: "apple-health" }));
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
      case "WalkingHeartRateAverage":
        metric("walking_hr", convert({ bpm: 1, "count/min": 1 }), "bpm");
        break;
      case "VO2Max":
        // Apple 官方 XML 导出用 mL/min·kg 拼写，手机端用 ml/kg·min，两种都认。
        metric("vo2max", convert({ "ml/kg·min": 1, "mL/min·kg": 1 }), "ml/kg·min");
        break;
      case "RespiratoryRate":
        metric("respiratory_rate", convert({ "count/min": 1 }), "count/min");
        break;
      case "BodyTemperature": {
        // 华氏度是仿射换算，不能走倍率表；XML 用 degF/degC 拼写，其余单位拒绝而非当摄氏度。
        const warm = unit === "°F" || unit === "F" || unit === "degF";
        const cold = unit === "°C" || unit === "C" || unit === "degC";
        if (!warm && !cold) throw new Error("Unsupported unit");
        const celsius = warm ? (value - 32) * (5 / 9) : value;
        metric("body_temperature", celsius, "°C");
        break;
      }
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
        const amount = convert(DAILY_UNITS[type] ?? { kcal: 1, kJ: 1 / 4.184, cal: 0.001 });
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
      emit(
        candidate("metric", {
          ts: pair.ts,
          kind: "bp",
          value: `${pair.systolic}/${pair.diastolic}`,
          unit: "mmHg",
          source: "apple-health",
        }),
      );
    }
    const today = window ? localDate(new Date(), zone) : undefined;
    for (const [date, types] of daily) {
      // 今天允许累计到导出截止；历史日必须盖满，延迟的半日文件不能覆盖整天。
      if (
        window &&
        (+localTimeToInstant(`${date}T00:00:00`, zone) < +window.start ||
          (+localTimeToInstant(`${nextDay(date)}T00:00:00`, zone) > +(window.end ?? window.exportedAt) &&
            (window.end !== undefined || date !== today || localDate(window.exportedAt, zone) !== date)))
      ) {
        ignored.partial_day = (ignored.partial_day ?? 0) + 1;
        continue;
      }
      const max = (type: string) => {
        const sources = types.get(type);
        return sources ? Math.max(...sources.values()) : undefined;
      };
      const steps = max("StepCount");
      const active = max("ActiveEnergyBurned");
      const basal = max("BasalEnergyBurned");
      const exercise = max("AppleExerciseTime");
      const flights = max("FlightsClimbed");
      const distance = max("DistanceWalkingRunning");
      emit({
        ...candidate("activity", {
          ts: isoInZone(localTimeToInstant(`${date}T00:00:00`, zone), zone),
          date,
          ...(steps === undefined ? {} : { steps: Math.round(steps) }),
          ...(active === undefined ? {} : { active_kcal: active }),
          ...(active === undefined && basal === undefined
            ? {}
            : { total_kcal: (active ?? 0) + (basal ?? 0) }),
          ...(exercise === undefined ? {} : { exercise_min: Math.round(exercise) }),
          ...(flights === undefined ? {} : { flights_climbed: Math.round(flights) }),
          ...(distance === undefined ? {} : { distance_km: Math.round(distance * 100) / 100 }),
          source: "apple-health",
          ...(window ? { source_exported_at: window.exportedAt.toISOString() } : {}),
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
        emit(
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
  checkInput(inputFile);
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
      let expanded = 0;
      let declared = 0;
      const count = (data: Uint8Array) => {
        expanded += data.byteLength;
        if (expanded > MAX_EXPANDED_BYTES) importLimit("ZIP 累计解压内容超过 128 MiB");
      };
      const unzip = new Unzip((file) => {
        declared += file.originalSize ?? 0;
        if (declared > MAX_EXPANDED_BYTES) importLimit("ZIP 累计解压内容超过 128 MiB");
        if (file.name !== "apple_health_export/export.xml") {
          // 未启动的条目会被 fflate 缓存；消费并丢弃，避免 CDA、路线文件积满内存。
          file.ondata = (err, data) => {
            if (err) throw err;
            count(data);
          };
          file.start();
          return;
        }
        if (found) throw new Error("Duplicate export.xml");
        found = true;
        file.ondata = (err, data, final) => {
          if (err) throw err;
          count(data);
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
  } catch (error) {
    if (error instanceof KaituError) throw error;
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
  height: { type: "Height", unit: "cm" },
  glucose: { type: "BloodGlucose", unit: "mmol/L" },
  resting_heart_rate: { type: "RestingHeartRate", unit: "bpm" },
  walking_heart_rate: { type: "WalkingHeartRateAverage", unit: "bpm" },
  hrv_sdnn: { type: "HeartRateVariabilitySDNN", unit: "ms" },
  vo2max: { type: "VO2Max", unit: "ml/kg·min" },
  respiratory_rate: { type: "RespiratoryRate", unit: "count/min" },
  body_temperature: { type: "BodyTemperature", unit: "°C" },
  blood_pressure: { type: "BloodPressureRecord", unit: "mmHg" },
  heart_rate_daily: { type: "HeartRateDaily", unit: "bpm" },
  blood_oxygen: { type: "BloodOxygenDaily", unit: "%" },
  sleep_analysis: { type: "HKCategoryTypeIdentifierSleepAnalysis", unit: "" },
  active_energy: { type: "ActiveEnergyBurned", unit: "kcal" },
  basal_energy: { type: "BasalEnergyBurned", unit: "kcal" },
  exercise_minutes: { type: "AppleExerciseTime", unit: "min" },
  flights_climbed: { type: "FlightsClimbed", unit: "count" },
  distance_walking_running: { type: "DistanceWalkingRunning", unit: "km" },
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
  const type = shortcutType(raw.type);
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
  if ((columns.values?.length ?? 0) > MAX_SAMPLES) importLimit("健康文件超过 100000 个样本");
  // 每行的问题只让这一行算读不出（交给样本循环跳过并计数），不拖垮整份文件。
  return (columns.values ?? []).map((value, index) => {
    const start = columns.starts?.[index] ?? "";
    if (!value || !start) return { invalid: "的 values 或 starts 为空" };
    const end = columns.ends?.[index] ?? start;
    try {
      if (+parseTs(end) < +parseTs(start)) return { invalid: "的 ends 早于 starts" };
    } catch {
      return { invalid: "的时间读不出" };
    }
    const daily = [
      "step_count",
      "active_energy",
      "basal_energy",
      "exercise_minutes",
      "flights_climbed",
      "distance_walking_running",
    ].includes(type);
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

/** 快捷指令里常见的类型叫法（官方标识、驼峰、中文）→ 本文件的 type。 */
const SHORTCUT_TYPE_NAMES: Record<string, string> = {
  stepcount: "step_count",
  steps: "step_count",
  步数: "step_count",
  bodymass: "body_mass",
  weight: "body_mass",
  体重: "body_mass",
  bodyfatpercentage: "body_fat_percentage",
  bodyfat: "body_fat_percentage",
  体脂率: "body_fat_percentage",
  restingheartrate: "resting_heart_rate",
  静息心率: "resting_heart_rate",
  heartratevariabilitysdnn: "hrv_sdnn",
  hrv: "hrv_sdnn",
  心率变异性: "hrv_sdnn",
  sleepanalysis: "sleep_analysis",
  sleep: "sleep_analysis",
  睡眠: "sleep_analysis",
  activeenergyburned: "active_energy",
  activeenergy: "active_energy",
  活动能量: "active_energy",
  basalenergyburned: "basal_energy",
  restingenergy: "basal_energy",
  静息能量: "basal_energy",
  基础能量: "basal_energy",
  体能训练: "workout",
  身高: "height",
  // 注意：oxygensaturation / 血氧 不做别名——原始 SpO2 样本会撞上预聚合的
  // blood_oxygen 复合值校验而整份转待整理；原始逐样本血氧暂不支持。
  bloodpressure: "blood_pressure",
  血压: "blood_pressure",
  walkingheartrateaverage: "walking_heart_rate",
  步行心率: "walking_heart_rate",
  最大摄氧量: "vo2max",
  respiratoryrate: "respiratory_rate",
  呼吸频率: "respiratory_rate",
  bodytemperature: "body_temperature",
  体温: "body_temperature",
  appleexercisetime: "exercise_minutes",
  锻炼分钟: "exercise_minutes",
  运动分钟: "exercise_minutes",
  flightsclimbed: "flights_climbed",
  爬楼: "flights_climbed",
  distancewalkingrunning: "distance_walking_running",
  步行加跑步距离: "distance_walking_running",
  bloodglucose: "glucose",
  血糖: "glucose",
};
const SHORTCUT_UNITS: Record<string, string> = {
  步: "count",
  steps: "count",
  Cal: "kcal",
  千卡: "kcal",
  大卡: "kcal",
  公斤: "kg",
  千克: "kg",
  磅: "lb",
  毫秒: "ms",
  秒: "s",
  "次/分": "bpm",
  "次/分钟": "bpm",
  分钟: "min",
};

function shortcutType(value: unknown): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (SHORTCUT_TYPES[text] || healthEventType(text)) return text;
  const key = text
    .replace(/^HK(?:Quantity|Category)TypeIdentifier/, "")
    .toLowerCase()
    .replace(/[\s_-]/g, "");
  return SHORTCUT_TYPE_NAMES[key] ?? SHORTCUT_TYPE_NAMES[text] ?? (SHORTCUT_TYPES[key] ? key : text);
}

function shortcutTime(value: unknown, zone: string): string {
  const text = typeof value === "string" ? value.trim().replace(/([+-]\d{2})(\d{2})$/, "$1:$2") : "";
  const local = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?$/.exec(text);
  return local
    ? isoInZone(localTimeToInstant(`${local[1]}T${local[2]}:${local[3]}:${local[4] ?? "00"}`, zone), zone)
    : text;
}

/** 补齐快捷指令常漏的来源、单位，换掉「8,532 步」这类写法；类型不认识的交给后面计为不支持。 */
function shortcutSample(input: unknown, device: string, zone: string): HealthSample {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("样本必须是对象");
  const raw = input as Record<string, unknown>;
  const type = shortcutType(raw.type);
  const definition = SHORTCUT_TYPES[type];
  const start = shortcutTime(raw.start ?? raw.startDate ?? raw.date, zone);
  const end = shortcutTime(raw.end ?? raw.endDate, zone) || start;
  let value = raw.value as number | string | undefined;
  let unit = typeof raw.unit === "string" ? raw.unit.trim() : undefined;
  const quantity =
    definition &&
    !["sleep_analysis", "workout", "blood_pressure", "heart_rate_daily", "blood_oxygen"].includes(type);
  if (quantity && typeof value === "string") {
    const match = /^\s*(-?[\d,]+(?:\.\d+)?)\s*(.*)$/.exec(value);
    if (match) {
      value = Number(match[1]?.replace(/,/g, ""));
      if (!unit && match[2]) unit = match[2].trim();
    }
  }
  if (value === undefined || value === null || value === "") throw new Error("没有数值");
  if (typeof value !== "number" && typeof value !== "string") throw new Error("数值格式不对");
  unit = SHORTCUT_UNITS[unit ?? ""] ?? unit ?? definition?.unit ?? "";
  if (!unit && definition) unit = definition.unit;
  const source = typeof raw.source === "string" && raw.source.trim() ? raw.source.trim() : device;
  parseTs(start);
  parseTs(end);
  let workout: HealthSample["workout"];
  if (type === "workout") {
    const data = (raw.workout ?? {}) as Record<string, unknown>;
    const duration = Number(data.duration_min ?? value);
    if (!Number.isFinite(duration) || duration <= 0) throw new Error("训练没有时长");
    workout = {
      activity: typeof data.activity === "string" ? data.activity : "other",
      duration_min: duration,
    };
    for (const key of [
      "distance_km",
      "kcal",
      "avg_hr",
      "elevation_up_m",
      "elevation_down_m",
      "mets",
      "avg_pace_s_per_km",
      "max_hr",
      "avg_cadence",
    ] as const) {
      if (data[key] === undefined || data[key] === null || data[key] === "") continue;
      // 写了却读不出的数量（"five"）让这条样本算作读不出并计数，不悄悄丢掉。
      const amount = Number(data[key]);
      if (!Number.isFinite(amount)) throw new Error(`训练的 ${key} 读不出`);
      workout[key] = amount;
    }
  }
  return {
    type: definition?.type ?? type,
    start,
    end,
    source,
    unit,
    value: type === "sleep_analysis" ? (SLEEP_VALUES[String(value).trim().toLowerCase()] ?? value) : value,
    workout,
  };
}

export function parseHealthShortcut(inputFile: string, zone: string) {
  checkInput(inputFile);
  try {
    const parsed = JSON.parse(readFileSync(inputFile, "utf8"));
    // 也接受直接导出的样本数组。
    const raw = Array.isArray(parsed) ? { samples: parsed } : parsed;
    if (!raw || typeof raw !== "object") throw new Error("Invalid health shortcut envelope");
    const parallel = "values" in raw && "starts" in raw && "type" in raw;
    if (raw.format !== undefined && raw.format !== "kaitu.health.v1")
      throw new Error("Invalid health shortcut format");
    const device = typeof raw.device === "string" && raw.device.trim() ? raw.device.trim() : "快捷指令";
    const samples: unknown[] = parallel ? parallelSamples(raw) : raw.samples;
    if (!Array.isArray(samples)) throw new Error("缺少 samples 样本数组");
    if (samples.length > MAX_SAMPLES) importLimit("健康文件超过 100000 个样本");
    const window =
      raw.window === undefined
        ? undefined
        : {
            start: parseTs(raw.window.start),
            exportedAt: parseTs(raw.exported_at),
            ...(raw.window.end === undefined ? {} : { end: parseTs(raw.window.end) }),
          };
    const collector = healthCandidates(zone, window);
    // 单条样本有问题只跳过这一条，其余照常导入；全部读不出时才整份转待整理。
    const skipped: string[] = [];
    for (const [index, input] of samples.entries()) {
      const invalid = (input as { invalid?: unknown } | null)?.invalid;
      if (parallel && typeof invalid === "string") {
        skipped.push(`第 ${index + 1} 行${invalid}`);
        continue;
      }
      try {
        collector.add(shortcutSample(input, device, zone));
      } catch (error) {
        if (error instanceof KaituError) throw error;
        skipped.push(`第 ${index + 1} 条${(error as Error).message}`);
      }
    }
    const result = collector.finish();
    // 有样本却一条都没导入（读不出、类型都不支持）时转待整理，不能当成功归档。
    if (samples.length && !result.candidates.length && !result.ignored.partial_day) {
      const reasons = skipped.slice(0, 3);
      if (skipped.length > 3) reasons.push(`另有 ${skipped.length - 3} 条读不出`);
      if (result.ignored.unsupported) reasons.push(`${result.ignored.unsupported} 条类型暂不支持`);
      if (result.ignored.incomplete_bp) reasons.push(`${result.ignored.incomplete_bp} 条血压缺另一半`);
      throw new Error(`没有能导入的样本：${reasons.join("；")}`);
    }
    if (skipped.length) result.ignored.invalid = skipped.length;
    return result;
  } catch (error) {
    if (error instanceof KaituError) throw error;
    throw new KaituError(`无法解析快捷指令健康文件：${(error as Error).message}`, "INVALID_IMPORT");
  }
}

export async function importHealthShortcut(ws: Workspace, inputFile: string, opts: BatchOptions = {}) {
  const { candidates, ignored } = parseHealthShortcut(inputFile, ws.timeZone());
  return importBatch(ws, "apple-health", candidates, {
    skipInvalid: true,
    ...opts,
    ignored,
    message: (count) => `从 Apple 健康同步了 ${count} 条记录（快捷指令）`,
  });
}
