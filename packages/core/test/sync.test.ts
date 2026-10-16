import childProcess from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import {
  Workspace,
  addRecord,
  createProject,
  defaultRoot,
  disableSync,
  doctor,
  enableDrive,
  enableSync,
  history,
  historyDirectory,
  initWorkspace,
  mcpToken,
  readProject,
  readRecords,
  restore,
  snapshot,
  stateDirectory,
  syncStatus,
  validateWorkspace,
} from "../src/index.js";
import { tmp, workout } from "./helpers.js";

it("iCloud 往返保持数据、历史、密钥与本机项目，自定义目录仍可识别且拒绝跨云迁移", async () => {
  const home = tmp();
  const platform = Object.getOwnPropertyDescriptor(process, "platform") as PropertyDescriptor;
  Object.defineProperty(process, "platform", { value: "darwin" });
  vi.stubEnv("HOME", home);
  vi.stubEnv("KAITU_DIR", "");
  const download = vi.spyOn(childProcess, "execFileSync").mockImplementation(() => {
    throw new Error("模拟下载服务不可用");
  });
  try {
    const cloud = join(home, "Library/Mobile Documents/com~apple~CloudDocs");
    const ws = await initWorkspace(join(home, "kaitu"));
    const token = mcpToken(ws);
    const added = addRecord(ws, "workout", workout);
    const project = await createProject(ws, { title: "本机项目", kind: "personal", local_only: true });
    await snapshot(ws, "迁移前");
    const before = await history(ws);
    await expect(enableSync(ws, "icloud")).rejects.toThrow();
    expect(readRecords(ws, "workout")[0]).toEqual(added.record);
    mkdirSync(cloud, { recursive: true });
    const result = await enableSync(ws, "icloud");
    expect(result.mode).toBe("icloud");
    expect(ws.root).toBe(join(cloud, "kaitu"));
    expect(defaultRoot()).toBe(ws.root);
    expect(readdirSync(join(ws.root, ".kaitu"))).toEqual(["config.json"]);
    expect(historyDirectory(ws).startsWith(ws.root)).toBe(false);
    expect(existsSync(historyDirectory(ws))).toBe(true);
    expect(mcpToken(ws)).toBe(token);
    expect(readProject(ws, project.slug).dir.startsWith(".kaitu/local-projects/")).toBe(true);
    expect(ws.exists("AGENT-README.md")).toBe(false);
    expect(ws.exists("ORGANIZER.md")).toBe(false);
    expect(ws.exists("OVERVIEW.md")).toBe(true);
    expect((await history(ws)).slice(1)).toEqual(before);
    expect((await doctor(ws)).every((check) => check.ok)).toBe(true);
    expect(validateWorkspace(ws)).toEqual([]);
    await expect(enableDrive(ws, { driveDir: home })).rejects.toThrow();
    await restore(ws, before[0]?.oid as string);
    expect(syncStatus(ws).mode).toBe("icloud");
    const state = stateDirectory(ws.root);
    await disableSync(ws);
    expect(stateDirectory(ws.root)).toBe(join(home, "kaitu/.kaitu"));
    expect(existsSync(state)).toBe(false);
    expect(mcpToken(ws)).toBe(token);
    expect(readProject(ws, project.slug).dir).toBe(`projects/${project.slug}`);
    expect(readRecords(ws, "workout")[0]).toEqual(added.record);
    expect(validateWorkspace(ws)).toEqual([]);
    const custom = join(home, "custom");
    mkdirSync(custom);
    await enableSync(ws, "icloud", { dir: custom, name: "life" });
    expect(syncStatus(new Workspace(ws.root)).mode).toBe("icloud");
    await disableSync(ws);
    expect(syncStatus(ws).mode).toBe("local");
    expect(readRecords(ws, "workout")[0]).toEqual(added.record);
  } finally {
    download.mockRestore();
    Object.defineProperty(process, "platform", platform);
    vi.unstubAllEnvs();
    rmSync(home, { recursive: true, force: true });
  }
});
