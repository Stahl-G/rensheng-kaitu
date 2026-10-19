import { basename } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { KaituError } from "./errors.js";
import { parseFrontmatter } from "./frontmatter.js";
import { type PhoneReceipt, phoneReceipts, writePhoneReceipts } from "./phone-receipts.js";
import { commitRecordTransaction } from "./record-transaction.js";
import { type StoredRecord, readRecords } from "./records.js";
import { schemas } from "./schema.js";
import { cancelTask, completeTask, listTasks } from "./tasks.js";
import { completeNext, decidePhoneProposal, statusFiles } from "./workbench.js";
import type { Workspace } from "./workspace.js";

export const phoneInboxName =
  /^ios-[0-9a-f]{8}-[0-9A-HJKMNP-TV-Z]{26}\.(note\.md|records\.jsonl|actions\.jsonl)$/;
interface Action {
  client_id: string;
  at: string;
  op: string;
  args: {
    id: string;
    file: string;
    decision: "confirmed" | "rejected";
    expected_rev?: number;
    expected_next?: object;
    title?: string;
    due?: string | null;
    notes?: string;
  };
}

// 待办先记进操作账本再追加；中途失败时重投复用同一条记录，不会重复追加。
type LedgerEntry = Partial<Pick<PhoneReceipt, "status" | "message" | "target">> & { task?: StoredRecord };
function prepareTask(ws: Workspace, action: Action): StoredRecord {
  const { id, expected_rev, title, due, notes } = action.args;
  const current = readRecords(ws, "task").find((row) => row.id === id);
  if (action.op === "create_task") {
    if (current) throw new KaituError("这条待办已存在，未覆盖", "CONFLICT");
    return {
      id,
      ts: action.at,
      by: "user",
      rev: 1,
      title,
      status: "open",
      ...(due ? { due } : {}),
      ...(notes !== undefined ? { notes } : {}),
    };
  }
  if (!current || (current.rev ?? 1) !== expected_rev)
    throw new KaituError("这条待办已更新，请核对两端内容", "CONFLICT");
  if (action.op !== "update_task" && current.status !== "open")
    throw new KaituError("待办已处理，未覆盖", "CONFLICT");
  const next: StoredRecord = { ...current, by: "user", rev: (current.rev ?? 1) + 1 };
  if (action.op === "update_task") {
    if (title !== undefined) next.title = title;
    if (notes !== undefined) next.notes = notes;
    if (due === null) next.due = undefined;
    else if (due !== undefined) next.due = due;
  } else next.status = action.op === "complete_task" ? "done" : "cancelled";
  return next;
}

export async function applyPhoneActions(ws: Workspace, file: string, text: string) {
  const ledgerFile = ".kaitu/phone-actions.json";
  // 账本记每个 client_id 第一次的结果；重投时成功的回 duplicate，冲突或拒绝的照原样再回一次。
  const seen: Record<string, LedgerEntry> = ws.exists(ledgerFile) ? ws.readJson(ledgerFile) : {};
  // 云端整理员处理过的操作只留在回执里，本机账本没有。
  for (const r of phoneReceipts(ws))
    if (r.kind === "action" && !seen[r.ref]?.status)
      seen[r.ref] =
        r.status === "conflict" || r.status === "rejected"
          ? { status: r.status, message: r.message }
          : { status: "applied", ...(r.target ? { target: r.target } : {}) };
  const receipts: PhoneReceipt[] = [];
  let openTasks: Set<string> | undefined;
  const validate = schemas().builtin("phone-action.schema.json");
  for (const line of text.split(/\r?\n/).filter((line) => line.trim())) {
    let action: Action;
    try {
      const value = JSON.parse(line);
      if (!validate(value)) throw new Error("手机操作格式不合法");
      action = value as Action;
    } catch {
      receipts.push({
        ref: basename(file),
        kind: "file",
        status: "rejected",
        message: "手机操作格式不合法",
        at: new Date().toISOString(),
      });
      continue;
    }
    const receipt: PhoneReceipt = {
      ref: action.client_id,
      kind: "action",
      status: "applied",
      at: new Date().toISOString(),
    };
    const first = seen[action.client_id];
    if (first?.status)
      Object.assign(
        receipt,
        first.status === "applied"
          ? { status: "duplicate", ...(first.target ? { target: first.target } : {}) }
          : first,
      );
    else {
      const { id, file: target, decision } = action.args;
      try {
        switch (action.op) {
          case "complete_next":
            if (action.args.expected_next) {
              if (!statusFiles(ws).some((item) => item.file === target))
                throw new KaituError("找不到下一步来源", "CONFLICT");
              const data = parseFrontmatter<{ next?: { id: string }[] }>(ws.readText(target)).data;
              if (
                !isDeepStrictEqual(
                  data.next?.find((item) => item.id === id),
                  action.args.expected_next,
                )
              )
                throw new KaituError("这一步的内容已更新，请核对后再完成", "CONFLICT");
            }
            await completeNext(ws, target, id);
            break;
          case "decide_proposal":
            await decidePhoneProposal(ws, id, decision);
            break;
          case "create_task":
          case "update_task":
          case "complete_task":
          case "cancel_task": {
            if (action.args.expected_rev !== undefined) {
              const record = first?.task ?? prepareTask(ws, action);
              if (!first?.task) {
                seen[action.client_id] = { task: record };
                ws.writeJson(ledgerFile, seen, { internal: true });
              }
              await commitRecordTransaction(ws, [{ type: "task", record }], `手机更新待办：${record.title}`);
              receipt.target = { id: record.id, rev: record.rev ?? 1 };
              openTasks = undefined;
              break;
            }
            openTasks ??= new Set(listTasks(ws).map((task) => task.id));
            if (!openTasks.has(id)) throw new KaituError("待办已处理或不存在", "CONFLICT");
            if (action.op === "complete_task") await completeTask(ws, id);
            else await cancelTask(ws, id);
            openTasks.delete(id);
            break;
          }
          default:
            receipt.status = "rejected";
            receipt.message = "当前版本尚不支持这个操作";
        }
      } catch (error) {
        if (!(error instanceof KaituError)) throw error;
        receipt.status = "conflict";
        receipt.message = (error as Error).message;
      }
      seen[action.client_id] = {
        status: receipt.status,
        ...(receipt.message ? { message: receipt.message } : {}),
        ...(receipt.target ? { target: receipt.target } : {}),
      };
      ws.writeJson(ledgerFile, seen, { internal: true });
    }
    receipts.push(receipt);
  }
  ws.writeJson(ledgerFile, seen, { internal: true });
  writePhoneReceipts(ws, receipts);
}
