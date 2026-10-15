import type { StoredRecord } from "./records.js";
import { localDate, parseTs } from "./time.js";
import { type WorkbenchData, readWorkbench } from "./workbench.js";
import type { Workspace } from "./workspace.js";

/** 同一天同一 session_id 算一次训练。 */
export function workoutSessions(rows: StoredRecord[], timeZone: string): StoredRecord[][] {
  const groups = new Map<string, StoredRecord[]>();
  for (const row of rows) {
    const key = `${localDate(parseTs(String(row.ts)), timeZone)}:${row.session_id ?? row.id}`;
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  return [...groups.values()];
}

export function dailyRecordTotals(
  rows: StoredRecord[],
  timeZone: string,
  field: string,
  dateField = "ts",
  divisor = 1,
) {
  const totals = new Map<string, number>();
  for (const row of rows) {
    const value = row[field];
    if (typeof value !== "number") continue;
    const date = localDate(parseTs(String(row[dateField])), timeZone);
    totals.set(date, (totals.get(date) ?? 0) + value / divisor);
  }
  return totals;
}

export function readStatus(ws: Workspace, now = new Date(), publicOnly = false) {
  const data = readWorkbench(ws, now, publicOnly);
  return summarizeStatus(data);
}

export function summarizeStatus(data: WorkbenchData) {
  const from = new Date(Date.parse(`${data.today}T12:00:00Z`) - 6 * 86400000).toISOString().slice(0, 10);
  const day = (ts: unknown) => localDate(parseTs(String(ts)), data.timeZone);
  const recent = (type: string, field = "ts") =>
    (data.records[type] ?? []).filter((row) => day(row[field]) >= from && day(row[field]) <= data.today);
  const averageDaily = (type: string, field: string, dateField = "ts", divisor = 1) => {
    const totals = dailyRecordTotals(recent(type, dateField), data.timeZone, field, dateField, divisor);
    return totals.size ? [...totals.values()].reduce((a, b) => a + b, 0) / totals.size : null;
  };
  const blocks = data.now.data.date === data.today ? data.now.data.blocks : [];
  return {
    today: data.today,
    inboxNotes: data.inboxNotes,
    tasks: data.tasks,
    now: {
      date: data.now.data.date,
      blocks,
      pending: blocks.filter((b) => b.kind === "proposal" && b.status === "pending").length,
    },
    modules: data.statuses.map(({ file, module, data }) => ({ file, module, ...data })),
    projects: data.projects,
    recent7: {
      from,
      to: data.today,
      workouts: workoutSessions(recent("workout"), data.timeZone).length,
      averageSleepHours: averageDaily("sleep", "duration_min", "end", 60),
      averageProteinG: averageDaily("meal", "protein_g"),
      latestWeight:
        (data.records.metric ?? []).filter((r) => r.kind === "weight" && day(r.ts) <= data.today).at(-1) ??
        null,
    },
    warnings: data.warnings,
  };
}
