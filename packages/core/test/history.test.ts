import fs, {
  cpSync,
  chmodSync,
  mkdirSync,
  existsSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { join, relative } from "node:path";
import git from "isomorphic-git";
import { describe, expect, it, vi } from "vitest";
import {
  historyDirectory,
  invalidateHistoryFile,
  pendingWorkspaceFiles,
  snapshotNow,
} from "../src/history.js";
import {
  Workspace,
  addRecord,
  doctor,
  history,
  isTracked,
  readRecords,
  restore,
  snapshot,
} from "../src/index.js";
import { freshWorkspace, tmp, workout } from "./helpers.js";

it("批量存版本遇到可降级权限错误时保留正文并可重试，混合未知错误仍抛出", async () => {
  const ws = await freshWorkspace();
  const files = ["me/readonly-a.md", "me/readonly-b.md"];
  const contents = ["真实批量权限回归 A\n", "真实批量权限回归 B\n"];
  const directories: string[] = [];
  for (const [i, file] of files.entries()) {
    ws.writeText(file, contents[i] as string);
    const { oid } = await git.hashBlob({ object: Buffer.from(contents[i] as string) });
    const dir = join(historyDirectory(ws), "objects", oid.slice(0, 2));
    mkdirSync(dir, { recursive: true });
    directories.push(dir);
  }
  // Windows 不使用 POSIX 目录写权限；该平台仍执行后面的真实未知错误与重试旅程。
  if (process.platform !== "win32") {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      for (const dir of directories) chmodSync(dir, 0o555);
      await expect(snapshot(ws, "只读对象目录")).resolves.toBeNull();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("数据已保存，版本稍后"));
      for (const [i, file] of files.entries()) expect(ws.readText(file)).toBe(contents[i]);
    } finally {
      for (const dir of directories) chmodSync(dir, 0o755);
      warn.mockRestore();
    }
  }
  // 把第二个对象的父目录变成普通文件，真实产生不可降级的路径冲突。
  const unknown = directories[1] as string;
  renameSync(unknown, `${unknown}.backup`);
  writeFileSync(unknown, "合成路径冲突\n");
  try {
    if (process.platform !== "win32") chmodSync(directories[0] as string, 0o555);
    const failure = await snapshot(ws, "权限与未知错误混合").catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    const errors = failure instanceof git.Errors.MultipleGitError ? failure.errors : [failure];
    expect(
      errors.some((error) =>
        ["ENOTDIR", "EEXIST", "ENOENT"].includes((error as NodeJS.ErrnoException).code ?? ""),
      ),
    ).toBe(true);
    if (process.platform !== "win32") {
      expect(failure).toBeInstanceOf(git.Errors.MultipleGitError);
      expect(errors.some((error) => (error as NodeJS.ErrnoException).code === "EACCES")).toBe(true);
    }
  } finally {
    chmodSync(directories[0] as string, 0o755);
    rmSync(unknown);
    renameSync(`${unknown}.backup`, unknown);
  }
  const oid = await snapshot(ws, "恢复对象目录后重试");
  expect(oid).toBeTruthy();
  for (const [i, filepath] of files.entries()) {
    const { blob } = await git.readBlob({
      fs,
      dir: ws.root,
      gitdir: historyDirectory(ws),
      oid: oid as string,
      filepath,
    });
    expect(Buffer.from(blob).toString()).toBe(contents[i]);
  }
});

it("另一台电脑打开同步资料时，没有本机版本库也能读取并建立首个版本", async () => {
  const original = await freshWorkspace();
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

describe("版本历史", () => {
  it("每次写入可回看，按路径过滤", async () => {
    const ws = await freshWorkspace();
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
    const batch = new Map([
      ["me/batch-a.md", "合成批量 A\n"],
      ["me/batch-b.md", "合成批量 B\n"],
    ]);
    for (const [file, text] of batch) ws.writeText(file, text);
    rmSync(ws.resolve("me/profile.md"));
    const oid = await snapshot(ws, "批量新增与删除");
    expect(await isTracked(ws, "me/profile.md")).toBe(false);
    for (const [filepath, text] of batch) {
      const { blob } = await git.readBlob({
        fs,
        dir: ws.root,
        gitdir: historyDirectory(ws),
        oid: oid as string,
        filepath,
      });
      expect(Buffer.from(blob).toString()).toBe(text);
    }
    const note = "inbox/notes/2026-10-20/synthetic-save-intent.md";
    ws.writeText(note, "显式原文保存与已经存好后的 no-op\n");
    const noteVersion = await snapshotNow(ws, (files, pending) => {
      expect(files).not.toContain(note);
      expect(pending).toBe(true);
      return "显式原文";
    });
    const { blob } = await git.readBlob({
      fs,
      dir: ws.root,
      gitdir: historyDirectory(ws),
      oid: noteVersion as string,
      filepath: note,
    });
    expect(Buffer.from(blob).toString()).toBe(ws.readText(note));
    expect(
      await snapshotNow(ws, (_files, pending) => {
        expect(pending).toBe(false);
        return null;
      }),
    ).toBeNull();
    expect((await history(ws))[0]?.oid).toBe(noteVersion);
  });

  it("恢复整个工作区，并且恢复本身可以撤销", async () => {
    const ws = await freshWorkspace();
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
    const ws = await freshWorkspace();
    const [init] = await history(ws);
    ws.writeText("me/profile.md", "改过的档案\n");
    addRecord(ws, "workout", workout);
    await snapshot(ws, "两处改动");

    await restore(ws, init?.oid as string, { path: "me" });
    expect(ws.readText("me/profile.md")).toMatch(/^# 档案/);
    expect(readRecords(ws, "workout")).toHaveLength(1);
  });

  it("恢复二进制文件不损坏", async () => {
    const ws = await freshWorkspace();
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
    const ws = await freshWorkspace();
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
    const ws = await freshWorkspace();
    const [init] = await history(ws);
    ws.writeJson(".kaitu/secrets.json", { oura: "t" }, { internal: true, mode: 0o600 });
    await restore(ws, init?.oid as string);
    expect(ws.readJson(".kaitu/secrets.json")).toEqual({ oura: "t" });
  });
});

it("旧版本库打开即迁移，历史不丢且可恢复，版本库不跟踪自身", async () => {
  const ws = await freshWorkspace();
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
