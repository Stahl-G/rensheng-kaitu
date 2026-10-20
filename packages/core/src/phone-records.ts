import {
  commitRecordTransaction,
  pendingRecordTransactions,
  recoverRecordTransaction,
} from "./record-transaction.js";
import type { StoredRecord } from "./records.js";
import type { Workspace } from "./workspace.js";

const ledgerFile = ".kaitu/phone-records.json";
export interface PhoneRecordPlan {
  entries: { type: string; record: StoredRecord }[];
  receipt: { agent: string; records: { type: string; id: string }[] };
  replaces?: string;
  consumed?: true;
}
export function phoneRecordLedger(ws: Workspace): Record<string, PhoneRecordPlan> {
  return ws.exists(ledgerFile) ? ws.readJson(ledgerFile) : {};
}
export function preparePhoneRecords(ws: Workspace, ref: string, plan: PhoneRecordPlan) {
  const ledger = phoneRecordLedger(ws);
  ledger[ref] ??= plan;
  ws.writeJson(ledgerFile, ledger, { internal: true, mode: 0o600 });
}
export async function recoverPhoneRecords(
  ws: Workspace,
  finish: (ref: string, plan: PhoneRecordPlan) => void,
) {
  const ledger = phoneRecordLedger(ws);
  for (const [ref, plan] of Object.entries(ledger)) {
    if (plan.consumed) continue;
    const pending = pendingRecordTransactions(ws).filter(
      (transaction) => JSON.stringify(transaction.entries) === JSON.stringify(plan.entries),
    );
    if (pending.length) {
      for (const transaction of pending) await recoverRecordTransaction(ws, transaction.id);
    } else await commitRecordTransaction(ws, plan.entries, `手机记录：${ref}`);
    finish(ref, plan);
    // 只有记录和替换来源账本都完成才计入覆盖；保留旧 ref，不随回执过期删除。
    plan.consumed = true;
    ws.writeJson(ledgerFile, ledger, { internal: true, mode: 0o600 });
  }
}
