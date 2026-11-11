import { isDeepStrictEqual } from "node:util";
import { normalizeStatus } from "./doc-input.js";
import { KaituError, readWarning } from "./errors.js";
import { parseFrontmatter, stringifyFrontmatter } from "./frontmatter.js";
import { snapshot } from "./history.js";
import { listRecordTypes } from "./modules.js";
import { commitRecordTransaction } from "./record-transaction.js";
import {
  type StoredRecord,
  prepareRecordRestoration,
  readRecordRevisions,
  readRecords,
  validatePreparedRecords,
} from "./records.js";
import { schemas } from "./schema.js";
import { localDate, parseTs } from "./time.js";
import { type WorkbenchData, statusFiles } from "./workbench.js";
import type { Workspace } from "./workspace.js";

export type ResultArgs = {
  file?: string;
  id: string;
  expected_rev?: number;
  prior_rev?: number;
  expected_next?: Record<string, unknown>;
  prior_next?: Record<string, unknown>;
  result_text?: string;
};
export type ResultOperation =
  | "complete_next_result"
  | "restore_task_revision"
  | "restore_next"
  | "adopt_task"
  | "cancel_task";
export interface ResultRequest {
  client_id: string;
  op: ResultOperation;
  args: ResultArgs;
}
type TaskChange = { kind: "task"; before: StoredRecord; after: StoredRecord };
type StatusChange = {
  kind: "status";
  file: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  at: string;
};
type Change = TaskChange | StatusChange;
export type ResultEffect =
  | { file: "task"; id: string; rev: number; prior_rev: number }
  | { file: string; id: string; expected_next: Record<string, unknown>; prior_next: Record<string, unknown> };
type Pending = {
  request: ResultRequest;
  at: string;
  change?: Change;
  status?: "applied" | "conflict";
  message?: string;
  code?: string;
  effect?: ResultEffect;
};
const journal = ".kaitu/result-actions";
const actionFile = (id: string) => `${journal}/${id}.json`;
const conflict = () =>
  new KaituError("内容已更新，请刷新后重试 / Content changed; refresh and retry", "CONFLICT");
const rev = (row: StoredRecord) => row.rev ?? 1;
export function hasResultAction(ws: Workspace, id: string): boolean {
  return /^[0-9A-HJKMNP-TV-Z]{26}$/.test(id) && ws.exists(actionFile(id));
}
function save(ws: Workspace, pending: Pending) {
  ws.writeJson(actionFile(pending.request.client_id), pending, { internal: true, mode: 0o600 });
}

/** New input is one line. Legacy stored text is never normalized or truncated. */
export function singleLineResult(text: string): string {
  if (typeof text !== "string" || /[\r\n\u2028\u2029]/u.test(text) || Array.from(text).length > 2000)
    throw new KaituError(
      "结果须为一行且不超过2000字，请保留草稿修改 / Keep the draft; use one line up to 2000 characters",
      "BAD_ARGS",
    );
  return text;
}

/** Last completion block, including historical literal/multiline notes. */
export function taskResult(notes: string): { text: string; at: string } | null {
  const marker = [...notes.matchAll(/(?:^|\n)完成结果：/g)].at(-1);
  if (!marker) return null;
  const block = notes.slice(marker.index + marker[0].length);
  const time = /\n完成时间：([^\r\n]*)/.exec(block);
  let text = time ? block.slice(0, time.index) : block;
  if (text.startsWith("\n")) {
    text = text.replace(/^\n\n?/, "").replace(/\n$/, "");
    text = text
      .split("\n")
      .map((line) => (line.startsWith("    ") ? line.slice(4) : line))
      .join("\n");
  }
  return { text, at: time?.[1] ?? "" };
}
function hasCompletionTime(at: string): boolean {
  try {
    return Number.isFinite(parseTs(at).getTime());
  } catch {
    return false;
  }
}

