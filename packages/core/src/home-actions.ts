import { isDeepStrictEqual } from "node:util";
import { normalizeDocument } from "./doc-input.js";
import { KaituError } from "./errors.js";
import { parseFrontmatter, stringifyFrontmatter } from "./frontmatter.js";
import type { HomeThread } from "./home.js";
import { noteLine } from "./plans.js";
import { readRecords, updateRecord } from "./records.js";
import { schemas } from "./schema.js";
import { localDate } from "./time.js";
import { type ModuleStatus, type NextItem, statusFiles } from "./workbench.js";
import type { Workspace } from "./workspace.js";

export type HomeNextTarget = NonNullable<HomeThread["next"]>;
export interface HomeCompletion {
  token: string;
  title: string;
}
export interface HomeResult {
  id: string;
  file: string;
  title: string;
  text: string;
  date: string;
  at: string;
}
type Receipt = {
  fingerprint: string;
  value: HomeCompletion;
  file: string;
  id: string;
  before: unknown;
  after: unknown;
  block?: string;
  undone: boolean;
};
// Session receipts are scoped to this workspace and never accepted as arbitrary restore instructions.
const sessions = new WeakMap<Workspace, Map<string, Receipt>>();
const conflict = () => new KaituError("这一步已变化，请刷新后重试", "CONFLICT");
function receipts(ws: Workspace) {
  let values = sessions.get(ws);
  if (!values) {
    values = new Map();
    sessions.set(ws, values);
  }
  return values;
}
function statusDocument(ws: Workspace, file: string) {
  if (!statusFiles(ws).some((item) => item.file === file)) throw conflict();
  const doc = parseFrontmatter<ModuleStatus>(ws.readText(file));
  doc.data = normalizeDocument("status.schema.json", doc.data) as unknown as ModuleStatus;
  return doc;
}
function writeStatus(ws: Workspace, file: string, doc: ReturnType<typeof statusDocument>) {
  if (!schemas().builtin("status.schema.json")(doc.data))
    throw new KaituError("状态文件格式不合法", "INVALID_DOCUMENT");
  ws.writeText(file, stringifyFrontmatter(doc.data, doc.body), { internal: true });
}
export function completeHomeNext(
  ws: Workspace,
  target: HomeNextTarget,
  result: string,
  operationId: string,
  now = new Date(),
): HomeCompletion {
  if (
    !target ||
    typeof target.id !== "string" ||
    !target.file ||
    !target.precondition ||
    typeof target.title !== "string"
  )
    throw conflict();
  if (typeof result !== "string" || !result.trim() || result.length > 2000 || /[\r\n]/.test(result))
    throw new KaituError("请用一句话记录结果", "BAD_ARGS");
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(operationId))
    throw new KaituError("操作编号无效", "BAD_ARGS");
  const fingerprint = JSON.stringify([target, result.trim()]);
  const prior = receipts(ws).get(operationId);
  if (prior) {
    if (prior.fingerprint !== fingerprint || prior.undone) throw conflict();
    return prior.value;
  }
  const at = now.toISOString();
  const value = { token: operationId, title: target.title };
  let receipt: Receipt;
  if (target.file === "task" && target.precondition.kind === "task") {
    const task = readRecords(ws, "task").find((item) => item.id === target.id);
    if (
      !task ||
      task.status !== "open" ||
      task.title !== target.title ||
      (task.rev ?? 1) !== target.precondition.expectedRev
    )
      throw conflict();
    const notes = `${String(task.notes ?? "")
      .replace(/(?:^|\n)完成(?:结果|时间)：[^\n]*/g, "")
      .trimEnd()}\n完成结果：${result.trim()}\n完成时间：${at}\n`;
    const updated = updateRecord(ws, "task", task.id, { status: "done", notes }, { by: "user" }).record;
    receipt = { fingerprint, value, file: "task", id: task.id, before: task, after: updated, undone: false };
  } else if (target.file !== "task" && target.precondition.kind === "status") {
    const doc = statusDocument(ws, target.file);
    const item = doc.data.next?.find((item) => item.id === target.id);
    if (
      !item ||
      item.title !== target.title ||
      item.status !== "todo" ||
      !isDeepStrictEqual(item, target.precondition.expectedNext)
    )
      throw conflict();
    const before = { ...item };
    item.status = "done";
    const block = `\n### 完成结果 · ${at}\n事项：${encodeURIComponent(item.id)}\n你完成了：${item.title.replace(/[\r\n]+/g, " ")}\n结果：${result.trim()}\n`;
    doc.body += block;
    doc.data.updated = at;
    writeStatus(ws, target.file, doc);
    receipt = {
      fingerprint,
      value,
      file: target.file,
      id: item.id,
      before,
      after: { ...item },
      block,
      undone: false,
    };
  } else throw conflict();
  receipts(ws).set(operationId, receipt);
  return value;
}
export function undoHomeNext(ws: Workspace, token: string) {
  const receipt = receipts(ws).get(token);
  if (!receipt) throw new KaituError("撤销已过期，请打开事项调整", "NOT_FOUND");
  if (receipt.undone) return { undone: true };
  if (receipt.file === "task") {
    const current = readRecords(ws, "task").find((item) => item.id === receipt.id);
    if (!isDeepStrictEqual(current, receipt.after)) throw conflict();
    const previous = receipt.before as { status: string; notes?: string };
    updateRecord(
      ws,
      "task",
      receipt.id,
      { status: previous.status, notes: previous.notes ?? "" },
      { by: "user" },
    );
  } else {
    const doc = statusDocument(ws, receipt.file);
    const index = doc.data.next?.findIndex((item) => item.id === receipt.id) ?? -1;
    if (
      index < 0 ||
      !isDeepStrictEqual(doc.data.next?.[index], receipt.after) ||
      !receipt.block ||
      !doc.body.includes(receipt.block)
    )
      throw conflict();
    (doc.data.next as NextItem[])[index] = receipt.before as NextItem;
    doc.body = doc.body.replace(receipt.block, "");
    doc.data.updated = new Date().toISOString();
    writeStatus(ws, receipt.file, doc);
  }
  receipt.undone = true;
  return { undone: true };
}
/** Only explicit user results with an actual completion timestamp count. Captures, sync, estimates and old task creation dates do not. */
export function homeResults(
  records: import("./records.js").StoredRecord[],
  _statuses: readonly { file: string; data: ModuleStatus; body: string }[],
  timeZone: string,
  today: string,
  cutoff = new Date().toISOString(),
  taskRevisions?: readonly import("./records.js").StoredRecord[],
): HomeResult[] {
  const results: HomeResult[] = [];
  const add = (item: Omit<HomeResult, "date">) => {
    const stamp = Date.parse(item.at);
    if (!Number.isFinite(stamp) || stamp > Date.parse(cutoff) || !/(Z|[+-]\d{2}:\d{2})$/i.test(item.at))
      return;
    const date = localDate(new Date(stamp), timeZone);
    const age = (Date.parse(`${today}T12:00:00Z`) - Date.parse(`${date}T12:00:00Z`)) / 86400000;
    if (age >= 0 && age < 7) results.push({ ...item, date });
  };
  const signature = (task: import("./records.js").StoredRecord) =>
    JSON.stringify([
      task.id,
      noteLine(String(task.notes ?? ""), "完成时间"),
      noteLine(String(task.notes ?? ""), "完成结果").trim(),
    ]);
  const authors = new Map<string, import("./records.js").StoredRecord>();
  for (const revision of taskRevisions ?? []) {
    const first = authors.get(signature(revision));
    if (revision.status === "done" && !revision.deleted && (!first || (revision.rev ?? 1) < (first.rev ?? 1)))
      authors.set(signature(revision), revision);
  }
  for (const task of records) {
    const text = noteLine(String(task.notes ?? ""), "完成结果").trim();
    const at = noteLine(String(task.notes ?? ""), "完成时间");
    // The last editor is not the completion author. Without revision provenance, do not guess.
    if (task.status === "done" && authors.get(signature(task))?.by === "user" && text && at)
      add({ id: task.id, file: "task", title: String(task.title), text, at });
  }
  // STATUS completion prose remains readable and undoable, but it has no persistent actor evidence.
  // It cannot establish a user-authored result for this activity count.
  return results.sort((a, b) => b.at.localeCompare(a.at));
}
