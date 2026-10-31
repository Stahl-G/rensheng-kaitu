import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { zipSync } from "fflate";
import { afterAll, afterEach, beforeEach, onTestFailed } from "vitest";
import { initWorkspace } from "../src/init.js";
import { Workspace } from "../src/workspace.js";

export function tmp(): string {
  return mkdtempSync(join(tmpdir(), "kaitu-test-"));
}

export async function freshWorkspace(timeZone = "Asia/Shanghai"): Promise<Workspace> {
  return initWorkspace(join(tmp(), "kaitu"), { timeZone, now: new Date("2026-10-15T00:00:00Z") });
}

// Each test file owns its pristine seeds. Tests receive independent copies, including
// the real initial git history; never share a writable Workspace or hard-link files.
const seeds = new Map<string, Promise<Workspace>>();
type CloneStage = { stage: string; at: number };
let activeClones: CloneStage[][] | undefined;
beforeEach(() => {
  const clones: CloneStage[][] = [];
  activeClones = clones;
  onTestFailed(() => {
    if (clones.length) console.error("workspace-clone-stages", { clones, failedAt: performance.now() });
  });
});
afterEach(() => {
  activeClones = undefined;
});
afterAll(async () => {
  for (const seed of seeds.values()) {
    const ws = await seed;
    rmSync(dirname(ws.root), { recursive: true, force: true });
  }
});

/** For scenarios needing an initialized workspace; initialization tests use freshWorkspace. */
export async function clonedWorkspace(
  timeZone = "Asia/Shanghai",
  root = join(tmp(), "kaitu"),
): Promise<Workspace> {
  // Preserve setup progress when a test's overall deadline expires before its assertions.
  const stages: CloneStage[] = [];
  activeClones?.push(stages);
  const mark = (stage: string) => stages.push({ stage, at: performance.now() });
  mark("seed-wait");
  let seed = seeds.get(timeZone);
  if (!seed) {
    seed = freshWorkspace(timeZone);
    seeds.set(timeZone, seed);
  }
  const source = (await seed).root;
  mark("seed-ready");
  cpSync(source, root, { recursive: true });
  mark("copy-ready");
  const ws = new Workspace(root);
  mark("workspace-ready");
  return ws;
}

export const workout = { exercise: "深蹲", sets: 3, reps: 12, weight_kg: 60, session_id: "s1" };

export function appleHealthZip(): Uint8Array {
  return zipSync({
    "apple_health_export/export.xml": readFileSync(
      new URL("../../../examples/apple-health/export.xml", import.meta.url),
    ),
  });
}
