import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zipSync } from "fflate";
import { afterAll, afterEach, beforeEach, onTestFailed } from "vitest";
import { initWorkspace } from "../src/init.js";
import { disposeNoteIndex } from "../src/note-search.js";
import { Workspace } from "../src/workspace.js";

// Only remove directories created here, never a caller-supplied workspace root or
// other kaitu-test-* directories left by earlier runs. Set before starting Vitest.
const temporaryDirectories = new Set<string>();
const workspaces = new Set<Promise<Workspace>>();
const keepTemporaryDirectories = process.env.KAITU_KEEP_TEST_TEMP === "1";

export function tmp(): string {
  const directory = mkdtempSync(join(tmpdir(), "kaitu-test-"));
  temporaryDirectories.add(directory);
  return directory;
}

export async function freshWorkspace(timeZone = "Asia/Shanghai"): Promise<Workspace> {
  const ws = initWorkspace(join(tmp(), "kaitu"), {
    timeZone,
    now: new Date("2026-10-15T00:00:00Z"),
  });
  workspaces.add(ws);
  return ws;
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
  // Drain initialization and index handles before removing files (also on Windows).
  // A rejected seed must not prevent the remaining directories from being cleaned.
  const initialized = await Promise.allSettled(workspaces);
  const closed = await Promise.allSettled(
    initialized.flatMap((result) => (result.status === "fulfilled" ? [disposeNoteIndex(result.value)] : [])),
  );
  // Tests may already have asserted a cached shutdown rejection. Log it without
  // reporting the same expected error as a second suite failure.
  for (const result of closed) {
    if (result.status === "rejected") console.error("Test index shutdown reported:", result.reason);
  }
  workspaces.clear();
  // Keep failed-run evidence only on an explicit debugging run.
  if (keepTemporaryDirectories) {
    for (const directory of temporaryDirectories) {
      if (existsSync(directory)) console.warn("Preserved test directory:", directory);
    }
    return;
  }
  const errors: unknown[] = [];
  for (const directory of temporaryDirectories) {
    try {
      rmSync(directory, { recursive: true, force: true, maxRetries: 3 });
    } catch (error) {
      console.error("Could not remove test directory:", directory);
      errors.push(error);
    }
  }
  temporaryDirectories.clear();
  if (errors.length) throw new AggregateError(errors, "Could not remove test directories");
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
  workspaces.add(Promise.resolve(ws));
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
