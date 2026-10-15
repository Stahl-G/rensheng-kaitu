import { execFile } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { initWorkspace } from "@kaitu/core";
import { expect, it } from "vitest";

it("status 汇总样例的今日待确认数量和近 7 天训练次数", async () => {
  const root = mkdtempSync(join(tmpdir(), "kaitu-status-"));
  try {
    await initWorkspace(root, { sample: true });
    const { stdout } = await promisify(execFile)(process.execPath, [
      "packages/cli/dist/main.js",
      "status",
      "--dir",
      root,
      "--json-out",
    ]);
    const data = JSON.parse(stdout);
    expect(data.now.pending).toBe(2);
    expect(data.recent7.workouts).toBe(4);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
