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
  if (value === null) return current;
  if (
    !value.drafts ||
    typeof value.drafts !== "object" ||
    Array.isArray(value.drafts) ||
    Object.values(value.drafts).some((text) => typeof text !== "string")
  )
    throw new KaituError("草稿无效 / Invalid draft", "BAD_ARGS");
  if (isDeepStrictEqual(current, value)) return current;
  if (!isDeepStrictEqual(current, expected))
    throw new KaituError("草稿已变化，请重新打开 / Draft changed; reopen the app", "CONFLICT");
  const saved = { drafts: value.drafts, ...(value.operation ? { operation: value.operation } : {}) };
  ws.writeJson(draftFile, saved, { internal: true, mode: 0o600 });
  return saved;
}
