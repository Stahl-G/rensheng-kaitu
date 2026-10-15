import { createReadStream } from "node:fs";
import { Unzip, UnzipInflate } from "fflate";
import { SaxesParser } from "saxes";
import { KaituError } from "../errors.js";
import { isoInZone, localDate, localTimeToInstant, parseTs } from "../time.js";
import type { Workspace } from "../workspace.js";
import { type Candidate, candidate, importBatch } from "./batch.js";

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

export async function importAppleHealth(ws: Workspace, inputFile: string, opts: { dryRun?: boolean } = {}) {
  const zone = ws.timeZone();
  const candidates: Candidate[] = [];
  const ignored: Record<string, number> = { unsupported: 0, incomplete_bp: 0 };
  const pressure = new Map<string, { ts: string; systolic?: number; diastolic?: number }>();
  const daily = new Map<string, Map<string, Map<string, number>>>();
  const sleep = new Map<string, Segment[]>();
  const parser = new SaxesParser();
  let root = false;
  parser.on("opentag", (tag) => {
    if (tag.name === "HealthData") root = true;
    if (tag.name === "Workout") ignored.unsupported = (ignored.unsupported ?? 0) + 1;
    if (tag.name !== "Record") return;
    const attr = tag.attributes as Record<string, string>;
    const type = (attr.type ?? "").replace(QUANTITY, "");
    const supported = [
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
    ];
    if (!supported.includes(type)) {
      ignored.unsupported = (ignored.unsupported ?? 0) + 1;
      return;
    }
    const start = healthDate(attr.startDate ?? "");
    const ts = isoInZone(start, zone);
    const source = attr.sourceName ?? "";
    if (type === "HKCategoryTypeIdentifierSleepAnalysis") {
      if (!ASLEEP.has((attr.value ?? "").replace("HKCategoryValueSleepAnalysis", ""))) {
        ignored.unsupported = (ignored.unsupported ?? 0) + 1;
        return;
      }
      const end = healthDate(attr.endDate ?? "").getTime();
      if (end < +start) throw new Error("Invalid sleep interval");
      const segments = sleep.get(source) ?? [];
      segments.push({ start: +start, end });
      sleep.set(source, segments);
      return;
    }
    const value = Number(attr.value);
    if (attr.value === undefined || !Number.isFinite(value) || value < 0) throw new Error("Invalid quantity");
    const unit = attr.unit;
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
        metric("body_fat", value * 100, "%");
        break;
      case "Height":
        metric("height", convert({ cm: 1, m: 100, in: 2.54, ft: 30.48 }), "cm");
        break;
      case "BloodGlucose":
        metric("glucose", convert({ "mmol/L": 1, "mg/dL": 1 / 18.0182 }), "mmol/L");
        break;
      case "RestingHeartRate":
        metric("resting_hr", value, "bpm");
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
        const end = healthDate(attr.endDate ?? attr.startDate ?? "");
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
        ...(active === undefined && basal === undefined ? {} : { total_kcal: (active ?? 0) + (basal ?? 0) }),
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
  return importBatch(ws, "apple-health", candidates, { ...opts, ignored });
}
