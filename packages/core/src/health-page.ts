import { readdirSync } from "node:fs";
import type { Pose } from "./photos.js";
import type { StoredRecord } from "./records.js";
import { dailyRecordTotals, workoutSessions } from "./status.js";
import { localDate, parseTs } from "./time.js";
import { readWorkbench } from "./workbench.js";
import type { Workspace } from "./workspace.js";

function offset(date: string, days: number) {
  return new Date(Date.parse(`${date}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
}
function estimated(row: StoredRecord) {
  return Number(row.uncertainty) > 0 || /估算|estimate|caloriemate|nut.?ai/i.test(String(row.source));
}
function part(row: StoredRecord): string | null {
  if (typeof row.body_part === "string") return row.body_part;
  if (row.modality === "cardio") return null;
  const name = String(row.exercise);
  return (
    ([
      ["腿部", /深蹲|腿举|腿屈伸|腿弯举|弓步|squat|lunge|leg press/i],
      ["胸部", /卧推|俯卧撑|夹胸|飞鸟|bench press|push.?up|chest/i],
      ["背部", /硬拉|划船|引体|下拉|deadlift|row|pull.?up|pulldown/i],
      ["肩部", /推肩|肩推|侧平举|shoulder|overhead press|lateral raise/i],
      ["手臂", /弯举|臂屈伸|二头|三头|curl|triceps|biceps/i],
      ["核心", /卷腹|平板支撑|腹肌|crunch|plank/i],
    ].find(([, pattern]) => (pattern as RegExp).test(name))?.[0] as string | undefined) ?? null
  );
}

function cloudWorkouts(ws: Workspace) {
  const rows: Record<string, unknown>[] = [];
  function walk(dir: string) {
    if (!ws.exists(dir)) return;
    for (const entry of readdirSync(ws.resolve(dir), { withFileTypes: true })) {
      const file = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(file);
      else if (entry.isFile() && entry.name.endsWith(".records.jsonl")) {
        try {
          const records = ws
            .readText(file)
            .split(/\r?\n/)
            .filter(Boolean)
            .map((line) => JSON.parse(line));
          const agent = records.find((r) => typeof r?.agent === "string")?.agent;
          rows.push(
            ...records.filter((r) => r?.type === "workout").map((r) => ({ ...r, agent: r.agent ?? agent })),
          );
        } catch {
          // 损坏的归档不影响训练记录读取。
        }
      }
    }
  }
  walk("inbox/processed");
  return rows;
}

export function readHealthPage(ws: Workspace, now = new Date()) {
  const data = readWorkbench(ws, now);
  const day = (ts: unknown) => localDate(parseTs(String(ts)), data.timeZone);
  const records = (type: string, field = "ts") =>
    (data.records[type] ?? []).filter((row) => Date.parse(String(row[field])) <= now.getTime());
  const dates = (count: number) => Array.from({ length: count }, (_, i) => offset(data.today, i + 1 - count));
  const from = offset(data.today, -29);
  const month = data.today.slice(0, 7);
  const previousMonth = offset(`${month}-01`, -1).slice(0, 7);
  const monday = offset(data.today, -(new Date(`${data.today}T12:00:00Z`).getUTCDay() + 6) % 7);
  const cloud = cloudWorkouts(ws);
  const recorder = (row: StoredRecord) => {
    if (row.by === "user") return "你";
    const archived = cloud.find(
      (r) =>
        r.exercise === row.exercise && (r.session_id ? r.session_id === row.session_id : r.ts === row.ts),
    );
    if (archived) return `云端 Agent · ${String(archived.agent ?? "未记录名称")}`;
    if (typeof row.agent === "string") return `云端 Agent · ${row.agent}`;
    if (/cloud/i.test(String(row.source))) return `云端 Agent · ${String(row.source)}`;
    if (row.by === "agent") return "本机 Agent";
    return row.by === "import:apple-health" ? "Apple 健康导入" : "导入记录";
  };
  const sessions = workoutSessions(records("workout"), data.timeZone).map((rows) => {
    const first = rows[0] as StoredRecord;
    const durations = rows.flatMap((r) => (typeof r.duration_min === "number" ? [r.duration_min] : []));
    const reps = rows
      .filter((r) => r.modality !== "cardio")
      .reduce((n, r) => n + Number(r.sets) * Number(r.reps), 0);
    return {
      id: String(first.session_id ?? first.id),
      ts: first.ts,
      date: day(first.ts),
      parts: [...new Set(rows.map(part).filter((p): p is string => p !== null))],
      duration: durations.length ? Math.max(...durations) : null,
      repetitions: reps,
      exercises: rows.map((r) => ({
        id: r.id,
        name: String(r.exercise),
        cardio: r.modality === "cardio",
        sets: typeof r.sets === "number" ? r.sets : null,
        reps: typeof r.reps === "number" ? r.reps : null,
        weight: typeof r.weight_kg === "number" ? r.weight_kg : null,
        distance: typeof r.distance_km === "number" ? r.distance_km : null,
        duration: typeof r.duration_min === "number" ? r.duration_min : null,
        recorder: recorder(r),
        estimated: estimated(r),
      })),
    };
  });
  const thisMonth = sessions.filter((s) => s.date.startsWith(month));
  const lastMonth = sessions.filter((s) => s.date.startsWith(previousMonth));
  const thisWeek = sessions.filter((s) => s.date >= monday);
  const parts = new Map<string, number>();
  for (const session of thisMonth)
    for (const name of session.parts) parts.set(name, (parts.get(name) ?? 0) + 1);
  const topPart = [...parts].sort((a, b) => b[1] - a[1])[0];
  const lifts = new Map<string, { date: string; weight: number }[]>();
  for (const session of thisMonth) {
    for (const exercise of session.exercises) {
      if (exercise.cardio || exercise.weight === null) continue;
      const rows = lifts.get(exercise.name) ?? [];
      rows.push({ date: session.date, weight: exercise.weight });
      lifts.set(exercise.name, rows);
    }
  }
  const lift = [...lifts].sort((a, b) => b[1].length - a[1].length)[0];
  const weights = lift?.[1] ?? [];
  const initial = weights.length
    ? Math.max(...weights.filter((w) => w.date === weights[0]?.date).map((w) => w.weight))
    : null;
  const max = weights.length ? Math.max(...weights.map((w) => w.weight)) : null;
  const daily = (type: string, field: string, count: number, dateField = "ts", divisor = 1) => {
    const rows = records(type, dateField);
    const totals = dailyRecordTotals(rows, data.timeZone, field, dateField, divisor);
    return dates(count).map((date) => ({
      date,
      value: totals.get(date) ?? null,
      estimated: rows.some((r) => day(r[dateField]) === date && estimated(r)),
    }));
  };
  const activity = records("activity");
  const metrics = new Map<string, StoredRecord[]>();
  for (const row of records("metric").filter((r) => day(r.ts) >= from)) {
    const key = `${row.kind}:${row.unit}`;
    const rows = metrics.get(key) ?? [];
    rows.push(row);
    metrics.set(key, rows);
  }
  return {
    today: data.today,
    timeZone: data.timeZone,
    training: {
      week: thisWeek.length ? thisWeek.length : null,
      month: thisMonth.length ? thisMonth.length : null,
      previousMonth: lastMonth.length ? lastMonth.length : null,
      rule: data.rules.data.training ?? null,
      topPart: topPart ? { name: topPart[0], count: topPart[1] } : null,
      lift: lift
        ? {
            name: lift[0],
            max,
            initial,
            change:
              new Set(weights.map((w) => w.date)).size > 1 && max !== null && initial !== null
                ? max - initial
                : null,
          }
        : null,
      heatmap: Array.from({ length: 35 }, (_, i) => {
        const date = offset(monday, i - 28);
        const hits = sessions.filter((s) => s.date === date);
        return {
          date,
          future: date > data.today,
          sessions: hits.length ? hits.length : null,
          repetitions: hits.length ? hits.reduce((n, s) => n + s.repetitions, 0) : null,
          minutes: hits.some((s) => s.duration !== null)
            ? hits.reduce((n, s) => n + (s.duration ?? 0), 0)
            : null,
        };
      }),
      recent: sessions.filter((s) => s.date >= from).reverse(),
    },
    nutrition: {
      calories: daily("meal", "kcal", 7),
      protein: daily("meal", "protein_g", 7),
      target: data.rules.data.nutrition?.protein_g ?? null,
      meals: records("meal")
        .filter((r) => day(r.ts) >= from)
        .reverse()
        .map((r) => ({
          id: r.id,
          ts: r.ts,
          meal: String(r.meal),
          items: (r.items as { name: string }[]).map((item) => item.name).join("、"),
          kcal: typeof r.kcal === "number" ? r.kcal : null,
          protein: typeof r.protein_g === "number" ? r.protein_g : null,
          estimated: estimated(r),
        })),
    },
    sleep: daily("sleep", "duration_min", 14, "end", 60),
    steps: dates(14).map((date) => {
      const rows = activity.filter((r) => r.date === date && typeof r.steps === "number");
      return {
        date,
        value: rows.length ? Math.max(...rows.map((r) => Number(r.steps))) : null,
        estimated: rows.some(estimated),
      };
    }),
    metrics: [...metrics].map(([key, rows]) => ({
      key,
      kind: String(rows[0]?.kind),
      unit: String(rows[0]?.unit),
      points: rows.map((r) => ({
        id: r.id,
        ts: r.ts,
        date: day(r.ts),
        value: r.value as string | number,
        estimated: estimated(r),
      })),
    })),
    photos: records("photo")
      .reverse()
      .map((r) => ({
        id: r.id,
        date: day(r.ts),
        ts: r.ts,
        pose: r.pose as Pose,
        notes: typeof r.notes === "string" ? r.notes : null,
      })),
    goals: data.goals.filter((g) => g.area === "health"),
    next: (data.statuses.find((s) => s.file === "health/STATUS.md")?.data.next ?? []).filter(
      (item) => item.status === "todo" || item.status === "proposed",
    ),
  };
}
export type HealthPageData = ReturnType<typeof readHealthPage>;
