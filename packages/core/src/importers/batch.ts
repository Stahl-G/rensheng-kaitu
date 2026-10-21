import { isDeepStrictEqual } from "node:util";
import { KaituError } from "../errors.js";
import { snapshot } from "../history.js";
import {
  type StoredRecord,
  addRecords,
  deleteRecord,
  readRecordRevisions,
  updateRecord,
} from "../records.js";
import type { Workspace } from "../workspace.js";

export type ImportType =
  | "metric"
  | "sleep"
  | "activity"
  | "meal"
  | "event"
  | "workout"
  | "symptom"
  | "mood"
  | "heart_notification";
export interface Candidate {
  type: ImportType;
  data: Record<string, unknown>;
  key: string;
  activityTotals?: { basalKcal?: number };
}
export interface Counts {
  added: number;
  updated: number;
  deleted: number;
  skipped: number;
}
export interface BatchImportResult extends Counts {
  types: Partial<Record<ImportType, Counts>>;
  ignored: Record<string, number>;
  version: string | null;
}
export interface BatchOptions {
  dryRun?: boolean;
  message?: (changed: number) => string;
  ignored?: Record<string, number>;
  scope?: (record: StoredRecord) => boolean;
  deleteMissing?: (record: StoredRecord) => boolean;
  /** 不合法的单条只跳过并计入 ignored.invalid，其余照常导入（快捷指令这类逐条交来的数据）。 */
  skipInvalid?: boolean;
}

export function naturalKey(type: ImportType, data: Record<string, unknown>): string {
  switch (type) {
    case "workout":
      return JSON.stringify([new Date(String(data.ts)).toISOString(), data.exercise]);
    case "metric":
    case "symptom":
    case "heart_notification":
      return JSON.stringify([data.kind, new Date(String(data.ts)).toISOString()]);
    case "sleep":
      return new Date(String(data.start)).toISOString();
    case "activity":
      return String(data.date);
    case "meal":
    case "mood":
      return new Date(String(data.ts)).toISOString();
    case "event":
      return String(data.external_id);
  }
}

export function candidate(type: ImportType, data: Record<string, unknown>): Candidate {
  return { type, data, key: naturalKey(type, data) };
}

const genericWorkouts = new Set(["其他训练", "体能训练"]);

function content(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(record).filter(
      ([key, value]) => !["id", "rev", "by", "deleted"].includes(key) && value !== undefined,
    ),
  );
}

