import { KaituError } from "./errors.js";
import { snapshot } from "./history.js";
import { listRecordTypes } from "./modules.js";
import type { Experience } from "./places.js";
import {
  commitRecordTransaction,
  pendingRecordTransactions,
  recoverRecordTransaction,
} from "./record-transaction.js";
import {
  type By,
  type StoredRecord,
  addRecords,
  readRecordRevisions,
  readRecords,
  updateRecord,
} from "./records.js";
import { isoInZone } from "./time.js";
import type { Workspace } from "./workspace.js";

interface Item {
  id: string;
  revision: number;
}
interface Withdrawn extends Item {
  restore_revision: number;
}
interface Batch {
  id: string;
  ts: string;
  by: string;
  rev?: number;
  state: "committed" | "undone";
  parser: string;
  input_count: number;
  duplicate_count: number;
  excluded_count: number;
  items: Item[];
  withdrawn: Withdrawn[];
  updated_at: string;
}
interface Policy {
  id: string;
  rev?: number;
  locator: string;
  excluded: boolean;
}
export const isExperienceControlType = (type: string) =>
  ["experience_source", "experience_batch"].includes(type);
const supported = (ws: Workspace, type: string) => listRecordTypes(ws).some((r) => r.type === type);
function batches(ws: Workspace): Batch[] {
  return supported(ws, "experience_batch")
    ? (committedRecords(ws, "experience_batch") as unknown as Batch[])
    : [];
}
function policies(ws: Workspace): Policy[] {
  return supported(ws, "experience_source")
    ? (readRecords(ws, "experience_source") as unknown as Policy[])
    : [];
}
export function experienceSourceKey(locator: string): string {
  if (typeof locator !== "string" || !locator.trim()) throw new KaituError("请提供来源", "BAD_ARGS");
  const value = locator.trim();
  if (/^https?:\/\//i.test(value)) {
    const url = new URL(value);
    if (url.username || url.password) throw new KaituError("来源链接不能含登录信息", "BAD_ARGS");
    url.hash = "";
    return url.href;
  }
  return value.replace(/(?::L?\d+(?:-L?\d+)?|#.*)$/, "");
}
export function excludedExperienceSources(ws: Workspace): Set<string> {
  return new Set(
    policies(ws)
      .filter((p) => p.excluded)
      .map((p) => p.locator),
  );
}
export function pendingExperienceImports(ws: Workspace) {
  return pendingRecordTransactions(ws).filter((plan) =>
    plan.entries.some((e) => e.type === "experience_batch"),
  );
}
export async function recoverExperienceImports(ws: Workspace) {
  const recovered = [];
  for (const plan of pendingExperienceImports(ws))
    recovered.push(await recoverRecordTransaction(ws, plan.id));
  return recovered;
}
function committedRevisions(ws: Workspace, type: string): StoredRecord[] {
  if (!supported(ws, type)) return [];
  const pending = new Set(
    pendingExperienceImports(ws).flatMap((plan) =>
      plan.entries
        .filter((entry) => entry.type === type)
        .map(({ record }) => `${record.id}:${record.rev ?? 1}`),
    ),
  );
  return readRecordRevisions(ws, type).filter((record) => !pending.has(`${record.id}:${record.rev ?? 1}`));
}
export const committedExperienceRevisions = (ws: Workspace) => committedRevisions(ws, "experience");
function committedRecords(ws: Workspace, type: string): StoredRecord[] {
  const latest = new Map<string, StoredRecord>();
  for (const row of committedRevisions(ws, type)) {
    const previous = latest.get(row.id);
    if (!previous || (row.rev ?? 1) >= (previous.rev ?? 1)) latest.set(row.id, row);
  }
  return [...latest.values()].filter((row) => !row.deleted);
}
export const committedExperiences = (ws: Workspace) =>
  committedRecords(ws, "experience") as unknown as Experience[];
export async function commitExperienceImport(
  ws: Workspace,
  entries: StoredRecord[],
  counts: { input_count: number; duplicate_count: number; excluded_count: number },
  by: By,
) {
  if (!entries.length) return { batch_id: null, version: null };
  const now = isoInZone(new Date(), ws.timeZone());
  const batch = addRecords(
    ws,
    "experience_batch",
    [
      {
        state: "committed",
        parser: "city-experiences-v1",
        ...counts,
        items: entries.map((record) => ({ id: record.id, revision: record.rev ?? 1 })),
        withdrawn: [],
        updated_at: now,
      },
    ],
    { by, dryRun: true },
  )[0]?.record;
  if (!batch) throw new KaituError("导入批次无法建立", "BAD_ARGS");
  const result = await commitRecordTransaction(
    ws,
    [
      ...entries.map((record) => ({ type: "experience", record })),
      { type: "experience_batch", record: batch },
    ],
    `${by === "user" ? "你" : "Agent"}记录了 ${entries.length} 条地点经历`,
  );
  return { batch_id: batch.id, version: result.version };
}
export async function setExperienceSource(
  ws: Workspace,
  locator: string,
  excluded: boolean,
  expectedRevision: number,
) {
  await recoverExperienceImports(ws);
  const key = experienceSourceKey(locator);
  const policy = policies(ws).find((p) => p.locator === key);
  if ((policy?.rev ?? (policy ? 1 : 0)) !== expectedRevision)
    throw new KaituError("来源设置已更新，请重新读取", "CONFLICT");
  if (policy?.excluded === excluded) return { version: null };
  const updated_at = isoInZone(new Date(), ws.timeZone());
  if (policy) updateRecord(ws, "experience_source", policy.id, { excluded, updated_at }, { by: "user" });
  else addRecords(ws, "experience_source", [{ locator: key, excluded, updated_at }], { by: "user" });
  return { version: await snapshot(ws, excluded ? "你排除了一份足迹来源" : "你重新启用了一份足迹来源") };
}
function latestExperiences(ws: Workspace, committed = false) {
  const all = committed ? committedExperienceRevisions(ws) : readRecordRevisions(ws, "experience");
  const latest = new Map<string, StoredRecord>();
  const original = new Map<string, StoredRecord>();
  const revisions = new Map<string, StoredRecord>();
  for (const record of all) {
    revisions.set(`${record.id}:${record.rev ?? 1}`, record);
    if (!record.deleted && !original.has(record.id)) original.set(record.id, record);
    const old = latest.get(record.id);
    if (!old || (record.rev ?? 1) >= (old.rev ?? 1)) latest.set(record.id, record);
  }
  return { all, latest, original, revisions };
}
export function previewExperienceBatch(ws: Workspace, id: string, operation: "undo" | "restore") {
  if (!["undo", "restore"].includes(operation)) throw new KaituError("未知的导入操作", "BAD_ARGS");
  const batch = batches(ws).find((b) => b.id === id);
  if (!batch) throw new KaituError("找不到这次导入", "NOT_FOUND");
  const { original: originals, latest } = latestExperiences(ws);
  const targets = operation === "undo" ? batch.items : batch.withdrawn;
  const affected: { id: string; title: string; source: string; revision: number }[] = [];
  const preserved: { id: string; title: string; reason: string }[] = [];
  for (const item of targets) {
    const row = latest.get(item.id);
    const original = originals.get(item.id);
    const title = String((row && !row.deleted ? row.title : original?.title) || original?.source || item.id);
    const eligible =
      row && (row.rev ?? 1) === item.revision && (operation === "undo" ? !row.deleted : row.deleted);
    if (eligible)
      affected.push({ id: item.id, title, source: String(original?.source ?? ""), revision: item.revision });
    else
      preserved.push({
        id: item.id,
        title,
        reason: row?.deleted ? "已经隐藏，保留当前状态" : "后续已有修改，保留当前资料",
      });
  }
  return { id: batch.id, revision: batch.rev ?? 1, state: batch.state, operation, affected, preserved };
}
export async function changeExperienceBatch(
  ws: Workspace,
  id: string,
  operation: "undo" | "restore",
  expectedRevision: number,
) {
  if (!["undo", "restore"].includes(operation)) throw new KaituError("未知的导入操作", "BAD_ARGS");
  await recoverExperienceImports(ws);
  const batch = batches(ws).find((b) => b.id === id);
  if (!batch) throw new KaituError("找不到这次导入", "NOT_FOUND");
  const target = operation === "undo" ? "undone" : "committed";
  if (batch.state === target) return { affected: 0, preserved: 0, version: null };
  if ((batch.rev ?? 1) !== expectedRevision)
    throw new KaituError("导入状态已更新，请重新查看影响范围", "CONFLICT");
  const preview = previewExperienceBatch(ws, id, operation);
  const { revisions } = latestExperiences(ws);
  const restorePoints = new Map(batch.withdrawn.map((item) => [item.id, item.restore_revision]));
  const now = isoInZone(new Date(), ws.timeZone());
  const withdrawn: Withdrawn[] = [];
  const items = batch.items.map((item) => ({ ...item }));
  const entries = preview.affected.map((item) => {
    let record: StoredRecord;
    if (operation === "undo") {
      record = { id: item.id, ts: now, by: "user", rev: item.revision + 1, deleted: true };
      withdrawn.push({ id: item.id, revision: record.rev as number, restore_revision: item.revision });
    } else {
      const original = revisions.get(`${item.id}:${restorePoints.get(item.id)}`);
      if (!original || original.deleted) throw new KaituError("找不到撤销前的经历", "CORRUPT");
      record = { ...original, by: "user", rev: item.revision + 1 };
      const active = items.find((entry) => entry.id === item.id);
      if (active) active.revision = record.rev as number;
    }
    return { type: "experience", record };
  });
  const current = readRecords(ws, "experience_batch").find((b) => b.id === batch.id) as StoredRecord;
  entries.push({
    type: "experience_batch",
    record: {
      ...current,
      state: target,
      items,
      withdrawn,
      rev: (batch.rev ?? 1) + 1,
      by: "user",
      updated_at: now,
    },
  });
  const result = await commitRecordTransaction(
    ws,
    entries,
    operation === "undo" ? "你撤销了一次足迹导入" : "你恢复了一次足迹导入",
  );
  return { affected: preview.affected.length, preserved: preview.preserved.length, version: result.version };
}
export function readExperienceImports(ws: Workspace) {
  const { original: originals, latest } = latestExperiences(ws, true);
  const sources = new Map<
    string,
    { locator: string; active: number; hidden: number; excluded: boolean; revision: number }
  >();
  for (const row of originals.values()) {
    const locator = experienceSourceKey(String(row.source));
    if (!sources.has(locator))
      sources.set(locator, { locator, active: 0, hidden: 0, excluded: false, revision: 0 });
  }
  for (const row of latest.values()) {
    const original = originals.get(row.id) as unknown as Experience | undefined;
    if (!original) continue;
    const source = sources.get(experienceSourceKey(original.source));
    if (source) {
      if (row.deleted) source.hidden++;
      else source.active++;
    }
  }
  for (const policy of policies(ws)) {
    const source = sources.get(policy.locator) ?? {
      locator: policy.locator,
      active: 0,
      hidden: 0,
      excluded: false,
      revision: 0,
    };
    source.excluded = policy.excluded;
    source.revision = policy.rev ?? 1;
    sources.set(policy.locator, source);
  }
  return {
    sources: [...sources.values()].sort((a, b) => a.locator.localeCompare(b.locator)),
    batches: batches(ws)
      .sort((a, b) => b.ts.localeCompare(a.ts) || b.id.localeCompare(a.id))
      .map((batch) => ({
        id: batch.id,
        ts: batch.ts,
        by: batch.by,
        revision: batch.rev ?? 1,
        state: batch.state,
        added: batch.items.length,
        duplicates: batch.duplicate_count,
        excluded: batch.excluded_count,
        sources: [
          ...new Set(
            batch.items
              .map((i) => originals.get(i.id)?.source as string)
              .filter(Boolean)
              .map(experienceSourceKey),
          ),
        ],
      })),
    pending: pendingExperienceImports(ws).map(({ id, message }) => ({ id, message })),
  };
}
export type ExperienceImportsData = ReturnType<typeof readExperienceImports>;
export type ExperienceBatchPreview = ReturnType<typeof previewExperienceBatch>;
