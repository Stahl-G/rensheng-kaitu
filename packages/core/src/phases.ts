import { listRecordTypes } from "./modules.js";
import { readRecords } from "./records.js";
import type { Workspace } from "./workspace.js";

export function readPhases(ws: Workspace) {
  return listRecordTypes(ws).some((ref) => ref.type === "phase") ? readRecords(ws, "phase") : [];
}
