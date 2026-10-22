import { readFileSync } from "node:fs";
import { join } from "node:path";
import { templateDir } from "./assets.js";
import { KaituError } from "./errors.js";
import { snapshot } from "./history.js";
import { type ModuleDef, listRecordTypes } from "./modules.js";
import { type StoredRecord, type WriteOptions, addRecord, readRecords, updateRecord } from "./records.js";
import { localDate, parseTs } from "./time.js";
import type { Workspace } from "./workspace.js";

export type TaskStatus = "proposed" | "open" | "done" | "cancelled";
export interface Task extends StoredRecord {
  title: string;
  status: TaskStatus;
  due?: string;
  remind_at?: string;
  project?: string;
  investment?: string;
  notes?: string;
  source?: string;
}
export interface TaskInput {
  title: string;
  due?: string;
  remind_at?: string;
  project?: string;
  investment?: string;
  notes?: string;
  source?: string;
}
type TaskWriteOptions = WriteOptions & { actor?: string };

function dueDay(due: string, timeZone: string): string {
  return due.length === 10 ? due : localDate(parseTs(due), timeZone);
}

export function listTasks(
  ws: Workspace,
  options: { status?: TaskStatus | "all"; dueBefore?: string } = {},
): Task[] {
  const status = options.status ?? "open";
  const bound = options.dueBefore;
  const zone = ws.timeZone();
  return (readRecords(ws, "task") as Task[]).filter((task) => {
    if (status !== "all" && task.status !== status) return false;
    if (!bound) return true;
    if (!task.due) return false;
    if (bound.length === 10) return dueDay(task.due, zone) <= bound;
    const instant = parseTs(bound);
    return task.due.length === 10
      ? task.due < localDate(instant, zone)
      : parseTs(task.due).getTime() <= instant.getTime();
  });
}

export function tasksForToday(rows: StoredRecord[], timeZone: string, now = new Date()) {
  const today = localDate(now, timeZone);
  return (rows as Task[])
    .filter((task) => task.status === "open")
    .map((task) => ({
      ...task,
      dueToday: !!task.due && dueDay(task.due, timeZone) === today,
      overdue: !!task.due && (task.due.length === 10 ? task.due < today : parseTs(task.due) < now),
      remindToday: !!task.remind_at && localDate(parseTs(task.remind_at), timeZone) === today,
    }))
    .filter((task) => task.dueToday || task.overdue || task.remindToday);
}

export async function addTask(ws: Workspace, input: TaskInput, options: TaskWriteOptions = {}) {
  const result = addRecord(
    ws,
    "task",
    { ...input, status: "open" },
    { ...options, by: options.by ?? "user" },
  );
  const action = result.record.status === "proposed" ? "提出了待办建议" : "记下了待办";
  const version = await snapshot(ws, `${options.actor ?? "你"}${action}：${result.record.title}`);
  return { ...result, version };
}

/** 插件与 Agent 共用的建议入口；调用方不能自行指定用户身份。 */
export function proposeTask(ws: Workspace, input: TaskInput, actor = "Agent") {
  return addTask(ws, input, { by: "agent", actor });
}

/** 只由用户界面或已接收的手机采纳操作调用；重复点击不追加修订。 */
export async function adoptTask(ws: Workspace, id: string) {
  const task = listTasks(ws, { status: "all" }).find((task) => task.id === id);
  if (!task) throw new KaituError("待办建议不存在", "NOT_FOUND");
  if (task.status === "open") return { record: task, version: null };
  if (task.status !== "proposed") throw new KaituError("待办已处理，请刷新", "CONFLICT");
  const result = updateRecord(ws, "task", id, { status: "open" }, { by: "user" });
  return { ...result, version: await snapshot(ws, `你采纳了待办：${task.title}`) };
}

async function setTaskStatus(ws: Workspace, id: string, status: TaskStatus, options: TaskWriteOptions) {
  if (status === "done" && listTasks(ws, { status: "proposed" }).some((task) => task.id === id))
    throw new KaituError("请先采纳待办建议，再完成", "USER_DECISION");
  const result = updateRecord(ws, "task", id, { status }, { ...options, by: options.by ?? "user" });
  const action = status === "done" ? "完成" : "取消";
  const version = await snapshot(ws, `${options.actor ?? "你"}${action}了待办：${result.record.title}`);
  return { ...result, version };
}

export function completeTask(ws: Workspace, id: string, options: TaskWriteOptions = {}) {
  return setTaskStatus(ws, id, "done", options);
}

export function cancelTask(ws: Workspace, id: string, options: TaskWriteOptions = {}) {
  return setTaskStatus(ws, id, "cancelled", options);
}

export function ensureTaskModule(ws: Workspace): void {
  if (!ws.exists("me/module.json") || listRecordTypes(ws).some((ref) => ref.type === "task")) return;
  const module = ws.readJson<ModuleDef>("me/module.json");
  const template: ModuleDef = JSON.parse(readFileSync(join(templateDir(), "me/module.json"), "utf8"));
  const task = template.records?.task;
  if (!task) throw new Error("内置模板缺少 task 定义");
  module.records = { ...module.records, task };
  ws.writeJson("me/module.json", module);
}
