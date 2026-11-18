import {
  closeSync,
  existsSync,
  ftruncateSync,
  mkdirSync,
  openSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import {
  Workspace,
  addRecord,
  calendarPushEntries,
  captureNote,
  createProject,
  defaultRoot,
  disableDrive,
  doctor,
  driveStatus,
  enableDrive,
  findDriveDirectory,
  history,
  historyDirectory,
  initWorkspace,
  listModules,
  mcpToken,
  readCalendar,
  readLibrary,
  readProject,
  readRecords,
  reindexChats,
  restore,
  snapshot,
  stageUpload,
  stateDirectory,
  validateWorkspace,
} from "../src/index.js";
import { tmp, workout } from "./helpers.js";

function lifecycle(context: { onTestFailed: (callback: () => void) => void }) {
  const started = performance.now();
  const stages: { stage: string; elapsedMs: number }[] = [];
  context.onTestFailed(() => console.error("Synthetic filesystem lifecycle:", JSON.stringify(stages)));
  return (stage: string) => {
    const entry = { stage, elapsedMs: Math.round(performance.now() - started) };
    stages.push(entry);
    if (process.env.KAITU_CI_DIAGNOSTICS === "1") console.error("Synthetic filesystem stage:", entry);
  };
}

it("Drive 自动发现本地化目录、迁移隔离状态，历史可恢复并可搬回本机", async (context) => {
  const mark = lifecycle(context);
  mark("setup.begin");
  const home = tmp();
  vi.stubEnv("HOME", home);
  vi.stubEnv("XDG_STATE_HOME", join(home, "state"));
  vi.stubEnv("LOCALAPPDATA", join(home, "local"));
  vi.stubEnv("KAITU_DIR", "");
  try {
    const drive = join(home, "Library/CloudStorage/GoogleDrive-x/我的云端硬盘");
    mkdirSync(drive, { recursive: true });
    const ws = await initWorkspace(join(home, "kaitu"));
    mark("workspace.ready");
    const [initial] = await history(ws);
    const added = addRecord(ws, "workout", workout);
    const token = mcpToken(ws);
    reindexChats(ws);
    const upload = stageUpload(ws, "nut-ai", "test.json", Buffer.from("{}"));
    mark("history.snapshot");
    await snapshot(ws, "迁移前");
    const before = await history(ws);
    if (process.platform !== "win32") expect(findDriveDirectory()).toBe(drive);
    const existing = join(drive, "kaitu");
    mkdirSync(existing);
    mark("storage.enable");
    await enableDrive(ws, { driveDir: drive });
    expect(ws.root).toBe(join(drive, "kaitu-ai-memory"));
    expect(existsSync(existing)).toBe(true);
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
    mark("history.restore");
    await restore(ws, initial?.oid as string);
    expect(readRecords(ws, "workout")).toEqual([]);
    expect(stateDirectory(ws.root)).toBe(state);
    mark("history.restore");
    await restore(ws, before[0]?.oid as string);
    expect(readRecords(ws, "workout")[0]).toEqual(added.record);
    const versions = await history(ws);
    mark("storage.disable");
    await disableDrive(ws);
    mark("storage.disabled");
    // 从 ~/kaitu 开的同步，关掉后搬回 ~/kaitu，不改成新默认名。
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
    mark("cleanup.begin");
    vi.unstubAllEnvs();
    rmSync(home, { recursive: true, force: true });
    mark("cleanup.files-removed");
  }
});

// 云盘只留占位文件时（大小非零、没有数据块），同步读会一直等云盘下载；打开工作区不能读它。
it.skipIf(process.platform === "win32")("Drive 里还没下载的文件不会卡住打开工作区", async (context) => {
  const mark = lifecycle(context);
  mark("setup.begin");
  const home = tmp();
  vi.stubEnv("HOME", home);
  vi.stubEnv("XDG_STATE_HOME", join(home, "state"));
  vi.stubEnv("LOCALAPPDATA", join(home, "local"));
  vi.stubEnv("KAITU_DIR", "");
  try {
    const drive = join(home, "Library/CloudStorage/GoogleDrive-x/我的云端硬盘");
    mkdirSync(drive, { recursive: true });
    const ws = await initWorkspace(join(home, "kaitu"));
    mark("workspace.ready");
    mark("storage.enable");
    await enableDrive(ws, { driveDir: drive });
    const file = ws.resolve("learning/module.json");
    rmSync(file);
    const fd = openSync(file, "w");
    ftruncateSync(fd, 379);
    closeSync(fd);
    expect(statSync(file).blocks).toBe(0);
    const reopened = new Workspace(ws.root);
    expect(() => reopened.readText("learning/module.json")).toThrow("还没从云盘下载");
    expect(listModules(reopened).some((module) => module.dir === "me")).toBe(true);
  } finally {
    mark("cleanup.begin");
    vi.unstubAllEnvs();
  }
});

it.skipIf(process.platform === "win32")("Drive 里有文件没下载时，页面照常读出其余内容", async (context) => {
  const mark = lifecycle(context);
  mark("setup.begin");
  const home = tmp();
  vi.stubEnv("HOME", home);
  vi.stubEnv("XDG_STATE_HOME", join(home, "state"));
  vi.stubEnv("LOCALAPPDATA", join(home, "local"));
  vi.stubEnv("KAITU_DIR", "");
  try {
    const drive = join(home, "Library/CloudStorage/GoogleDrive-x/我的云端硬盘");
    mkdirSync(drive, { recursive: true });
    const ws = await initWorkspace(join(home, "kaitu"));
    mark("workspace.ready");
    mark("storage.enable");
    await enableDrive(ws, { driveDir: drive });
    const note = (await captureNote(ws, "随手记一条")).path;
    await createProject(ws, { title: "合成项目", slug: "synthetic", kind: "work" });
    for (const file of ["NOW.md", note, "projects/synthetic/log.md"]) {
      const path = ws.resolve(file);
      rmSync(path, { force: true });
      const fd = openSync(path, "w");
      ftruncateSync(fd, 200);
      closeSync(fd);
    }
    const reopened = new Workspace(ws.root);
    expect(readLibrary(reopened).inbox.some((entry) => entry.file === note)).toBe(false);
    expect(readCalendar(reopened)).toBeTruthy();
    expect(readProject(reopened, "synthetic").log).toBe("");
    expect(calendarPushEntries(reopened)).toEqual([]);
  } finally {
    mark("cleanup.begin");
    vi.unstubAllEnvs();
  }
});
