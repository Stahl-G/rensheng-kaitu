import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { KaituError } from "./errors.js";
import { localStateRoot } from "./local-state.js";
import type { PhoneReceipt } from "./phone-receipts.js";
import { schemas } from "./schema.js";
import {
  type TaskDecision,
  type TaskDecisionAction,
  applyTaskDecision,
  taskDecisionContext,
  taskDecisions,
} from "./task-decisions.js";
import type { Workspace } from "./workspace.js";

export interface TaskDecisionScope {
  root: string;
  consumer_id: string;
}
export interface LocalTaskRequest {
  action: TaskDecisionAction;
  receipt?: PhoneReceipt;
}
export interface LocalTaskDecisions {
  scope: TaskDecisionScope;
  requests: LocalTaskRequest[];
  decisions: TaskDecision[];
}
// Local outbox is deliberately outside the sync workspace and independent of browser origin.
function journal(ws: Workspace) {
  const hash = (value: string) => createHash("sha256").update(value).digest("hex");
  const directory = join(localStateRoot(), "task-decision-outbox");
  const rootKey = hash(realpathSync(ws.root));
  const consumerKey = hash(taskDecisionContext(ws).consumer_id);
  const rootAlias = join(directory, "roots", `${rootKey}.json`);
  const consumerAlias = join(directory, "consumers", `${consumerKey}.json`);
  const alias = (path: string): string | undefined => {
    if (!existsSync(path)) return;
    const key: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (typeof key !== "string" || !/^[a-f0-9]{64}$/.test(key))
      throw new KaituError("建议请求索引无法读取，请核对本机资料", "INVALID_DOCUMENT");
    return key;
  };
  const priorRoot = alias(rootAlias);
  const priorConsumer = alias(consumerAlias);
  if (priorRoot && priorConsumer && priorRoot !== priorConsumer)
    throw new KaituError("建议请求归属冲突，请核对原工作区", "CONFLICT");
  const key = priorRoot ?? priorConsumer ?? rootKey;
  const file = join(directory, `${key}.json`);
  const atomic = (path: string, value: unknown) => {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const temp = `${path}.${randomUUID()}.tmp`;
    writeFileSync(temp, `${JSON.stringify(value)}\n`, { mode: 0o600 });
    renameSync(temp, path);
  };
  const bind = () => {
    if (priorRoot !== key) atomic(rootAlias, key);
    if (priorConsumer !== key) atomic(consumerAlias, key);
  };
  // A known producer follows app-supported moves. A changed producer at the same root
  // still discovers its old requests, whose original consumer remains held below.
  if (priorRoot || priorConsumer) bind();
  if ((priorRoot || priorConsumer) && !existsSync(file))
    throw new KaituError("原建议请求文件缺失，请核对本机资料", "INVALID_DOCUMENT");
  const requests: LocalTaskRequest[] = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : [];
  if (!Array.isArray(requests) || requests.some((row) => !row?.action?.client_id || !row.action.args))
    throw new KaituError("建议请求记录无法读取，请核对本机资料", "INVALID_DOCUMENT");
  return {
    root: ws.root,
    requests,
    save: () => {
      atomic(file, requests);
      bind();
    },
  };
}
export function localTaskDecisions(ws: Workspace, root: string): LocalTaskDecisions {
  const local = journal(ws);
  if (root !== local.root) throw new KaituError("工作区已切换，请重新读取", "CONFLICT");
  return {
    scope: { root: local.root, ...taskDecisionContext(ws) },
    requests: local.requests,
    decisions: taskDecisions(ws),
  };
}
/** Both RPC and standalone persist the entire original request before any core write. */
export function submitLocalTaskDecision(
  ws: Workspace,
  scope: TaskDecisionScope,
  action: TaskDecisionAction,
): PhoneReceipt {
  if (
    !schemas().builtin("phone-action.schema.json")({
      ...action,
      at: new Date().toISOString(),
      device: "00000000",
    })
  )
    throw new KaituError("建议操作格式不合法", "BAD_ARGS");
  const local = journal(ws);
  if (
    scope?.root !== local.root ||
    scope?.consumer_id !== taskDecisionContext(ws).consumer_id ||
    action.args.consumer_id !== scope.consumer_id
  )
    throw new KaituError("工作区身份已变化，原请求待核对", "CONFLICT");
  let row = local.requests.find((item) => item.action.client_id === action.client_id);
  if (row && !isDeepStrictEqual(row.action, action))
    throw new KaituError("请求已绑定原内容，请核对原请求", "CONFLICT");
  if (!row) {
    const target = (request: TaskDecisionAction): string => {
      if ("id" in request.args) return `${request.args.file}:${request.args.id}`;
      const decisionId = request.args.decision_id;
      const original = local.requests.find((item) => item.action.client_id === decisionId)?.action;
      return original && "id" in original.args ? `${original.args.file}:${original.args.id}` : decisionId;
    };
    if (
      local.requests.some(
        (item) =>
          !item.receipt &&
          (item.action.args.consumer_id !== scope.consumer_id || target(item.action) === target(action)),
      )
    )
      throw new KaituError("有未确认的建议操作，请核对原请求", "CONFLICT");
    row = { action: structuredClone(action) };
    local.requests.push(row);
    local.save();
  }
  if (row.receipt) return row.receipt;
  const receipt = applyTaskDecision(ws, row.action);
  row.receipt = receipt;
  local.save();
  return receipt;
}
export function retryLocalTaskDecision(ws: Workspace, scope: TaskDecisionScope, clientId: string) {
  const row = journal(ws).requests.find((item) => item.action.client_id === clientId);
  if (!row) throw new KaituError("找不到原建议请求，请重新读取", "BAD_ARGS");
  return submitLocalTaskDecision(ws, scope, row.action);
}
