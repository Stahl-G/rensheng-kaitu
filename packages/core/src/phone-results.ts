import { isDeepStrictEqual } from "node:util";
import { normalizeDocument } from "./doc-input.js";
import { KaituError } from "./errors.js";
import { parseFrontmatter, stringifyFrontmatter } from "./frontmatter.js";
import type { PhoneReceipt } from "./phone-receipts.js";
import {
  type StoredRecord,
  appendPreparedRecords,
  readRecordRevisions,
  readRecords,
  validatePreparedRecords,
} from "./records.js";
import { schemas } from "./schema.js";
import { type ModuleStatus, statusFiles } from "./workbench.js";
import type { Workspace } from "./workspace.js";

type Args = {
  file?: string;
  id?: string;
  expected_rev?: number;
  expected_next?: object;
  result_text?: string;
  completion_id?: string;
};
type Action = { client_id: string; op: string; args: Args };
export interface PhoneResult {
  completion_id: string;
  id: string;
  file: string;
  title: string;
  text: string;
  completed_at: string;
  can_undo: boolean;
}
type TaskChange = { kind: "task"; before: StoredRecord; after: StoredRecord };
type StatusChange = {
  kind: "status";
  before: unknown;
  after: unknown;
  block: string;
  at: string;
  undo?: boolean;
  undoMarker?: string;
  restoreSingle?: boolean;
};
type Change = TaskChange | StatusChange;
type Completion = Omit<PhoneResult, "can_undo"> & { change: Change; undone?: boolean };
export type PhoneResultLedgerEntry = {
  status?: PhoneReceipt["status"];
  message?: string;
  resultAction?: { op: string; args: Args };
  nextResult?: Completion;
  nextUndo?: { completion_id: string; change: Change };
  result?: NonNullable<PhoneReceipt["result"]>;
};
const conflict = (message = "这一步已变化，请核对两端内容") => new KaituError(message, "CONFLICT");
function statusDocument(ws: Workspace, file: string, allowed?: ReadonlySet<string>) {
  if (!(allowed ? allowed.has(file) : statusFiles(ws).some((item) => item.file === file)))
    throw conflict("找不到下一步来源");
  const doc = parseFrontmatter<Record<string, unknown>>(ws.readText(file));
  const normalized = normalizeDocument("status.schema.json", doc.data) as ModuleStatus;
  if (!schemas().builtin("status.schema.json")(normalized))
    throw new KaituError("文档格式不合法", "INVALID_DOCUMENT");
  const entries = new Map(
    (normalized.next ?? []).map((item, index) => [
      item.id,
      { index, item, raw: Array.isArray(doc.data.next) ? doc.data.next[index] : doc.data.next },
    ]),
  );
  return {
    ...doc,
    entries,
    owners: undefined as Map<string, { position: number; owner?: string }> | undefined,
  };
}
function itemIn(doc: ReturnType<typeof statusDocument>, id: string) {
  return doc.entries.get(id);
}
function eventComment(event: Record<string, string>) {
  const json = JSON.stringify(event).replace(
    /[<>\u2028\u2029]/g,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
  return `<!-- ${json} -->`;
}
function statusOwner(doc: ReturnType<typeof statusDocument>, id: string) {
  if (!doc.owners) {
    const owners = new Map<string, { position: number; owner?: string }>();
    for (const match of doc.body.matchAll(/^<!-- (\{.*\}) -->$/gm)) {
      if (!match[1]) continue;
      try {
        const event = JSON.parse(match[1]);
        if (typeof event.id !== "string") continue;
        let owner: string;
        if (event.op === "complete_next_result" && typeof event.client_id === "string")
          owner = event.client_id;
        else if (event.op === "undo_next_result" && typeof event.completion_id === "string")
          owner = event.completion_id;
        else continue;
        owners.set(event.id, { position: match.index, owner });
      } catch {
        /* Other Markdown comments are not completion events. */
      }
    }
    // Legacy completions have no ownership comment; never undo their newer result with an older receipt.
    for (const match of doc.body.matchAll(/\n事项：([^\n]*)\n/g)) {
      if (!match[1]) continue;
      try {
        const key = decodeURIComponent(match[1]);
        if (match.index > (owners.get(key)?.position ?? -1)) owners.set(key, { position: match.index });
      } catch {
        /* A non-encoded prose line is not a completion target. */
      }
    }
    doc.owners = owners;
  }
  return doc.owners.get(id)?.owner;
}
function notes(text: string, result: string, at: string) {
  const previous = text.replace(/(?:^|\n)完成(?:结果|时间)：[^\n]*/g, "").trimEnd();
  return `${previous}\n完成结果：${result}\n完成时间：${at}\n`;
}
function prepare(ws: Workspace, action: Action): Completion {
  const { file, id, expected_rev, expected_next, result_text } = action.args;
  if (
    !file ||
    !id ||
    typeof result_text !== "string" ||
    Array.from(result_text).length > 2000 ||
    /[\r\n]/.test(result_text)
  )
    throw new KaituError("请用一句话记录结果", "BAD_ARGS");
  const at = new Date().toISOString();
  const text = result_text.trim();
  if (file === "task") {
    const before = readRecords(ws, "task").find((item) => item.id === id);
    if (!before || before.status !== "open" || (before.rev ?? 1) !== expected_rev) throw conflict();
    const after: StoredRecord = {
      ...before,
      status: "done",
      by: "user",
      rev: (before.rev ?? 1) + 1,
      notes: notes(String(before.notes ?? ""), text, at),
    };
    validatePreparedRecords(ws, [{ type: "task", record: after }]);
    return {
      completion_id: action.client_id,
      id,
      file,
      title: String(before.title),
      text,
      completed_at: at,
      change: { kind: "task", before, after },
    };
  }
  const doc = statusDocument(ws, file);
  const selected = itemIn(doc, id);
  const before = selected?.item;
  if (!before || before.status !== "todo" || !expected_next || !isDeepStrictEqual(before, expected_next))
    throw conflict();
  const after = { ...before, status: "done" as const };
  const block = `\n### 完成结果 · ${at}\n操作：${action.client_id}\n事项：${encodeURIComponent(id)}\n你完成了：${before.title.replace(/[\r\n]+/g, " ")}\n结果：${text}\n${eventComment({ op: "complete_next_result", client_id: action.client_id, id })}\n`;
  return {
    completion_id: action.client_id,
    id,
    file,
    title: before.title,
    text,
    completed_at: at,
    change: {
      kind: "status",
      before: selected?.raw,
      after,
      block,
      at,
      restoreSingle: !Array.isArray(doc.data.next),
    },
  };
}
function applyChange(ws: Workspace, completion: Completion, change: Change) {
  if (change.kind === "task") {
    const current = readRecords(ws, "task").find((item) => item.id === completion.id);
    if (
      isDeepStrictEqual(current, change.after) ||
      readRecordRevisions(ws, "task").some(
        (row) => row.id === completion.id && isDeepStrictEqual(row, change.after),
      )
    )
      return;
    if (!isDeepStrictEqual(current, change.before)) throw conflict();
    appendPreparedRecords(ws, [{ type: "task", record: change.after }]);
    return;
  }
  const doc = statusDocument(ws, completion.file);
  const selected = itemIn(doc, completion.id);
  const current = selected?.raw;
  const hasBlock = doc.body.includes(change.block);
  // Undo proof stays in the same atomic STATUS write, even if a later edit changes the item.
  if (!change.undo && hasBlock) return;
  if (change.undo && change.undoMarker && doc.body.includes(change.undoMarker) && !hasBlock) return;
  if (change.undo && statusOwner(doc, completion.id) !== completion.completion_id)
    throw conflict("此事项已有后续完成，未撤销更新结果");
  const alreadyRestored = change.undo && isDeepStrictEqual(current, change.after) && !hasBlock;
  if (!alreadyRestored && (!isDeepStrictEqual(current, change.before) || hasBlock !== !!change.undo))
    throw conflict();
  if (!selected) throw conflict();
  const next = Array.isArray(doc.data.next) ? [...doc.data.next] : [doc.data.next];
  next[selected.index] = change.after;
  doc.data.next = change.undo && change.restoreSingle && next.length === 1 ? next[0] : next;
  doc.body = change.undo
    ? hasBlock
      ? doc.body.replace(change.block, change.undoMarker ?? "")
      : doc.body + (change.undoMarker ?? "")
    : doc.body + change.block;
  doc.data.updated = change.at;
  if (!schemas().builtin("status.schema.json")(normalizeDocument("status.schema.json", doc.data)))
    throw new KaituError("状态文件格式不合法", "INVALID_DOCUMENT");
  ws.writeText(completion.file, stringifyFrontmatter(doc.data, doc.body));
}

function prepareUndo(ws: Workspace, completion: Completion, undoId: string): Change {
  const original = completion.change;
  if (original.kind === "task") {
    const current = readRecords(ws, "task").find((item) => item.id === completion.id);
    if (!isDeepStrictEqual(current, original.after)) throw conflict("完成后这条事项已修改，未撤销对端内容");
    const after: StoredRecord = { ...original.before, by: "user", rev: (original.after.rev ?? 1) + 1 };
    validatePreparedRecords(ws, [{ type: "task", record: after }]);
    return { kind: "task", before: original.after, after };
  }
  const doc = statusDocument(ws, completion.file);
  if (
    statusOwner(doc, completion.id) !== completion.completion_id ||
    !isDeepStrictEqual(itemIn(doc, completion.id)?.raw, original.after) ||
    !doc.body.includes(original.block)
  )
    throw conflict("完成后这条事项已修改，未撤销对端内容");
  return {
    kind: "status",
    before: original.after,
    after: original.before,
    block: original.block,
    at: new Date().toISOString(),
    undo: true,
    undoMarker: `\n${eventComment({ op: "undo_next_result", client_id: undoId, completion_id: completion.completion_id, id: completion.id })}\n`,
    restoreSingle: original.restoreSingle,
  };
}
/** Uses the existing phone action journal, not the desktop's process-local receipt map. */
export function applyPhoneResultAction(
  ws: Workspace,
  action: Action,
  ledger: Record<string, PhoneResultLedgerEntry>,
  persist: () => void,
): PhoneReceipt {
  const receipt: PhoneReceipt = {
    ref: action.client_id,
    kind: "action",
    status: "applied",
    at: new Date().toISOString(),
  };
  const existing = ledger[action.client_id];
  const identity = { op: action.op, args: action.args };
  if (
    (existing?.resultAction && !isDeepStrictEqual(existing.resultAction, identity)) ||
    (existing && !existing.resultAction)
  )
    return { ...receipt, status: "conflict", message: "这个 client_id 已绑定首次操作，请沿首次内容重试" };
  if (existing?.status) {
    const completed =
      existing.nextResult ?? (existing.nextUndo && ledger[existing.nextUndo.completion_id]?.nextResult);
    return {
      ...receipt,
      status: existing.status === "applied" ? "duplicate" : existing.status,
      ...(existing.message ? { message: existing.message } : {}),
      ...(existing.result
        ? { result: { ...existing.result, ...(completed?.undone ? { status: "undone" as const } : {}) } }
        : {}),
    };
  }
  const entry: PhoneResultLedgerEntry = existing ?? { resultAction: identity };
  try {
    if (action.op === "complete_next_result") {
      const completion = entry.nextResult ?? prepare(ws, action);
      if (!entry.nextResult) {
        entry.nextResult = completion;
        ledger[action.client_id] = entry;
        persist();
      }
      applyChange(ws, completion, completion.change);
      receipt.result = { completion_id: action.client_id, status: "completed" };
    } else if (action.op === "undo_next_result") {
      const parent = ledger[action.args.completion_id ?? ""];
      const completion = parent?.nextResult;
      if (!completion || parent?.status !== "applied") throw conflict("找不到已完成操作，请等待完成回执");
      if (!completion.undone) {
        const undo = entry.nextUndo ?? {
          completion_id: completion.completion_id,
          change: prepareUndo(ws, completion, action.client_id),
        };
        if (!entry.nextUndo) {
          entry.nextUndo = undo;
          ledger[action.client_id] = entry;
          persist();
        }
        applyChange(ws, completion, undo.change);
        completion.undone = true;
      } else receipt.status = "duplicate";
      receipt.result = { completion_id: completion.completion_id, status: "undone" };
    } else throw conflict("这个 client_id 已绑定结果操作");
  } catch (error) {
    // Filesystem/transport failures remain retryable with the original prepared plan.
    if (
      !(error instanceof KaituError) ||
      !["CONFLICT", "BAD_ARGS", "INVALID_DOCUMENT", "INVALID_RECORD"].includes(error.code)
    )
      throw error;
    receipt.status = "conflict";
    receipt.message = error.message;
  }
  Object.assign(entry, {
    status: receipt.status === "duplicate" ? "applied" : receipt.status,
    ...(receipt.message ? { message: receipt.message } : {}),
    ...(receipt.result ? { result: receipt.result } : {}),
  });
  ledger[action.client_id] = entry;
  persist();
  return receipt;
}
export function phoneResults(ws: Workspace): PhoneResult[] {
  if (!ws.exists(".kaitu/phone-actions.json")) return [];
  const ledger = ws.readJson<Record<string, PhoneResultLedgerEntry>>(".kaitu/phone-actions.json");
  let tasks: Map<string, StoredRecord> | undefined;
  let allowed: Set<string> | undefined;
  const documents = new Map<string, ReturnType<typeof statusDocument>>();
  const results: PhoneResult[] = [];
  for (const entry of Object.values(ledger)) {
    const value = entry.nextResult;
    if (entry.status !== "applied" || !value || value.undone) continue;
    let active = false;
    let canUndo = false;
    if (value.change.kind === "task") {
      tasks ??= new Map(readRecords(ws, "task").map((task) => [task.id, task]));
      const current = tasks.get(value.id);
      active =
        current?.status === "done" &&
        String(current.notes ?? "").includes(`\n完成结果：${value.text}\n完成时间：${value.completed_at}\n`);
      canUndo = isDeepStrictEqual(current, value.change.after);
    } else {
      allowed ??= new Set(statusFiles(ws).map((item) => item.file));
      if (!allowed.has(value.file)) continue;
      let doc = documents.get(value.file);
      if (!doc) {
        doc = statusDocument(ws, value.file, allowed);
        documents.set(value.file, doc);
      }
      active =
        statusOwner(doc, value.id) === value.completion_id &&
        itemIn(doc, value.id)?.item?.status === "done" &&
        doc.body.includes(value.change.block);
      canUndo = active && isDeepStrictEqual(itemIn(doc, value.id)?.raw, value.change.after);
    }
    if (active) {
      const { change: _change, undone: _undone, ...result } = value;
      results.push({ ...result, can_undo: canUndo });
    }
  }
  return results.sort(
    (a, b) => b.completed_at.localeCompare(a.completed_at) || a.completion_id.localeCompare(b.completion_id),
  );
}
