import { basename } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { KaituError } from "./errors.js";
import { parseFrontmatter } from "./frontmatter.js";
import {
  type MemoryExpectation,
  type MemoryInput,
  archiveMemory,
  captureMemory,
  listMemories,
  memoryCaptureSchema,
  memoryExpectation,
  normalizedMemory,
  replaceMemory,
} from "./memory.js";
import { type PhoneReceipt, phoneReceipts, writePhoneReceipts } from "./phone-receipts.js";
import { commitRecordTransaction } from "./record-transaction.js";
import { type StoredRecord, readRecords } from "./records.js";
import { schemas } from "./schema.js";
import { adoptTask, cancelTask, completeTask, listTasks } from "./tasks.js";
import { localDate } from "./time.js";
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
    candidate?: MemoryInput | null;
    expected?: MemoryExpectation;
  };
}

// 待办先记进操作账本再追加；中途失败时重投复用同一条记录，不会重复追加。
type LedgerEntry = Partial<Pick<PhoneReceipt, "status" | "message" | "target">> & {
  task?: StoredRecord;
  memory?: { file: string; candidate: MemoryInput | null; expected: MemoryExpectation; at: string };
  capture?: ReturnType<typeof memoryCaptureSchema.parse>;
  captureResult?: PhoneReceipt["memory"];
};
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
    if (
      r.kind === "action" &&
      !seen[r.ref]?.status &&
      !seen[r.ref]?.memory &&
      !seen[r.ref]?.task &&
      !seen[r.ref]?.capture
    )
      seen[r.ref] =
        r.status === "conflict" || r.status === "rejected"
          ? { status: r.status, message: r.message }
          : {
              status: "applied",
              ...(r.target ? { target: r.target } : {}),
              ...(r.memory ? { captureResult: r.memory } : {}),
            };
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
    if (
      first?.capture &&
      (action.op !== "capture_memory" || !isDeepStrictEqual(first.capture, action.args))
    ) {
      receipt.status = "conflict";
      receipt.message = "这个 client_id 已绑定首次记忆内容，请沿首次操作重试";
      receipts.push(receipt);
      continue;
    }
    if (action.op === "capture_memory" && first && !first.capture) {
      // Another consumer may have processed it. Never reinterpret an old action ID as a new write.
      const prior = first.captureResult;
      const current = prior && normalizedMemory(ws, prior.file);
      if (prior && current) {
        receipt.status = "duplicate";
        receipt.memory = {
          file: prior.file,
          status: current.ended
            ? "undone"
            : listMemories(ws).some((entry) => entry.file === prior.file)
              ? "duplicate"
              : "superseded",
        };
      } else {
        receipt.status = "conflict";
        receipt.message = "这个 client_id 已处理，请回读原回执，不作为新记忆重投";
      }
      receipts.push(receipt);
      continue;
    }
    if (
      first?.status &&
      (action.op !== "capture_memory" || first.status === "conflict" || first.status === "rejected")
    )
      Object.assign(
        receipt,
        first.status === "applied"
          ? { status: "duplicate", ...(first.target ? { target: first.target } : {}) }
          : {
              status: first.status,
              ...(first.message ? { message: first.message } : {}),
              ...(first.target ? { target: first.target } : {}),
            },
      );
    else if (first?.memory && action.op !== "replace_memory") {
      receipt.status = "conflict";
      receipt.message = "这个 client_id 已绑定记忆操作，请沿首次操作重试";
      receipts.push(receipt);
      continue;
    } else {
      const { id, file: target, decision } = action.args;
      try {
        switch (action.op) {
          case "capture_memory": {
            const input = first?.capture ?? memoryCaptureSchema.parse(action.args);
            if (!first?.capture) {
              seen[action.client_id] = { capture: input };
              ws.writeJson(ledgerFile, seen, { internal: true });
            }
            const result = await captureMemory(ws, input);
            if (!result.entry) {
              receipt.status = result.status === "needs-clarification" ? "conflict" : "rejected";
              receipt.message = result.reason;
            } else if (
              result.status === "saved" ||
              result.status === "duplicate" ||
              result.status === "undone" ||
              result.status === "superseded"
            ) {
              receipt.status = result.status === "saved" ? "applied" : "duplicate";
              receipt.memory = { file: result.entry.file, status: result.status };
              receipt.message = result.warning ?? result.notice;
            }
            break;
          }
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
          case "replace_memory": {
            const plan = first?.memory ?? {
              file: target,
              candidate: action.args.candidate ?? null,
              expected: action.args.expected as MemoryExpectation,
              at: action.at,
            };
            if (!first?.memory) {
              const current = normalizedMemory(ws, plan.file);
              if (!current || current.ended || !isDeepStrictEqual(memoryExpectation(current), plan.expected))
                throw new KaituError("这条记忆已更新或归档，请核对后再确认", "CONFLICT");
              seen[action.client_id] = { memory: plan };
              ws.writeJson(ledgerFile, seen, { internal: true });
            }
            if (plan.candidate) {
              await replaceMemory(ws, plan.file, plan.candidate, {
                by: "user",
                now: new Date(plan.at),
                expected: plan.expected,
                replacementFile: `context_${action.client_id.toLowerCase()}.md`,
              });
            } else {
              const current = normalizedMemory(ws, plan.file);
              // 写完归档、还没记成功回执时中断：只认本操作的原内容，不能覆盖后来改过的记忆。
              const recovered =
                current?.ended === localDate(new Date(plan.at), ws.timeZone()) &&
                !current.replaced_by &&
                isDeepStrictEqual(memoryExpectation(current), plan.expected);
              if (!recovered)
                await archiveMemory(ws, plan.file, {
                  by: "user",
                  now: new Date(plan.at),
                  expected: plan.expected,
                });
            }
            break;
          }
          case "adopt_task": {
            const result = await adoptTask(ws, id);
            receipt.target = { id: result.record.id, rev: result.record.rev ?? 1 };
            openTasks = undefined;
            break;
          }
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
      const capture = seen[action.client_id]?.capture;
      seen[action.client_id] = {
        ...(capture ? { capture } : {}),
        status: receipt.status,
        ...(receipt.message ? { message: receipt.message } : {}),
        ...(receipt.target ? { target: receipt.target } : {}),
        ...(receipt.memory ? { captureResult: receipt.memory } : {}),
      };
      ws.writeJson(ledgerFile, seen, { internal: true });
    }
    receipts.push(receipt);
  }
  ws.writeJson(ledgerFile, seen, { internal: true });
  writePhoneReceipts(ws, receipts);
}
