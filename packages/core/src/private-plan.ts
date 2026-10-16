import { rmSync } from "node:fs";
import { parseFrontmatter, stringifyFrontmatter } from "./frontmatter.js";
import { localRecordStore } from "./private-records.js";
import { type PrivacyIndex, privacyIndex, privateBlock } from "./record-privacy.js";
import type { Workspace } from "./workspace.js";

type Item = Record<string, unknown>;
interface Plan {
  date: string;
  blocks: Item[];
  attention?: Item[];
  [key: string]: unknown;
}
function collections(plan: Plan, blocks: Item[], attention: Item[]): Plan {
  return { ...plan, blocks, ...(plan.attention !== undefined || attention.length ? { attention } : {}) };
}
export function readPlan(ws: Workspace, publicOnly = false, index?: PrivacyIndex): string {
  const raw = ws.readBytes("NOW.md").toString("utf8");
  if (!publicOnly && (ws.privateRecords || !ws.exists(".kaitu/local-projects/NOW.md"))) return raw;
  const shared = parseFrontmatter<Plan>(raw);
  let blocks = shared.data.blocks ?? [];
  let attention = shared.data.attention ?? [];
  if (publicOnly) {
    if (Array.isArray(blocks) && !blocks.length && Array.isArray(attention) && !attention.length) return raw;
    const privacy = index ?? privacyIndex(ws);
    blocks = blocks.filter((block) => !privateBlock(ws, block, privacy));
    attention = attention.filter((item) => !privateBlock(ws, item, privacy));
  } else if (!ws.privateRecords && ws.exists(".kaitu/local-projects/NOW.md")) {
    const local = parseFrontmatter<Plan>(ws.readBytes(".kaitu/local-projects/NOW.md").toString("utf8"));
    if (local.data.date === shared.data.date) {
      const merged = new Map(blocks.map((block) => [block.id, block]));
      for (const block of local.data.blocks ?? []) merged.set(block.id, block);
      blocks = [...merged.values()];
      attention = [
        ...new Map(
          [...attention, ...(local.data.attention ?? [])].map((item) => [JSON.stringify(item), item]),
        ).values(),
      ];
    }
  }
  return stringifyFrontmatter(collections(shared.data, blocks, attention), shared.body);
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
  const attention = plan.data.attention ?? [];
  if (!plan.data.blocks.length && !attention.length) {
    if (ws.exists(".kaitu/local-projects/NOW.md"))
      rmSync(ws.resolve(".kaitu/local-projects/NOW.md", { internal: true }));
    put(ws, text, true);
    return;
  }
  const privacy = privacyIndex(ws);
  const split = (rows: Item[]) => {
    const shared: Item[] = [];
    const local: Item[] = [];
    for (const row of rows) (privateBlock(ws, row, privacy) ? local : shared).push(row);
    return { shared, local };
  };
  const blocks = split(plan.data.blocks);
  const notices = split(attention);
  if (blocks.local.length || notices.local.length)
    put(localRecordStore(ws), stringifyFrontmatter(collections(plan.data, blocks.local, notices.local), ""));
  else if (ws.exists(".kaitu/local-projects/NOW.md"))
    rmSync(ws.resolve(".kaitu/local-projects/NOW.md", { internal: true }));
  put(ws, stringifyFrontmatter(collections(plan.data, blocks.shared, notices.shared), plan.body), true);
}
export function relocatePlan(ws: Workspace): void {
  if (!ws.privateRecords && ws.exists("NOW.md")) writePlan(ws, readPlan(ws));
}
