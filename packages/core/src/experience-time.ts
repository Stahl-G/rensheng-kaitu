/** 浏览器与本机投影共用的日期语义，不补造未知时间。 */
export interface TimedExperience {
  fact_status: string;
  event_type: string;
  time_precision: string;
  start?: string;
  end?: string;
}
export function partialDateBounds(value?: string): { from: string; to: string } | null {
  if (!value || !/^\d{4}(?:-\d{2}(?:-\d{2})?)?$/.test(value)) return null;
  const [year, month, day] = value.split("-");
  if (!month) return { from: `${year}-01-01`, to: `${year}-12-31` };
  if (day) return { from: value, to: value };
  const y = Number(year);
  const days = [
    31,
    y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0) ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  return { from: `${value}-01`, to: `${value}-${days[Number(month) - 1]}` };
}
export function experienceInterval(item: TimedExperience): { from: string; to: string | null } | null {
  if (item.time_precision === "unknown") return null;
  const knownDate = (value?: string) =>
    item.time_precision === "year"
      ? value?.slice(0, 4)
      : item.time_precision === "month"
        ? value?.slice(0, 7)
        : value;
  const start = partialDateBounds(knownDate(item.start));
  const end = partialDateBounds(knownDate(item.end));
  const first = start ?? end;
  if (!first) return null;
  const ongoing = ["lived", "worked"].includes(item.event_type) && !!start && !end;
  return { from: first.from, to: ongoing ? null : (end ?? first).to };
}
export function experienceLayer(item: TimedExperience, asOf: string): "been" | "now" | "planned" | null {
  if (["planned", "suggested"].includes(item.fact_status)) return "planned";
  if (!["observed", "user_reported"].includes(item.fact_status)) return null;
  const interval = experienceInterval(item);
  if (interval && interval.from > asOf) return null;
  return interval && ["lived", "worked"].includes(item.event_type) && (!interval.to || interval.to >= asOf)
    ? "now"
    : "been";
}
export function experienceOverlaps(item: TimedExperience, from?: string, to?: string): boolean {
  if (from && to && from > to) return false;
  const interval = experienceInterval(item);
  if (!interval) return false;
  return (!to || interval.from <= to) && (!from || !interval.to || interval.to >= from);
}
export function experienceYears(items: TimedExperience[], asOf: string): string[] {
  const years = new Set<string>();
  for (const item of items) {
    const interval = experienceInterval(item);
    if (!interval) continue;
    const first = Number(interval.from.slice(0, 4));
    const last = Number((interval.to ?? asOf).slice(0, 4));
    for (let year = first; year <= last; year++) years.add(String(year).padStart(4, "0"));
  }
  return [...years].sort().reverse();
}
