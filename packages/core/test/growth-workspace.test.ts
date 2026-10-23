import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import {
  Workspace,
  initWorkspace,
  listModules,
  readSettings,
  upgradeWorkspace,
  validateWorkspace,
  workspaceBackupRequest,
} from "../src/index.js";

it("从当前工作区新建一个孩子的成长模板，打开/切回仍可识别且不改变原资料", async () => {
  const root = mkdtempSync(join(tmpdir(), "kaitu-growth-entry-"));
  try {
    const original = join(root, "standard");
    const current = await initWorkspace(original);
    current.writeText("me/profile.md", "Synthetic parent: keep this original unchanged.\n");
    const before = current.readText("me/profile.md");
    const target = join(root, "child-a");
    await workspaceBackupRequest(current, "initialize", { root: target, template: "growth" });
    expect(current.root).toBe(original);
    const child = new Workspace(target);
    expect(listModules(child).some((m) => m.def.id === "growth")).toBe(true);
    expect(validateWorkspace(child)).toEqual([]);
    expect(child.readText("me/profile.md")).not.toBe(before);
    const childConfig = child.readJson<Record<string, unknown>>(".kaitu/config.json");
    expect(Object.keys(childConfig).sort()).toEqual(
      Object.keys(current.readJson<Record<string, unknown>>(".kaitu/config.json")).sort(),
    );
    await workspaceBackupRequest(current, "activate", { root: target });
    expect((await readSettings(current)).workspaceMode).toBe("growth");
    const profile = current.readText("me/profile.md");
    current.writeJson(
      ".kaitu/config.json",
      { ...childConfig, template_version: "synthetic-old" },
      { internal: true },
    );
    await upgradeWorkspace(current);
    expect((await readSettings(current)).workspaceMode).toBe("growth");
    expect(current.readText("me/profile.md")).toBe(profile);
    await workspaceBackupRequest(current, "activate", { root: original });
    expect((await readSettings(current)).workspaceMode).toBe("standard");
    expect(current.readText("me/profile.md")).toBe(before);
    expect(listModules(current).some((m) => m.def.id === "growth")).toBe(false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it("成长入口拒绝已有目录、备份接管和未知模板，不覆盖已有内容", async () => {
  const root = mkdtempSync(join(tmpdir(), "kaitu-growth-reject-"));
  try {
    const current = await initWorkspace(join(root, "standard"));
    const target = join(root, "nonempty");
    mkdirSync(target);
    const file = join(target, "keep.txt");
    writeFileSync(file, "synthetic existing note");
    await expect(
      workspaceBackupRequest(current, "initialize", { root: target, template: "growth" }),
    ).rejects.toMatchObject({ code: "NOT_EMPTY" });
    writeFileSync(join(target, "kaitu-backup.json"), "{}");
    await expect(initWorkspace(target, { template: "growth" })).rejects.toMatchObject({ code: "NOT_EMPTY" });
    await expect(
      workspaceBackupRequest(current, "initialize", { root: join(root, "unknown"), template: "unknown" }),
    ).rejects.toThrow();
    expect(readFileSync(file, "utf8")).toBe("synthetic existing note");
    expect(current.root).toBe(join(root, "standard"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
