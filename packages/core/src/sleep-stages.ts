export const sleepStageNames = [
  "awake",
  "asleep_unspecified",
  "asleep_core",
  "asleep_deep",
  "asleep_rem",
  "in_bed",
] as const;
export type SleepStageName = (typeof sleepStageNames)[number];
export type SleepStage = { start: string; end: string; stage: SleepStageName };

/** Optional historical detail: absent or malformed stages never fabricate a timeline. */
export function validSleepStages(value: unknown, start: unknown, end: unknown): value is SleepStage[] {
  if (!Array.isArray(value)) return false;
  const from = Date.parse(String(start));
  const until = Date.parse(String(end));
  return (
    Number.isFinite(from) &&
    Number.isFinite(until) &&
    until >= from &&
    value.every(
      (item) =>
        item &&
        typeof item.start === "string" &&
        typeof item.end === "string" &&
        sleepStageNames.includes(item.stage) &&
        Date.parse(item.start) >= from &&
        Date.parse(item.end) <= until &&
        Date.parse(item.end) > Date.parse(item.start),
    )
  );
}

/** Preserve the asleep union. Conflicting named stages remain unspecified, never guessed. */
export function sleepStageTimeline(stages: SleepStage[]): SleepStage[] {
  const events = new Map<number, [SleepStageName, number][]>();
  for (const item of stages) {
    for (const [at, delta] of [
      [Date.parse(item.start), 1],
      [Date.parse(item.end), -1],
    ] as const) {
      const changes = events.get(at) ?? [];
      changes.push([item.stage, delta]);
      events.set(at, changes);
    }
  }
  const counts = new Map<SleepStageName, number>();
  const result: SleepStage[] = [];
  const times = [...events.keys()].sort((a, b) => a - b);
  for (let i = 0; i + 1 < times.length; i++) {
    const at = times[i] as number;
    for (const [stage, delta] of events.get(at) ?? []) counts.set(stage, (counts.get(stage) ?? 0) + delta);
    const active = (stage: SleepStageName) => (counts.get(stage) ?? 0) > 0;
    const named = (["asleep_core", "asleep_deep", "asleep_rem"] as const).filter(active);
    const stage =
      named.length === 1
        ? named[0]
        : named.length || active("asleep_unspecified")
          ? "asleep_unspecified"
          : active("awake")
            ? "awake"
            : active("in_bed")
              ? "in_bed"
              : undefined;
    if (!stage) continue;
    const start = new Date(at).toISOString();
    const end = new Date(times[i + 1] as number).toISOString();
    const previous = result.at(-1);
    if (previous?.stage === stage && previous.end === start) previous.end = end;
    else result.push({ start, end, stage });
  }
  return result;
}

export function sleepStageMinutes(stages: SleepStage[]) {
  const totals = Object.fromEntries(sleepStageNames.map((name) => [name, 0])) as Record<
    SleepStageName,
    number
  >;
  for (const item of stages) totals[item.stage] += (Date.parse(item.end) - Date.parse(item.start)) / 60000;
  return totals;
}
