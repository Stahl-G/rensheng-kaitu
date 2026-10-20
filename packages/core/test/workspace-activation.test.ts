import fs from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { currentWorkspace, localStateRoot, rememberWorkspace } from "../src/drive.js";
import { workspaceBackupRequest } from "../src/workspace-backup.js";
import { freshWorkspace } from "./helpers.js";

it("目标状态损坏时保留当前工作区和指针，修好后可重新打开", async () => {
  const current = await freshWorkspace();
  const target = await freshWorkspace();
  const previous = current.root;
  rememberWorkspace(previous);
  for (const file of [".kaitu/secrets.json", ".kaitu/workspace-backup.json"]) {
    target.writeText(file, "{", { internal: true });
    await expect(workspaceBackupRequest(current, "activate", { root: target.root })).rejects.toThrow();
    expect(current.root).toBe(previous);
    expect(currentWorkspace()).toBe(previous);
    target.writeJson(file, file.endsWith("secrets.json") ? {} : { base: {}, conflicts: [] }, {
      internal: true,
    });
  }
  await workspaceBackupRequest(current, "activate", { root: target.root });
  expect(current.root).toBe(target.root);
  expect(currentWorkspace()).toBe(target.root);
});

it("保存打开位置失败时保留当前工作区和原指针", async () => {
  const current = await freshWorkspace();
  const target = await freshWorkspace();
  const previous = current.root;
  rememberWorkspace(previous);
  const temp = join(localStateRoot(), "current-workspace.json.tmp");
  fs.mkdirSync(temp);
  try {
    await expect(workspaceBackupRequest(current, "activate", { root: target.root })).rejects.toThrow();
    expect(current.root).toBe(previous);
    expect(currentWorkspace()).toBe(previous);
  } finally {
    fs.rmdirSync(temp);
  }
});
