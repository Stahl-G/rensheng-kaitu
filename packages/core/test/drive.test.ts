import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import {
  Workspace,
  addRecord,
  defaultRoot,
  disableDrive,
  doctor,
  driveStatus,
  enableDrive,
  findDriveDirectory,
  history,
  historyDirectory,
  initWorkspace,
  mcpToken,
  readRecords,
  reindexChats,
  restore,
  snapshot,
  stageUpload,
  stateDirectory,
  validateWorkspace,
} from "../src/index.js";
import { tmp, workout } from "./helpers.js";

it("Drive 自动发现本地化目录、迁移隔离状态，历史可恢复并可搬回本机", async () => {
  const home = tmp();
  vi.stubEnv("HOME", home);
  vi.stubEnv("XDG_STATE_HOME", join(home, "state"));
  vi.stubEnv("LOCALAPPDATA", join(home, "local"));
  vi.stubEnv("KAITU_DIR", "");
  try {
    const drive = join(home, "Library/CloudStorage/GoogleDrive-x/我的云端硬盘");
    mkdirSync(drive, { recursive: true });
    const ws = await initWorkspace(join(home, "kaitu"));
    const [initial] = await history(ws);
    const added = addRecord(ws, "workout", workout);
    const token = mcpToken(ws);
    reindexChats(ws);
    const upload = stageUpload(ws, "nut-ai", "test.json", Buffer.from("{}"));
    await snapshot(ws, "迁移前");
    const before = await history(ws);
    if (process.platform !== "win32") expect(findDriveDirectory()).toBe(drive);
    await enableDrive(ws, { driveDir: drive });
    expect(ws.root).toBe(join(drive, "kaitu"));
    expect(defaultRoot()).toBe(ws.root);
    expect(driveStatus(ws).mode).toBe("drive");
    expect(readdirSync(join(ws.root, ".kaitu"))).toEqual(["config.json"]);
    expect(existsSync(join(ws.root, ".git"))).toBe(false);
    expect(existsSync(historyDirectory(ws))).toBe(true);
    expect(historyDirectory(ws).startsWith(ws.root)).toBe(false);
    expect(mcpToken(ws)).toBe(token);
    expect(ws.readText(upload)).toBe("{}");
    expect(ws.exists(".kaitu/index.sqlite")).toBe(true);
    expect((await doctor(ws)).every((check) => check.ok)).toBe(true);
    expect(validateWorkspace(ws)).toEqual([]);
    expect((await history(ws)).slice(1)).toEqual(before);
    // 恢复本地模式旧版本时仍保留当前 state_dir。
    const state = stateDirectory(ws.root);
    await restore(ws, initial?.oid as string);
    expect(readRecords(ws, "workout")).toEqual([]);
    expect(stateDirectory(ws.root)).toBe(state);
    await restore(ws, before[0]?.oid as string);
    expect(readRecords(ws, "workout")[0]).toEqual(added.record);
    const versions = await history(ws);
    await disableDrive(ws);
    expect(ws.root).toBe(join(home, "kaitu"));
    expect(defaultRoot()).toBe(ws.root);
    expect(driveStatus(ws).mode).toBe("local");
    expect(stateDirectory(ws.root)).toBe(join(ws.root, ".kaitu"));
    expect(existsSync(state)).toBe(false);
    expect((await history(new Workspace(ws.root))).slice(1)).toEqual(versions);
    expect(readRecords(ws, "workout")[0]).toEqual(added.record);
    expect(mcpToken(ws)).toBe(token);
    expect(ws.readText(upload)).toBe("{}");
    expect(validateWorkspace(ws)).toEqual([]);
    // 目标已有数据时不得移动任何状态。
    mkdirSync(join(drive, "occupied"));
    await expect(enableDrive(ws, { driveDir: drive, name: "occupied" })).rejects.toThrow();
    expect(driveStatus(ws).mode).toBe("local");
    expect(mcpToken(ws)).toBe(token);
    mkdirSync(join(home, "Library/CloudStorage/GoogleDrive-second/My Drive"), { recursive: true });
    if (process.platform !== "win32") expect(() => findDriveDirectory()).toThrow();
  } finally {
    vi.unstubAllEnvs();
    rmSync(home, { recursive: true, force: true });
  }
});
