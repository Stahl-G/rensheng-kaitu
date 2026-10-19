import { basename } from "node:path";
import { type PhoneReceipt, phoneReceipts, writePhoneReceipts } from "./phone-receipts.js";
import { schemas } from "./schema.js";
import { cancelTask, completeTask, listTasks } from "./tasks.js";
import { completeNext, decidePhoneProposal } from "./workbench.js";
import type { Workspace } from "./workspace.js";

export const phoneInboxName =
  /^ios-[0-9a-f]{8}-[0-9A-HJKMNP-TV-Z]{26}\.(note\.md|records\.jsonl|actions\.jsonl)$/;
interface Action {
  client_id: string;
  op: string;
  args: { id: string; file: string; decision: "confirmed" | "rejected" };
}

export async function applyPhoneActions(ws: Workspace, file: string, text: string) {
  const ledgerFile = ".kaitu/phone-actions.json";
  // 账本记每个 client_id 第一次的结果；重投时成功的回 duplicate，冲突或拒绝的照原样再回一次。
  const seen: Record<string, Pick<PhoneReceipt, "status" | "message">> = ws.exists(ledgerFile)
    ? ws.readJson(ledgerFile)
    : {};
  // 云端整理员处理过的操作只留在回执里，本机账本没有。
  for (const r of phoneReceipts(ws))
    if (r.kind === "action" && !seen[r.ref])
      seen[r.ref] =
        r.status === "conflict" || r.status === "rejected"
          ? { status: r.status, message: r.message }
          : { status: "applied" };
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
    if (first) Object.assign(receipt, first.status === "applied" ? { status: "duplicate" } : first);
    else {
      const { id, file: target, decision } = action.args;
      try {
        switch (action.op) {
          case "complete_next":
            await completeNext(ws, target, id);
            break;
          case "decide_proposal":
            await decidePhoneProposal(ws, id, decision);
            break;
          case "complete_task":
          case "cancel_task":
            openTasks ??= new Set(listTasks(ws).map((task) => task.id));
            if (!openTasks.has(id)) throw new Error("待办已处理或不存在");
            if (action.op === "complete_task") await completeTask(ws, id);
            else await cancelTask(ws, id);
            openTasks.delete(id);
            break;
          default:
            receipt.status = "rejected";
            receipt.message = "当前版本尚不支持这个操作";
        }
      } catch (error) {
        receipt.status = "conflict";
        receipt.message = (error as Error).message;
      }
      seen[action.client_id] = {
        status: receipt.status,
        ...(receipt.message ? { message: receipt.message } : {}),
      };
    }
    receipts.push(receipt);
  }
  ws.writeJson(ledgerFile, seen, { internal: true });
  writePhoneReceipts(ws, receipts);
}
