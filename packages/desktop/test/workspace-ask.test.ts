import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { initWorkspace, moveWorkspace, workspaceBackupRequest } from "@kaitu/core";
import { expect, test } from "vitest";
// @ts-expect-error Desktop entry points are shipped as native ESM.
const { createLocalAsk } = await import("../local.mjs");

test("独立工作区会话隔离，切换回来与重新启动都保留各自的会话和权限", async () => {
  const temp = mkdtempSync(join(tmpdir(), "kaitu-workspace-ask-"));
  const ws = await initWorkspace(join(temp, "A"), { timeZone: "Asia/Shanghai" });
  const other = await initWorkspace(join(temp, "B 中文 空格"), { timeZone: "Asia/Shanghai" });
  const original = ws.root;
  const make = () =>
    createLocalAsk({
      state: join(temp, "app"),
      resources: resolve("packages/desktop"),
      executable: process.execPath,
      getWorkspace: () => ws.root,
      workspace: ws,
    });
  let ask = make();
  try {
    const a = ask.create();
    ask.organize(a.id, { title: "synthetic A" });
    await ask.setMode(a.id, "full", true);
    await ask.prepareRelocation(other.root);
    await workspaceBackupRequest(ws, "activate", { root: other.root });
    ask.relocate(ws.root);
    expect(ask.list()).toEqual([]);
    const b = ask.create();
    ask.organize(b.id, { title: "synthetic B" });
    expect(b.mode).toBe("scoped");
    await ask.close();
    ask = make();
    expect(ask.list().map((row: { id: string }) => row.id)).toEqual([b.id]);
    expect(ask.list()[0].title).toBe("synthetic B");
    await ask.prepareRelocation(original);
    await workspaceBackupRequest(ws, "activate", { root: original });
    ask.relocate(ws.root);
    expect(ask.list().map((row: { id: string }) => row.id)).toEqual([a.id]);
    expect(ask.list()[0].mode).toBe("full");
    expect(() => ask.events(b.id)).toThrow();
  } finally {
    await ask.close();
    rmSync(temp, { recursive: true, force: true });
  }
});

test("迁移同一工作区继续使用原会话身份，重新启动后仍可查看旧对话", async () => {
  const temp = mkdtempSync(join(tmpdir(), "kaitu-moved-ask-"));
  const ws = await initWorkspace(join(temp, "original"), { timeZone: "Asia/Shanghai" });
  const make = () =>
    createLocalAsk({
      state: join(temp, "app"),
      resources: resolve("packages/desktop"),
      executable: process.execPath,
      getWorkspace: () => ws.root,
      workspace: ws,
    });
  let ask = make();
  try {
    const row = ask.create();
    await ask.prepareRelocation();
    await moveWorkspace(ws, join(temp, "moved"), false);
    ask.relocate(ws.root);
    expect(ask.list()[0].id).toBe(row.id);
    await ask.close();
    ask = make();
    expect(ask.list()[0].id).toBe(row.id);
  } finally {
    await ask.close();
    rmSync(temp, { recursive: true, force: true });
  }
});