export async function importBatch(
  ws: Workspace,
  source: "apple-health" | "ics" | "nut-ai",
  candidates: Candidate[],
  opts: BatchOptions = {},
): Promise<BatchImportResult> {
  const by = `import:${source}` as const;
  const result: BatchImportResult = {
    added: 0,
    updated: 0,
    deleted: 0,
    skipped: 0,
    types: {},
    ignored: opts.ignored ?? {},
    version: null,
  };
  const groups = new Map<ImportType, Map<string, Candidate>>();
  for (const item of candidates) {
    const group = groups.get(item.type) ?? new Map<string, Candidate>();
    group.set(item.key, item);
    groups.set(item.type, group);
  }
  if (opts.deleteMissing && !groups.has("event")) groups.set("event", new Map());
  const check = (type: ImportType, items: Candidate[]) =>
    addRecords(
      ws,
      type,
      items.map((item) => item.data),
      { by, dryRun: true },
    );
  // 逐条交来的数据先挑出不合法的单条跳过，其余照常导入。
  let invalid = 0;
  const total = [...groups.values()].reduce((count, group) => count + group.size, 0);
  if (opts.skipInvalid)
    for (const [type, group] of groups) {
      try {
        check(type, [...group.values()]);
      } catch {
        for (const [key, item] of group) {
          try {
            check(type, [item]);
          } catch {
            group.delete(key);
            invalid++;
          }
        }
      }
    }
  if (invalid) {
    if (invalid === total)
      throw new KaituError(`没有能导入的样本：${invalid} 条不符合记录格式`, "INVALID_IMPORT");
    result.ignored = { ...result.ignored, invalid: (result.ignored.invalid ?? 0) + invalid };
  }
  const plans = [...groups].map(([type, group]) => {
    const revisions = readRecordRevisions(ws, type);
    const latest = new Map<string, StoredRecord>();
    for (const record of revisions) {
      const previous = latest.get(record.id);
      if (!previous || (record.rev ?? 1) >= (previous.rev ?? 1)) latest.set(record.id, record);
    }
    const records = [...latest.values()].filter(
      (record) => !record.deleted && record.by === by && (!opts.scope || opts.scope(record)),
    );
    const existing = new Map<string, StoredRecord>();
    // 运动名扩展前以通用名导入的训练，按开始时间找回；同一时刻有两条则不猜。
    const generic = new Map<string, string>();
    for (const record of revisions) {
      if (!record.deleted && record.by === by && (!opts.scope || opts.scope(record))) {
        existing.set(naturalKey(type, record), latest.get(record.id) as StoredRecord);
        if (type === "workout" && genericWorkouts.has(String(record.exercise))) {
          const at = new Date(record.ts).toISOString();
          generic.set(at, generic.has(at) && generic.get(at) !== record.id ? "" : record.id);
        }
      }
    }
    if (type === "workout") {
      const starts = new Set<string>();
      for (const item of group.values()) {
        const at = new Date(String(item.data.ts)).toISOString();
        if (starts.has(at)) generic.delete(at);
        starts.add(at);
      }
    }
    const added: Record<string, unknown>[] = [];
    const updated: { id: string; patch: Record<string, unknown> }[] = [];
    const counts: Counts = { added: 0, updated: 0, deleted: 0, skipped: 0 };
    for (const item of group.values()) {
      let known = existing.get(item.key);
      if (!known && type === "workout") {
        const at = new Date(String(item.data.ts)).toISOString();
        known = latest.get(generic.get(at) ?? "");
        generic.delete(at);
      }
      // 依据导入时的身份找到人工修订或删除的记录，旧来源不能覆盖或重新创建它。
      if (known && known.by !== by) {
        counts.skipped++;
        continue;
      }
      // 旧版手机仍发通用名时，不覆盖已经升级的具体运动名。
      if (
        known &&
        genericWorkouts.has(String(item.data.exercise)) &&
        !genericWorkouts.has(String(known.exercise))
      ) {
        counts.skipped++;
        continue;
      }
      const previous = known?.deleted ? undefined : known;
      if (
        type === "activity" &&
        previous?.source_exported_at &&
        item.data.source_exported_at &&
        Date.parse(String(item.data.source_exported_at)) < Date.parse(String(previous.source_exported_at))
      ) {
        counts.skipped++;
        continue;
      }
      let data = item.data;
      if (previous && item.activityTotals) {
        data = { ...content(previous), ...data };
        if (item.data.total_kcal !== undefined) {
          const basal =
            item.activityTotals.basalKcal ??
            Number(previous.total_kcal ?? 0) - Number(previous.active_kcal ?? 0);
          data.total_kcal = Number(data.active_kcal ?? 0) + basal;
        }
        group.set(item.key, { ...item, data });
      }
      if (!previous) added.push(data);
      else if (isDeepStrictEqual(content(previous), content(data))) counts.skipped++;
      else {
        const patch = Object.fromEntries(Object.keys(content(previous)).map((key) => [key, undefined]));
        updated.push({ id: previous.id, patch: { ...patch, ...data } });
      }
    }
    const deleted = opts.deleteMissing
      ? records.filter((r) => !group.has(naturalKey(type, r)) && opts.deleteMissing?.(r))
      : [];
    counts.added = added.length;
    counts.updated = updated.length;
    counts.deleted = deleted.length;
    result.types[type] = counts;
    for (const action of ["added", "updated", "deleted", "skipped"] as const)
      result[action] += counts[action];
    // 预览也使用记录写入层的同一份校验（含与旧记录合并后的结果），整批合法后才开始追加。
    try {
      check(type, [...group.values()]);
    } catch {
      throw new KaituError(`导入（${source}）包含不合法的 ${type} 记录`, "INVALID_IMPORT");
    }
    return { type, added, updated, deleted };
  });
  const changed = result.added + result.updated + result.deleted;
  if (opts.dryRun || !changed) return result;
  for (const plan of plans) {
    if (plan.added.length) addRecords(ws, plan.type, plan.added, { by });
    for (const item of plan.updated) updateRecord(ws, plan.type, item.id, item.patch, { by });
    for (const item of plan.deleted) deleteRecord(ws, plan.type, item.id, { by });
  }
  result.version = await snapshot(ws, opts.message?.(changed) ?? `导入（${source}）了 ${changed} 条记录`);
  return result;
}
