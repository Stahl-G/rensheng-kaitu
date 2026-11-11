import { isDeepStrictEqual } from "node:util";
import { KaituError } from "./errors.js";
import type { HomeThread } from "./home.js";
import type { ResultRequest } from "./results.js";
import type { Workspace } from "./workspace.js";
export type HomeNextTarget = NonNullable<HomeThread["next"]>;
export type HomeResultOperation = {
  request: ResultRequest;
  step: HomeNextTarget & { key: string; parent: string };
  text: string;
  restoreDraft?: boolean;
};
export interface HomeResultDraft {
  drafts: Record<string, string>;
  operation?: HomeResultOperation;
}
const draftFile = ".kaitu/result-draft.json";
function validDraft(value: unknown): value is HomeResultDraft {
  const object = (item: unknown): item is Record<string, unknown> =>
    !!item && typeof item === "object" && !Array.isArray(item);
  if (
    !object(value) ||
    !object(value.drafts) ||
    Object.values(value.drafts).some((text) => typeof text !== "string") ||
    Object.keys(value).some((key) => key !== "drafts" && key !== "operation")
  )
    return false;
  if (value.operation === undefined) return true;
  const op = value.operation;
  if (!object(op) || typeof op.text !== "string" || !object(op.request) || !object(op.step)) return false;
  const { request, step } = op;
  return (
    typeof request.client_id === "string" &&
    /^[0-9A-HJKMNP-TV-Z]{26}$/.test(request.client_id) &&
    ["complete_next_result", "restore_task_revision", "restore_next", "adopt_task", "cancel_task"].includes(
      String(request.op),
    ) &&
    object(request.args) &&
    typeof request.args.id === "string" &&
    request.args.id === step.id &&
    typeof step.file === "string" &&
    step.file === (request.args.file ?? "task") &&
    typeof step.title === "string" &&
    typeof step.key === "string" &&
    typeof step.parent === "string" &&
    (op.restoreDraft === undefined || typeof op.restoreDraft === "boolean") &&
    object(step.precondition) &&
    (step.precondition.kind === "task"
      ? typeof step.precondition.expectedRev === "number"
      : step.precondition.kind === "status" && object(step.precondition.expectedNext))
  );
}
/** Local application state follows Workspace's existing state binding, never phone or user records.
 * The full previous value is a CAS guard. Repeating a lost save is safe, without a revision/history layer.
 */
export function resultDraft(
  ws: Workspace,
  root: string,
  value: HomeResultDraft | null = null,
  expected: HomeResultDraft | null = null,
): HomeResultDraft {
  if (root !== ws.root) throw new KaituError("工作区已切换 / Workspace changed", "CONFLICT");
  const current = ws.exists(draftFile) ? ws.readJson<HomeResultDraft>(draftFile) : { drafts: {} };
  if (!validDraft(current))
    throw new KaituError("草稿损坏，请先修复 / Draft damaged; repair it first", "CORRUPT");
  if (value === null) return current;
  if (!validDraft(value)) throw new KaituError("草稿无效 / Invalid draft", "BAD_ARGS");
  if (isDeepStrictEqual(current, value)) return current;
  if (!isDeepStrictEqual(current, expected))
    throw new KaituError("草稿已变化，请重新打开 / Draft changed; reopen the app", "CONFLICT");
  const saved = { drafts: value.drafts, ...(value.operation ? { operation: value.operation } : {}) };
  ws.writeJson(draftFile, saved, { internal: true, mode: 0o600 });
  return saved;
}
