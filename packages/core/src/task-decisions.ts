import { isDeepStrictEqual } from "node:util";
import { KaituError } from "./errors.js";
import { type PhoneReceipt, phoneReceipts, writePhoneReceipts } from "./phone-receipts.js";
import {
  type StoredRecord,
  appendPreparedRecords,
  readRecordRevisionsWithFiles,
  validatePreparedRecords,
} from "./records.js";
import { schemas } from "./schema.js";
import { stateBinding } from "./state-binding.js";
import type { Workspace } from "./workspace.js";

export type TaskDecisionAction = {
  client_id: string;
  op: "decide_task" | "undo_task_decision";
  args:
    | {
        consumer_id: string;
        file: string;
        id: string;
        expected_rev: number;
        expected_source: string | null;
        decision: "adopted" | "dismissed";
      }
    | { consumer_id: string; decision_id: string };
};
export interface TaskDecision {
  decision_id: string;
  consumer_id: string;
  file: string;
  id: string;
  rev: number;
  source: string | null;
  title: string;
  status: "adopted" | "dismissed" | "undone";
  decided_at: string;
  can_undo: boolean;
}
type Change = { before: StoredRecord; after: StoredRecord };
type DecisionPlan = Omit<TaskDecision, "can_undo" | "status"> & {
  decision: "adopted" | "dismissed";
  change: Change;
  undone?: number;
};
export type TaskDecisionLedgerEntry = {
  status?: PhoneReceipt["status"];
  message?: string;
  taskDecisionAction?: TaskDecisionAction;
  taskDecision?: DecisionPlan;
  taskDecisionUndo?: { decision_id: string; change: Change };
  decision?: PhoneReceipt["decision"];
  target?: PhoneReceipt["target"];
};
const ledgerFile = ".kaitu/phone-actions.json";
const conflict = (message = "这条建议已更新，请刷新后再处理") => new KaituError(message, "CONFLICT");
export function taskDecisionContext(ws: Workspace): { consumer_id: string } {
  return { consumer_id: stateBinding(ws.root).id };
}
/** Actual readable source locations, not a reconstruction from timestamp/current timezone. */
export function taskDecisionFiles(
  ws: Workspace,
  onError?: (error: KaituError) => void,
): Map<string, string | null> {
  const files = new Map<string, string | null>();
  for (const { file, record } of readRecordRevisionsWithFiles(ws, "task", onError)) {
    if (!files.has(record.id)) files.set(record.id, file);
    else if (files.get(record.id) !== file) files.set(record.id, null);
  }
  return files;
}
function load(ws: Workspace): Record<string, TaskDecisionLedgerEntry> {
  return ws.exists(ledgerFile) ? ws.readJson(ledgerFile) : {};
}
function taskHistory(
  ws: Workspace,
  file: string,
  id: string,
  rows = readRecordRevisionsWithFiles(ws, "task").filter(({ record }) => record.id === id),
) {
  if (!rows.length || rows.some((row) => row.file !== file))
    throw conflict("建议来源已变化或有重复标识，未修改");
  const revisions = new Map<number, StoredRecord>();
  for (const { record } of rows) {
    const rev = record.rev ?? 1;
    const prior = revisions.get(rev);
    if (prior && !isDeepStrictEqual(prior, record)) throw conflict("建议有并发修订，请先核对资料");
    revisions.set(rev, record);
  }
  const current = revisions.get(Math.max(...revisions.keys()));
  return { revisions, current };
}
function applyChange(ws: Workspace, plan: DecisionPlan, change: Change) {
  const { current, revisions } = taskHistory(ws, plan.file, plan.id);
  // A historical exact revision proves this prepared write even after a later edit.
  const written = revisions.get(change.after.rev ?? 1);
  if (written) {
    if (!isDeepStrictEqual(written, change.after)) throw conflict();
    return;
  }
  if (!isDeepStrictEqual(current, change.before)) throw conflict();
  appendPreparedRecords(ws, [{ type: "task", record: change.after, file: plan.file }]);
  const confirmed = taskHistory(ws, plan.file, plan.id);
  if (!isDeepStrictEqual(confirmed.revisions.get(change.after.rev ?? 1), change.after)) throw conflict();
}
function prepare(ws: Workspace, action: TaskDecisionAction): DecisionPlan {
  const args = action.args;
  if (!("id" in args)) throw conflict();
  const { current } = taskHistory(ws, args.file, args.id);
  if (
    !current ||
    current.deleted ||
    current.status !== "proposed" ||
    (current.rev ?? 1) !== args.expected_rev ||
    (current.source ?? null) !== args.expected_source
  )
    throw conflict();
  const after: StoredRecord = {
    ...current,
    by: "user",
    status: args.decision === "adopted" ? "open" : "cancelled",
    rev: (current.rev ?? 1) + 1,
  };
  validatePreparedRecords(ws, [{ type: "task", record: after, file: args.file }]);
  return {
    decision_id: action.client_id,
    consumer_id: args.consumer_id,
    file: args.file,
    id: args.id,
    rev: after.rev ?? 1,
    source: args.expected_source,
    title: String(current.title),
    decision: args.decision,
    decided_at: new Date().toISOString(),
    change: { before: current, after },
  };
}
function decisionReceipt(plan: DecisionPlan): NonNullable<PhoneReceipt["decision"]> {
  return { decision_id: plan.decision_id, status: plan.undone ? "undone" : plan.decision };
}
/** Synchronous shared write boundary: durable prepared plan, task revision, terminal journal, receipt.
 * Mac calls this directly; phone inbox uses the same implementation and same client-id namespace.
 * Filesystem failures propagate and are retried with the unchanged client_id and payload. */
