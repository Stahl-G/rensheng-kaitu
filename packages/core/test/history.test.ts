import fs, { cpSync, existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import git from "isomorphic-git";
import { describe, expect, it, vi } from "vitest";
import { pendingWorkspaceFiles } from "../src/history.js";
import {
  Workspace,
  addRecord,
  deferSnapshots,
  doctor,
  history,
  historyDirectory,
  inboxNoteDone,
  invalidateHistoryFile,
  isTracked,
  readRecords,
  restore,
  snapshot,
  snapshotNow,
} from "../src/index.js";
import { clonedWorkspace, tmp, workout } from "./helpers.js";

it("另一台电脑打开同步资料时，没有本机版本库也能读取并建立首个版本", async () => {
  const original = await clonedWorkspace();
  original.writeText("me/profile.md", "# 合成跨设备档案\n");
  const root = join(tmp(), "GoogleDrive-test", "我的云端硬盘", "kaitu");
  cpSync(original.root, root, {
    recursive: true,
    filter: (path) => {
      const file = relative(original.root, path).replaceAll("\\", "/");
      return !file.startsWith(".kaitu/") || file === ".kaitu/config.json";
    },
  });
  const opened = new Workspace(root);
  expect(await history(opened)).toEqual([]);
  expect(await pendingWorkspaceFiles(opened)).toContain("me/profile.md");
  await snapshot(opened, "这台电脑的首个版本");
  expect(await history(opened)).toHaveLength(1);
  expect(opened.readText("me/profile.md")).toBe("# 合成跨设备档案\n");
  expect((await history(original))[0]?.message).toBe("初始化开图工作区");
});

it("后台版本保留同长度改写、追加记录、删除与收件箱归档，恢复可读回", async () => {
  const ws = await clonedWorkspace();
  const file = "me/synthetic.md";
  const note = "inbox/notes/2026-10-24/synthetic.note.md";
  ws.writeText(file, "before\n");
  ws.writeText("me/synthetic-delete.txt", "合成删除前\n");
  ws.writeText(note, "合成待归档原文\n");
  const before = await snapshotNow(ws, "改动前");
  deferSnapshots(ws, () => {});
  ws.writeText(file, "after!\n");
  addRecord(ws, "workout", workout);
  const moved = await inboxNoteDone(ws, note);
  ws.writeText(file, "final!\n");
  fs.rmSync(ws.resolve("me/synthetic-delete.txt"));
  invalidateHistoryFile(ws, "me/synthetic-delete.txt");
  await snapshotNow(ws, "后台保存", undefined, { changedOnly: true });
  const head = (await history(ws))[0]?.oid as string;
  const { blob } = await git.readBlob({
    fs,
    dir: ws.root,
    gitdir: historyDirectory(ws),
    oid: head,
    filepath: file,
  });
  expect(Buffer.from(blob).toString()).toBe("final!\n");
  expect(await isTracked(ws, note)).toBe(false);
  expect(await isTracked(ws, moved.path)).toBe(true);
  expect(await isTracked(ws, "me/synthetic-delete.txt")).toBe(false);
  expect(readRecords(ws, "workout")).toHaveLength(1);
  await restore(ws, before as string);
  expect(ws.readText(note)).toContain("合成待归档原文");
  expect(ws.readText(file)).toBe("before\n");
  expect(readRecords(ws, "workout")).toEqual([]);
});

it("后台保存的未知事件和 ignore 变化仍盘点未报告的文件，敏感索引项仍移出", async () => {
  const ws = await clonedWorkspace();
  const ignored = "me/synthetic-ignore.txt";
  ws.writeText(".gitignore", `${ws.readText(".gitignore")}\n${ignored}\n`);
  ws.writeText(ignored, "合成内容\n");
  await snapshotNow(ws, "忽略文件");
  expect(await isTracked(ws, ignored)).toBe(false);
  ws.writeText(".gitignore", ws.readText(".gitignore").replace(`${ignored}\n`, ""));
  await snapshotNow(ws, "更新忽略规则", undefined, { changedOnly: true });
  expect(await isTracked(ws, ignored)).toBe(true);
  writeFileSync(ws.resolve("me/unreported.txt"), "合成外部改动\n");
  invalidateHistoryFile(ws, "工作区");
  await snapshotNow(ws, "未知事件", undefined, { changedOnly: true });
  expect(await isTracked(ws, "me/unreported.txt")).toBe(true);
  await git.add({
    fs,
    dir: ws.root,
    gitdir: historyDirectory(ws),
    filepath: ".kaitu/secrets.json",
    force: true,
  });
  writeFileSync(ws.resolve("me/staged.txt"), "合成已暂存内容\n");
  await git.add({ fs, dir: ws.root, gitdir: historyDirectory(ws), filepath: "me/staged.txt" });
  ws.writeText("me/synthetic.md", "普通改动\n");
  const commit = vi.spyOn(git, "commit").mockRejectedValueOnce(new Error("synthetic commit failure"));
  try {
    await expect(snapshotNow(ws, "失败的后台保存", undefined, { changedOnly: true })).rejects.toThrow(
      "synthetic commit failure",
    );
  } finally {
    commit.mockRestore();
  }
  await snapshotNow(ws, "清理敏感索引", undefined, { changedOnly: true });
  expect(await isTracked(ws, ".kaitu/secrets.json")).toBe(false);
  expect(await isTracked(ws, "me/staged.txt")).toBe(true);
});

it("暂不提交的外部原文在下一次显式后台保存时一并进入版本", async () => {
  const ws = await clonedWorkspace();
  const external = "inbox/notes/2026-10-24/external.note.md";
  const own = "inbox/notes/2026-10-24/own.note.md";
  ws.writeText(external, "合成外部原文\n");
  expect(await snapshotNow(ws, () => null, undefined, { changedOnly: true })).toBeNull();
  expect(await isTracked(ws, external)).toBe(false);
  ws.writeText(own, "合成用户原文\n");
  await snapshotNow(ws, "保存原文", undefined, { changedOnly: true });
  expect(await isTracked(ws, external)).toBe(true);
  expect(await isTracked(ws, own)).toBe(true);
});

describe("版本历史", () => {
  it("每次写入可回看，按路径过滤", async () => {
    const ws = await clonedWorkspace();
    addRecord(ws, "workout", workout);
    await snapshot(ws, "记录训练");
    ws.writeText("me/profile.md", "# 档案\n\n新内容\n");
    await snapshot(ws, "改档案");
    expect(await snapshot(ws, "无改动")).toBeNull();

    expect((await history(ws)).map((v) => v.message)).toEqual(["改档案", "记录训练", "初始化开图工作区"]);
    expect((await history(ws, { path: "me/profile.md" })).map((v) => v.message)).toEqual([
      "改档案",
      "初始化开图工作区",
    ]);
  });

  it("恢复整个工作区，并且恢复本身可以撤销", async () => {
    const ws = await clonedWorkspace();
    const [init] = await history(ws);
    addRecord(ws, "workout", workout);
    await snapshot(ws, "记录训练");

    await restore(ws, init?.short as string);
    expect(readRecords(ws, "workout")).toEqual([]);
    expect(ws.exists("health/data/workouts/2026-10.jsonl")).toBe(false);

    const versions = await history(ws);
    expect(versions[0]?.message).toMatch(/^恢复到版本/);
    const beforeRestore = versions.find((v) => v.message === "记录训练");
    await restore(ws, beforeRestore?.oid as string);
    expect(readRecords(ws, "workout")).toHaveLength(1);
  });

  it("只恢复一个路径时其他文件不变", async () => {
    const ws = await clonedWorkspace();
    const [init] = await history(ws);
    ws.writeText("me/profile.md", "改过的档案\n");
    addRecord(ws, "workout", workout);
    await snapshot(ws, "两处改动");

    await restore(ws, init?.oid as string, { path: "me" });
    expect(ws.readText("me/profile.md")).toMatch(/^# 档案/);
    expect(readRecords(ws, "workout")).toHaveLength(1);
  });

  it("恢复二进制文件不损坏", async () => {
    const ws = await clonedWorkspace();
    const bytes = Buffer.from([0x25, 0x50, 0x44, 0x46, 0xff, 0x00, 0xfe, 0x80]);
    ws.writeText("health/files/report.pdf", bytes);
    await snapshot(ws, "体检原件");
    const [v] = await history(ws);
    ws.writeText("health/files/report.pdf", "坏了");
    await snapshot(ws, "覆盖");
    await restore(ws, v?.oid as string, { path: "health/files/report.pdf" });
    expect(Buffer.compare(readFileSync(join(ws.root, "health/files/report.pdf")), bytes)).toBe(0);
  });

  it("密钥、索引、缓存不进版本历史，即使 .gitignore 被删", async () => {
    const ws = await clonedWorkspace();
    ws.writeJson(".kaitu/secrets.json", { oura: "secret-token" }, { internal: true, mode: 0o600 });
    ws.writeText(".kaitu/index.sqlite", "db", { internal: true });
    ws.writeText(".kaitu/cache/feed.json", "{}", { internal: true });
    writeFileSync(join(ws.root, ".gitignore"), "");
    await snapshot(ws, "尝试");
    for (const p of [".kaitu/secrets.json", ".kaitu/index.sqlite", ".kaitu/cache/feed.json"]) {
      expect(await isTracked(ws, p), p).toBe(false);
    }
    expect(await isTracked(ws, ".kaitu/config.json")).toBe(true);
  });

  it("恢复不会动密钥文件", async () => {
    const ws = await clonedWorkspace();
    const [init] = await history(ws);
    ws.writeJson(".kaitu/secrets.json", { oura: "t" }, { internal: true, mode: 0o600 });
    await restore(ws, init?.oid as string);
    expect(ws.readJson(".kaitu/secrets.json")).toEqual({ oura: "t" });
  });
});

it("旧版本库打开即迁移，历史不丢且可恢复，版本库不跟踪自身", async () => {
  const ws = await clonedWorkspace();
  const [initial] = await history(ws);
  ws.writeText("me/profile.md", "迁移前修改\n");
  await snapshot(ws, "迁移前");
  const before = await history(ws);
  writeFileSync(join(ws.root, ".gitignore"), ".kaitu/secrets.json\n.kaitu/index.sqlite\n.kaitu/cache/\n");
  renameSync(join(ws.root, ".kaitu/history.git"), join(ws.root, ".git"));
  const opened = new Workspace(ws.root);
  expect(existsSync(join(ws.root, ".git"))).toBe(false);
  expect(await history(opened)).toEqual(before);
  expect((await doctor(opened)).every((check) => check.ok)).toBe(true);
  await restore(opened, initial?.oid as string);
  expect(opened.readText("me/profile.md")).toMatch(/^# 档案/);
  expect(await isTracked(opened, ".kaitu/history.git/HEAD")).toBe(false);
});
