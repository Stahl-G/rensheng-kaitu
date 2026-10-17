import { listRecordTypes } from "./modules.js";
import { type By, addRecord, readRecords, updateRecord } from "./records.js";
import type { Workspace } from "./workspace.js";

export interface PhaseInput {
  title: string;
  start: string;
  end?: string;
  status: "suggested" | "confirmed" | "dismissed";
  trigger?: string;
  reflection?: string;
  investments?: string[];
  source?: string;
}
export type PhaseCommand =
  | { operation: "create"; data: PhaseInput }
  | { operation: "update"; id: string; expected_revision: number; data: Partial<PhaseInput> };
export function readPhases(ws: Workspace) {
  return listRecordTypes(ws).some((ref) => ref.type === "phase") ? readRecords(ws, "phase") : [];
}
/** 权限与预期修订统一由记录入口检查。 */
export function writePhase(ws: Workspace, command: PhaseCommand, by: By = "user") {
  return command.operation === "create"
    ? addRecord(ws, "phase", { ...command.data }, { by })
    : updateRecord(ws, "phase", command.id, command.data, {
        by,
        expected_revision: command.expected_revision,
      });
}
