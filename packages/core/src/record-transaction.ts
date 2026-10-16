import { readdirSync, rmSync } from "node:fs";
import { KaituError } from "./errors.js";
import { snapshot } from "./history.js";
import { batchOverview } from "./overview.js";
import {
  type StoredRecord,
  appendPreparedRecords,
  readRecordRevisions,
  validatePreparedRecords,
} from "./records.js";
import { ulid } from "./ulid.js";
import type { Workspace } from "./workspace.js";

type Entry = { type: string; record: StoredRecord };
export interface Plan {
  id: string;
  message: string;
  entries: Entry[];
}
const directory = ".kaitu/record-transactions";
function file(id: string) {
  if (!/^[0-9A-HJKMNP-TV-Z]{26}$/.test(id)) throw new KaituError("无效的恢复作业", "BAD_ARGS");
  return `${directory}/${id}.json`;
}
export function pendingRecordTransactions(ws: Workspace): Plan[] {
  if (!ws.exists(directory)) return [];
  return readdirSync(ws.resolve(directory, { internal: true }))
    .filter((name) => /^[0-9A-HJKMNP-TV-Z]{26}\.json$/.test(name))
    .sort()
    .map((name) => ws.readJson<Plan>(`${directory}/${name}`));
}
function missingEntries(ws: Workspace, entries: Entry[]): Entry[] {
  validatePreparedRecords(ws, entries);
  const types = new Map<string, StoredRecord[]>();
  const identities = new Set<string>();
  return entries.filter(({ type, record }) => {
    const identity = `${type}:${record.id}`;
    if (identities.has(identity)) throw new KaituError("作业内有重复目标", "BAD_ARGS");
    identities.add(identity);
    let rows = types.get(type);
    if (!rows) {
      rows = readRecordRevisions(ws, type);
      types.set(type, rows);
    }
    const revisions = rows.filter((row) => row.id === record.id);
    const same = revisions.find((row) => (row.rev ?? 1) === (record.rev ?? 1));
    if (same) {
      if (JSON.stringify(same) !== JSON.stringify(record))
        throw new KaituError("恢复作业的目标已有不同内容，请检查资料", "CONFLICT");
      return false;
    }
    const latest = Math.max(0, ...revisions.map((row) => row.rev ?? 1));
    if (latest !== (record.rev ?? 1) - 1)
      throw new KaituError("恢复作业的目标已经更新，未覆盖新资料", "CONFLICT");
    return true;
  });
}
export async function recoverRecordTransaction(ws: Workspace, id: string) {
  const path = file(id);
  const plan = ws.readJson<Plan>(path);
  if (plan.id !== id || !Array.isArray(plan.entries)) throw new KaituError("恢复作业不完整", "CORRUPT");
  const missing = missingEntries(ws, plan.entries);
  return batchOverview(ws, async () => {
    appendPreparedRecords(ws, missing);
    const version = await snapshot(ws, plan.message);
    rmSync(ws.resolve(path, { internal: true }));
    return { id, version };
  });
}
/** 恢复日志先原子落盘，跨文件追加中断后仅补尚未写入的修订，不重放已写入的记录。 */
export async function commitRecordTransaction(ws: Workspace, entries: Entry[], message: string) {
  missingEntries(ws, entries);
  const id = ulid();
  ws.writeJson(file(id), { id, message, entries } satisfies Plan, { internal: true, mode: 0o600 });
  return recoverRecordTransaction(ws, id);
}
