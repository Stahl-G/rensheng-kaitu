import fs from "node:fs";
import { join } from "node:path";
import { expect, it, onTestFailed, onTestFinished } from "vitest";
import { currentWorkspace, localStateRoot, rememberWorkspace } from "../src/drive.js";
import { workspaceBackupRequest } from "../src/workspace-backup.js";
import { freshWorkspace } from "./helpers.js";

function traceActivation(test: string) {
  const start = performance.now();
  let pending: string | null = null;
  let failed = false;
  let finished = false;
  const report = (event: string, stage = pending) => {
    const resources = process.getActiveResourcesInfo().reduce<Record<string, number>>((counts, name) => {
      counts[name] = (counts[name] ?? 0) + 1;
      return counts;
    }, {});
    fs.writeSync(
      2,
      `activation-stage ${JSON.stringify({
        test,
        pid: process.pid,
        at: performance.now(),
        ms: performance.now() - start,
        event,
        stage,
        pending,
        failed,
        finished,
        resources,
      })}\n`,
    );
  };
  onTestFailed(() => {
    failed = true;
    report("test-failed");
  });
  onTestFinished(() => {
    finished = true;
    report("test-finished");
  });
  return async <T>(stage: string, run: () => T | Promise<T>): Promise<T> => {
    pending = stage;
    report("start");
    try {
      return await run();
    } finally {
      report("settled", stage);
      pending = null;
    }
  };
}

it("目标状态损坏时保留当前工作区和指针，修好后可重新打开", async () => {
  const step = traceActivation("corrupt-target");
  const current = await step("fresh-current", () => freshWorkspace());
  const target = await step("fresh-target", () => freshWorkspace());
  const previous = current.root;
  await step("remember-current", () => rememberWorkspace(previous));
  for (const file of [".kaitu/secrets.json", ".kaitu/workspace-backup.json"]) {
    target.writeText(file, "{", { internal: true });
    await expect(
      step(`activate-corrupt-${file}`, () =>
        workspaceBackupRequest(current, "activate", { root: target.root }),
      ),
    ).rejects.toThrow();
    expect(current.root).toBe(previous);
    expect(currentWorkspace()).toBe(previous);
    target.writeJson(file, file.endsWith("secrets.json") ? {} : { base: {}, conflicts: [] }, {
      internal: true,
    });
  }
  await step("activate-repaired", () => workspaceBackupRequest(current, "activate", { root: target.root }));
  expect(current.root).toBe(target.root);
  expect(currentWorkspace()).toBe(target.root);
});

it("保存打开位置失败时保留当前工作区和原指针", async () => {
  const step = traceActivation("pointer-save-failure");
  const current = await step("fresh-current", () => freshWorkspace());
  const target = await step("fresh-target", () => freshWorkspace());
  const previous = current.root;
  await step("remember-current", () => rememberWorkspace(previous));
  const temp = join(localStateRoot(), "current-workspace.json.tmp");
  fs.mkdirSync(temp);
  try {
    await expect(
      step("activate-pointer-save-failure", () =>
        workspaceBackupRequest(current, "activate", { root: target.root }),
      ),
    ).rejects.toThrow();
    expect(current.root).toBe(previous);
    expect(currentWorkspace()).toBe(previous);
  } finally {
    fs.rmdirSync(temp);
  }
});
