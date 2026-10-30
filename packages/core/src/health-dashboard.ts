import { type ReadWarning, readIssue } from "./errors.js";
import type { StoredRecord } from "./records.js";
import { sleepStageMinutes, sleepStageTimeline, validSleepStages } from "./sleep-stages.js";
import { localDate } from "./time.js";

const number = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const estimated = (row: StoredRecord) =>
  Number(row.uncertainty) > 0 || /估算|estimate|caloriemate|nut.?ai/i.test(String(row.source));
const offset = (date: string, days: number) =>
  new Date(Date.parse(`${date}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10);

/** Pure projection of already folded records. The caller owns reading, invalidation and publication. */
export function buildHealthDashboard(
  records: Record<string, StoredRecord[]>,
  today: string,
  timeZone: string,
  now: Date,
  warnings: ReadWarning[],
) {
  const day = (ts: string) => localDate(new Date(ts), timeZone);
  const dates = (count: number) => Array.from({ length: count }, (_, i) => offset(today, i + 1 - count));
  const rows = (type: string, field = "ts") =>
    (records[type] ?? [])
      .filter(
        (row) => Number.isFinite(Date.parse(String(row[field]))) && Date.parse(String(row[field])) <= +now,
      )
      .sort((a, b) => Date.parse(String(a[field])) - Date.parse(String(b[field])));
  const groups = new Map<string, StoredRecord[]>();
  for (const row of rows("metric")) {
    if (
      typeof row.kind !== "string" ||
      typeof row.unit !== "string" ||
      !(number(row.value) !== null || (typeof row.value === "string" && row.value.length > 0))
    ) {
      warnings.push(readIssue("invalid_record", row.id, `身体指标 ${row.id} 无法显示数值`));
      continue;
    }
    const key = `${row.kind}:${row.unit}`;
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  const point = (row: StoredRecord) => ({
    id: row.id,
    ts: row.ts,
    date: day(row.ts),
    value: row.value as number | string,
    estimated: estimated(row),
  });
  const metrics = [...groups.values()].map((group) => {
    const latest = group.at(-1) as StoredRecord;
    const kind = String(latest.kind);
    const from = offset(today, ["weight", "body_fat"].includes(kind) ? -83 : -29);
    const points = group.filter((r) => day(r.ts) >= from).map(point);
    const values = points
      .flatMap((p) => (typeof p.value === "number" ? [p.value] : []))
      .sort((a, b) => a - b);
    const quantile = (q: number) => {
      const position = (values.length - 1) * q;
      const left = values[Math.floor(position)] as number;
      return left + ((values[Math.ceil(position)] as number) - left) * (position % 1);
    };
    const first = points[0]?.value;
    const last = points.at(-1)?.value;
    return {
      kind,
      unit: String(latest.unit),
      latest: point(latest),
      points,
      change:
        points.length > 1 && typeof first === "number" && typeof last === "number" ? last - first : null,
      range: values.length >= 2 ? { q1: quantile(0.25), q3: quantile(0.75) } : null,
    };
  });
  let bmi: { value: number; ts: string; weightKg: number; heightCm: number; estimated: boolean } | null =
    null;
  const heights = groups.get("height:cm") ?? [];
  for (const weight of [...(groups.get("weight:kg") ?? [])].reverse()) {
    if (day(weight.ts) < offset(today, -83)) break;
    const height = heights.findLast(
      (r) => Date.parse(r.ts) <= Date.parse(weight.ts) && day(r.ts) === day(weight.ts),
    );
    const weightKg = number(weight.value);
    const heightCm = number(height?.value);
    if (weightKg !== null && weightKg > 0 && heightCm !== null && heightCm > 0) {
      bmi = {
        value: weightKg / (heightCm / 100) ** 2,
        ts: weight.ts,
        weightKg,
        heightCm,
        estimated: estimated(weight) || (height ? estimated(height) : false),
      };
      break;
    }
  }
  const activityRows = rows("activity");
  const activity = dates(7).map((date) => {
    const matches = activityRows.filter((r) => r.date === date);
    const max = (field: string) => {
      const values = matches.flatMap((r) => (number(r[field]) === null ? [] : [r[field] as number]));
      return values.length ? Math.max(...values) : null;
    };
    const basal = matches.flatMap((r) => {
      const total = number(r.total_kcal);
      const active = number(r.active_kcal);
      return total !== null && active !== null && total >= active ? [total - active] : [];
    });
    return {
      date,
      estimated: matches.some(estimated),
      steps: max("steps"),
      activeKcal: max("active_kcal"),
      basalKcal: basal.length ? Math.max(...basal) : null,
      exerciseMin: max("exercise_min"),
      distanceKm: max("distance_km"),
      flightsClimbed: max("flights_climbed"),
    };
  });
  const sleep = rows("sleep", "end")
    .filter((row) => day(String(row.end)) >= offset(today, -364))
    .flatMap((row) => {
      const durationMin = number(row.duration_min);
      if (
        typeof row.start !== "string" ||
        typeof row.end !== "string" ||
        durationMin === null ||
        durationMin < 0 ||
        !Number.isFinite(Date.parse(row.start)) ||
        Date.parse(row.start) > Date.parse(row.end)
      ) {
        warnings.push(readIssue("invalid_record", row.id, `睡眠记录 ${row.id} 无法显示起止和时长`));
        return [];
      }
      const stages =
        validSleepStages(row.stages, row.start, row.end) && row.stages.length
          ? sleepStageTimeline(row.stages)
          : null;
      if (row.stages !== undefined && !validSleepStages(row.stages, row.start, row.end))
        warnings.push(readIssue("invalid_record", row.id, `睡眠记录 ${row.id} 的阶段无法显示`));
      return [
        {
          id: row.id,
          date: day(row.end),
          start: row.start,
          end: row.end,
          durationMin,
          estimated: estimated(row),
          stages,
          stageMinutes: stages ? sleepStageMinutes(stages) : null,
        },
      ];
    });
  const moods = rows("mood");
  const mood = dates(14).map((date) => ({
    date,
    valence: (moods.findLast((r) => day(r.ts) === date)?.valence as string | undefined) ?? null,
  }));
  const symptoms = rows("symptom")
    .filter((r) => day(r.ts) >= offset(today, -13))
    .map((r) => ({
      id: r.id,
      ts: r.ts,
      kind: String(r.kind),
      severity: typeof r.severity === "string" ? r.severity : null,
      appetiteChange: typeof r.appetite_change === "string" ? r.appetite_change : null,
    }));
  const heartNotifications = rows("heart_notification")
    .filter((r) => day(r.ts) >= offset(today, -29))
    .map((r) => ({ id: r.id, ts: r.ts, kind: String(r.kind) }));
  return { metrics, bmi, activity, sleep, mood, symptoms, heartNotifications };
}

export type HealthDashboard = ReturnType<typeof buildHealthDashboard>;