export function completionNotes(previous: string, text: string, at: string): string {
  singleLineResult(text);
  // Append rather than erase earlier multiline results or unrelated source notes.
  return `${previous}${previous && !previous.endsWith("\n") ? "\n" : ""}完成结果：${text}\n完成时间：${at}\n`;
}
function statusDocument(ws: Workspace, file: string) {
  if (!statusFiles(ws).some((entry) => entry.file === file)) throw conflict();
  const doc = parseFrontmatter<Record<string, unknown>>(ws.readText(file));
  const normalized = normalizeStatus(doc.data);
  if (!schemas().builtin("status.schema.json")(normalized)) throw conflict();
  return { ...doc, next: (normalized.next ?? []) as Record<string, unknown>[] };
}
function prepare(ws: Workspace, request: ResultRequest, at: string): Change {
  const { op, args } = request;
  if (
    !["complete_next_result", "restore_task_revision", "restore_next", "adopt_task", "cancel_task"].includes(
      op,
    )
  )
    throw new KaituError("不支持的操作 / Unsupported action", "BAD_ARGS");
  if (op === "restore_next" || (op === "complete_next_result" && args.file !== "task")) {
    if (!args.file || !args.expected_next) throw conflict();
    const before = statusDocument(ws, args.file).next.find((entry) => entry.id === args.id);
    if (!before || !isDeepStrictEqual(before, args.expected_next)) throw conflict();
    let after: Record<string, unknown>;
    if (op === "restore_next") {
      if (!args.prior_next || args.prior_next.id !== args.id) throw conflict();
      after = args.prior_next;
    } else {
      if (before.status !== "todo") throw conflict();
      after = {
        ...before,
        status: "done",
        result: singleLineResult(args.result_text as string),
        completed: at,
      };
    }
    return { kind: "status", file: args.file, before, after, at };
  }
  const before = readRecords(ws, "task").find((row) => row.id === args.id);
  if (!before || rev(before) !== args.expected_rev) throw conflict();
  let after: StoredRecord = { ...before, rev: rev(before) + 1, by: "user" };
  switch (op) {
    case "complete_next_result":
      if (before.status !== "open") throw conflict();
      after.status = "done";
      after.notes = completionNotes(String(before.notes ?? ""), args.result_text as string, at);
      break;
    case "adopt_task":
      if (before.status !== "proposed") throw conflict();
      after.status = "open";
      break;
    case "cancel_task":
      if (before.status !== "proposed" && before.status !== "open") throw conflict();
      after.status = "cancelled";
      break;
    case "restore_task_revision": {
      after = prepareRecordRestoration(
        ws,
        "task",
        args.id,
        args.expected_rev as number,
        args.prior_rev as number,
        "user",
      );
      break;
    }
  }
  validatePreparedRecords(ws, [{ type: "task", record: after }]);
  return { kind: "task", before, after };
}
function effect(change: Change): ResultEffect {
  return change.kind === "task"
    ? { file: "task", id: change.after.id, rev: rev(change.after), prior_rev: rev(change.before) }
    : {
        file: change.file,
        id: String(change.after.id),
        expected_next: change.after,
        prior_next: change.before,
      };
}

/** Existing user-intent entry point shared by desktop and phone, not a new authentication channel.
 * Persist request before planning and plan before I/O. Same ID binds the full original payload.
 */
export async function applyResultAction(ws: Workspace, request: ResultRequest, now = new Date()) {
  if (!/^[0-9A-HJKMNP-TV-Z]{26}$/.test(request.client_id))
    throw new KaituError("Invalid action ID", "BAD_ARGS");
  let pending = hasResultAction(ws, request.client_id)
    ? ws.readJson<Pending>(actionFile(request.client_id))
    : undefined;
  if (pending && !isDeepStrictEqual(pending.request, request)) throw conflict();
  if (pending?.status === "conflict")
    throw new KaituError(pending.message ?? "Conflict", pending.code ?? "CONFLICT");
  if (pending?.status === "applied")
    return { status: "duplicate" as const, effect: pending.effect as ResultEffect };
  if (!pending) {
    pending = { request, at: now.toISOString() };
    save(ws, pending);
  }
  try {
    if (!pending.change) {
      pending.change = prepare(ws, request, pending.at);
      save(ws, pending);
    }
    const change = pending.change;
    if (change.kind === "task") {
      await commitRecordTransaction(
        ws,
        [{ type: "task", record: change.after }],
        "你更新了下一步 / Updated next step",
      );
    } else {
      const doc = statusDocument(ws, change.file);
      const index = doc.next.findIndex((entry) => entry.id === change.before.id);
      const current = doc.next[index];
      if (!isDeepStrictEqual(current, change.after)) {
        if (!isDeepStrictEqual(current, change.before)) throw conflict();
        const raw = Array.isArray(doc.data.next) ? [...doc.data.next] : [doc.data.next];
        raw[index] = change.after;
        doc.data.next = raw;
        doc.data.updated = change.at;
        if (!schemas().builtin("status.schema.json")(normalizeStatus(doc.data))) throw conflict();
        ws.writeText(change.file, stringifyFrontmatter(doc.data, doc.body));
      }
      await snapshot(ws, "你更新了下一步 / Updated next step");
    }
    pending.status = "applied";
    pending.effect = effect(change);
    save(ws, pending);
    return { status: "applied" as const, effect: pending.effect };
  } catch (error) {
    if (
      error instanceof KaituError &&
      ["CONFLICT", "BAD_ARGS", "INVALID_RECORD", "INVALID_DOCUMENT"].includes(error.code)
    ) {
      pending.status = "conflict";
      pending.message = error.message;
      pending.code = error.code;
      save(ws, pending);
    }
    throw error;
  }
}

