import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Workspace, initWorkspace } from "../src/index.js";

export function tmp(): string {
  return mkdtempSync(join(tmpdir(), "kaitu-test-"));
}

export async function freshWorkspace(timeZone = "Asia/Shanghai"): Promise<Workspace> {
  return initWorkspace(join(tmp(), "kaitu"), { timeZone, now: new Date("2026-10-15T00:00:00Z") });
}

export const workout = { exercise: "深蹲", sets: 3, reps: 12, weight_kg: 60, session_id: "s1" };
