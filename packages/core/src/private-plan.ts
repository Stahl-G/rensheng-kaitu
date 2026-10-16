import { rmSync } from "node:fs";
import { parseFrontmatter, stringifyFrontmatter } from "./frontmatter.js";
import { localRecordStore } from "./private-records.js";
import { type PrivacyIndex, privacyIndex, privateBlock } from "./record-privacy.js";
import type { Workspace } from "./workspace.js";

interface Plan {
  date: string;
  blocks: Record<string, unknown>[];
  [key: string]: unknown;
}
export function readPlan(ws: Workspace, publicOnly = false, index?: PrivacyIndex): string {
  const raw = ws.readBytes("NOW.md").toString("utf8");
  if (!publicOnly && (ws.privateRecords || !ws.exists(".kaitu/local-projects/NOW.md"))) return raw;
  const shared = parseFrontmatter<Plan>(raw);
  let blocks = shared.data.blocks ?? [];
  if (publicOnly) {
    if (Array.isArray(blocks) && !blocks.length) return raw;
    const privacy = index ?? privacyIndex(ws);
    blocks = blocks.filter((block) => !privateBlock(ws, block, privacy));
  } else if (!ws.privateRecords && ws.exists(".kaitu/local-projects/NOW.md")) {
    const local = parseFrontmatter<Plan>(ws.readBytes(".kaitu/local-projects/NOW.md").toString("utf8"));
    if (local.data.date === shared.data.date) {
      const merged = new Map(blocks.map((block) => [block.id, block]));
      for (const block of local.data.blocks ?? []) merged.set(block.id, block);
      blocks = [...merged.values()];
    }
  }
  return stringifyFrontmatter({ ...shared.data, blocks }, shared.body);
}
function put(ws: Workspace, text: string, projected = false): void {
  if (ws.exists("NOW.md") && ws.readBytes("NOW.md").toString("utf8") === text) return;
  ws.writeText("NOW.md", text, { projected });
}
export function writePlan(ws: Workspace, text: string): void {
  const plan = parseFrontmatter<Plan>(text);
  if (!Array.isArray(plan.data.blocks)) {
    put(ws, text, true);
    return;
  }
  if (!plan.data.blocks.length) {
    if (ws.exists(".kaitu/local-projects/NOW.md"))
      rmSync(ws.resolve(".kaitu/local-projects/NOW.md", { internal: true }));
    put(ws, text, true);
    return;
  }
  const privacy = privacyIndex(ws);
  const shared: Record<string, unknown>[] = [];
  const local: Record<string, unknown>[] = [];
  for (const block of plan.data.blocks) (privateBlock(ws, block, privacy) ? local : shared).push(block);
  if (local.length) put(localRecordStore(ws), stringifyFrontmatter({ ...plan.data, blocks: local }, ""));
  else if (ws.exists(".kaitu/local-projects/NOW.md"))
    rmSync(ws.resolve(".kaitu/local-projects/NOW.md", { internal: true }));
  put(ws, stringifyFrontmatter({ ...plan.data, blocks: shared }, plan.body), true);
}
export function relocatePlan(ws: Workspace): void {
  if (!ws.privateRecords && ws.exists("NOW.md")) writePlan(ws, readPlan(ws));
}