export interface ResultRow {
  id: string;
  file: string;
  title: string;
  text: string;
  completed_at: string;
  by: "user" | "agent" | "unknown";
  source?: string;
  rev?: number;
}
/** Active results, not a transport ledger or undo history. Ordinary later edits retain completion provenance. */
export function collectResults(
  ws: Workspace,
  loaded?: Pick<WorkbenchData, "records" | "statuses"> & Partial<Pick<WorkbenchData, "warnings">>,
): ResultRow[] {
  const hasTasks = loaded ? !!loaded.records.task : listRecordTypes(ws).some((ref) => ref.type === "task");
  let incompleteHistory = false;
  const rows = hasTasks
    ? readRecordRevisions(
        ws,
        "task",
        loaded
          ? {
              onError: (error) => {
                incompleteHistory = true;
                const warning = readWarning(error);
                if (
                  loaded.warnings &&
                  !loaded.warnings.some((item) => JSON.stringify(item) === JSON.stringify(warning))
                )
                  loaded.warnings.push(warning);
              },
            }
          : {},
      )
    : [];
  const revisions = new Map<string, StoredRecord[]>();
  for (const row of rows) {
    const own = revisions.get(row.id) ?? [];
    own.push(row);
    revisions.set(row.id, own);
  }
  const results: ResultRow[] = [];
  for (const task of loaded?.records.task ?? (hasTasks ? readRecords(ws, "task") : [])) {
    const result = taskResult(String(task.notes ?? ""));
    if (task.status !== "done" || !result?.text.trim()) continue;
    const at = result.at;
    if (!hasCompletionTime(at)) continue;
    const history = (revisions.get(task.id) ?? [task]).sort((a, b) => rev(b) - rev(a));
    let completion = task;
    for (const previous of history) {
      if (
        previous.deleted ||
        previous.status !== "done" ||
        !isDeepStrictEqual(taskResult(String(previous.notes ?? "")), result)
      )
        break;
      completion = previous;
    }
    results.push({
      id: task.id,
      file: "task",
      title: String(task.title),
      text: result.text,
      completed_at: at,
      by: incompleteHistory ? "unknown" : completion.by === "user" ? "user" : "agent",
      rev: rev(task),
      ...(typeof task.source === "string" ? { source: task.source } : {}),
    });
  }
  const statuses =
    loaded?.statuses ??
    statusFiles(ws).map(({ file }) => ({
      file,
      data: normalizeStatus(parseFrontmatter(ws.readText(file)).data) as { next?: Record<string, unknown>[] },
    }));
  for (const { file, data } of statuses)
    for (const next of data.next ?? []) {
      if (
        next.status !== "done" ||
        typeof next.result !== "string" ||
        !next.result.trim() ||
        typeof next.completed !== "string" ||
        !hasCompletionTime(next.completed)
      )
        continue;
      results.push({
        file,
        id: next.id,
        title: next.title,
        text: next.result,
        completed_at: next.completed,
        by: "unknown",
        source: `${file}#${next.id}`,
      } as ResultRow);
    }
  return results.sort(
    (a, b) =>
      (Date.parse(b.completed_at) || 0) - (Date.parse(a.completed_at) || 0) ||
      a.file.localeCompare(b.file) ||
      a.id.localeCompare(b.id),
  );
}
export function resultActivityDays(results: ResultRow[], timeZone: string, now = new Date()): number {
  const today = localDate(now, timeZone);
  const from = new Date(`${today}T12:00:00Z`);
  from.setUTCDate(from.getUTCDate() - 6);
  const firstDay = from.toISOString().slice(0, 10);
  return new Set(
    results
      .filter(
        (row) =>
          (row.by === "user" || (row.by === "unknown" && row.file !== "task")) &&
          row.text.trim() &&
          Date.parse(row.completed_at) <= now.getTime(),
      )
      .map((row) => localDate(new Date(row.completed_at), timeZone))
      .filter((day) => day >= firstDay && day <= today),
  ).size;
}
