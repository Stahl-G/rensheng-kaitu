// Only complete Gregorian dates are ordered; unknown or fictional calendars stay unknown.
export function dateValue(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value ? time : null;
}
export function novelTimeCheck(input: { before?: string; after?: string; birth?: string; at?: string }) {
  if (input.birth !== undefined) {
    const birth = dateValue(input.birth);
    const at = dateValue(input.at ?? "");
    if (birth === null || at === null || at < birth)
      return { type: "information_missing", error: "需要完整公历生日和有效事件日期" };
    const date = input.at as string;
    const age =
      Number(date.slice(0, 4)) -
      Number(input.birth.slice(0, 4)) -
      (date.slice(5) < input.birth.slice(5) ? 1 : 0);
    return { type: "calculated", age, algorithm: "公历周岁，比较月日", version: "1.0.0" };
  }
  const before = dateValue(input.before ?? "");
  const after = dateValue(input.after ?? "");
  if (before === null || after === null)
    return { type: "information_missing", error: "需要两项完整公历日期；虚构历法暂留待确认" };
  return {
    type: after < before ? "hard_rule_conflict" : "calculated",
    days: (after - before) / 86400000,
    algorithm: "UTC 公历日期差 / 86400000",
    version: "1.0.0",
  };
}