export function applyTaskDecision(ws: Workspace, input: TaskDecisionAction): PhoneReceipt {
  const action = { client_id: input.client_id, op: input.op, args: input.args };
  const validate = schemas().builtin("phone-action.schema.json");
  const receipt: PhoneReceipt = {
    ref: action.client_id,
    kind: "action",
    status: "applied",
    at: new Date().toISOString(),
  };
  if (!validate({ ...action, at: receipt.at, device: "00000000" }))
    return { ...receipt, status: "rejected", message: "建议操作格式不合法" };
  const ledger = load(ws);
  const existing = ledger[action.client_id];
  const persist = () => ws.writeJson(ledgerFile, ledger, { internal: true, mode: 0o600 });
  if (action.args.consumer_id !== taskDecisionContext(ws).consumer_id)
    return { ...receipt, status: "conflict", message: "工作区已变化，未修改建议" };
  if (
    (existing && !isDeepStrictEqual(existing.taskDecisionAction, action)) ||
    (!existing && phoneReceipts(ws).some((item) => item.kind === "action" && item.ref === action.client_id))
  )
    return { ...receipt, status: "conflict", message: "这个 client_id 已绑定首次操作，请沿首次内容重试" };
  if (existing?.status) {
    const plan =
      existing.taskDecision ??
      ledger["decision_id" in action.args ? action.args.decision_id : ""]?.taskDecision;
    const replay = {
      ...receipt,
      status: existing.status === "applied" ? ("duplicate" as const) : existing.status,
      ...(existing.message ? { message: existing.message } : {}),
      ...(existing.target ? { target: existing.target } : {}),
      ...(plan && existing.decision ? { decision: decisionReceipt(plan) } : {}),
    };
    writePhoneReceipts(ws, [replay]);
    return replay;
  }
  const entry: TaskDecisionLedgerEntry = existing ?? { taskDecisionAction: action };
  try {
    let plan: DecisionPlan;
    let change: Change;
    if (action.op === "decide_task") {
      if (!("id" in action.args)) throw conflict();
      if (!entry.taskDecision)
        for (const [id, other] of Object.entries(ledger)) {
          const pending = other.taskDecision;
          if (
            id !== action.client_id &&
            !other.status &&
            pending &&
            pending.consumer_id === action.args.consumer_id &&
            pending.file === action.args.file &&
            pending.id === action.args.id &&
            (pending.change.before.rev ?? 1) === action.args.expected_rev
          )
            throw conflict("这条建议有未完成操作，请沿原 client_id 重试并等待回执");
        }
      plan = entry.taskDecision ?? prepare(ws, action);
      if (!entry.taskDecision) {
        entry.taskDecision = plan;
        ledger[action.client_id] = entry;
        persist();
      }
      change = plan.change;
    } else {
      if (!("decision_id" in action.args)) throw conflict();
      const parent = ledger[action.args.decision_id];
      if (!parent?.taskDecision || parent.status !== "applied")
        throw conflict("找不到已确认决策，请等待原操作回执");
      plan = parent.taskDecision;
      if (plan.consumer_id !== action.args.consumer_id) throw conflict("决策不属于此工作区");
      if (plan.undone) {
        receipt.status = "duplicate";
        change = plan.change;
      } else {
        if (!entry.taskDecisionUndo) {
          for (const [id, other] of Object.entries(ledger))
            if (
              id !== action.client_id &&
              !other.status &&
              other.taskDecisionUndo?.decision_id === plan.decision_id
            )
              throw conflict("这条决定有未完成撤销，请沿原 client_id 重试并等待回执");
          const { current } = taskHistory(ws, plan.file, plan.id);
          if (!isDeepStrictEqual(current, plan.change.after))
            throw conflict("处理后这条事项已修改，未撤销后续内容");
          const after = { ...plan.change.before, by: "user" as const, rev: plan.rev + 1 };
          validatePreparedRecords(ws, [{ type: "task", record: after, file: plan.file }]);
          entry.taskDecisionUndo = {
            decision_id: plan.decision_id,
            change: { before: plan.change.after, after },
          };
          ledger[action.client_id] = entry;
          persist();
        }
        change = entry.taskDecisionUndo.change;
      }
    }
    if (!(action.op === "undo_task_decision" && plan.undone)) applyChange(ws, plan, change);
    if (action.op === "undo_task_decision" && !plan.undone) plan.undone = change.after.rev ?? 1;
    receipt.decision = decisionReceipt(plan);
    receipt.target = {
      id: plan.id,
      rev: action.op === "undo_task_decision" ? (plan.undone ?? plan.rev) : (change.after.rev ?? 1),
    };
  } catch (error) {
    if (!(error instanceof KaituError) || !["CONFLICT", "BAD_ARGS", "INVALID_RECORD"].includes(error.code))
      throw error;
    receipt.status = "conflict";
    receipt.message = error.message;
  }
  Object.assign(entry, {
    status: receipt.status === "duplicate" ? "applied" : receipt.status,
    ...(receipt.message ? { message: receipt.message } : {}),
    ...(receipt.target ? { target: receipt.target } : {}),
    ...(receipt.decision ? { decision: receipt.decision } : {}),
  });
  ledger[action.client_id] = entry;
  persist();
  writePhoneReceipts(ws, [receipt]);
  return receipt;
}
/** Persistent decisions remain readable after leaving pending, including undone and superseded entries. */
export function taskDecisions(ws: Workspace): TaskDecision[] {
  const workspace = taskDecisionContext(ws).consumer_id;
  const entries = Object.values(load(ws));
  const rowsById = new Map<string, ReturnType<typeof readRecordRevisionsWithFiles>>();
  if (entries.some((entry) => entry.taskDecision))
    for (const row of readRecordRevisionsWithFiles(ws, "task")) {
      const group = rowsById.get(row.record.id) ?? [];
      group.push(row);
      rowsById.set(row.record.id, group);
    }
  return entries.flatMap((entry) => {
    const plan = entry.taskDecision;
    if (!plan || entry.status !== "applied" || plan.consumer_id !== workspace) return [];
    let canUndo = false;
    try {
      canUndo =
        !plan.undone &&
        isDeepStrictEqual(
          taskHistory(ws, plan.file, plan.id, rowsById.get(plan.id) ?? []).current,
          plan.change.after,
        );
    } catch (error) {
      if (!(error instanceof KaituError) || error.code !== "CONFLICT") throw error;
    }
    return [
      {
        decision_id: plan.decision_id,
        consumer_id: plan.consumer_id,
        file: plan.file,
        id: plan.id,
        rev: plan.rev,
        source: plan.source,
        title: plan.title,
        status: plan.undone ? ("undone" as const) : plan.decision,
        decided_at: plan.decided_at,
        can_undo: canUndo,
      },
    ];
  });
}
