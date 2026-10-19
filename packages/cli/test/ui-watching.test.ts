import fs, { mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type Workspace,
  history,
  historyDirectory,
  initWorkspace,
  isTracked,
  pendingWorkspaceFiles,
} from "@kaitu/core";
import { expect, it, vi } from "vitest";
import { startUi } from "../src/ui/server.js";

vi.mock("node:fs", async (original) => ({
  ...(await original<typeof import("node:fs")>()),
  watch: () => {
    throw Object.assign(new Error("Synthetic native watch unavailable"), { code: "EMFILE" });
  },
}));

const git = createRequire(new URL("../../core/package.json", import.meta.url))("isomorphic-git");

async function latestText(ws: Workspace) {
  const { blob } = await git.readBlob({
    fs,
    dir: ws.root,
    gitdir: historyDirectory(ws),
    oid: (await history(ws))[0]?.oid,
    filepath: "me/synthetic.md",
  });
  return Buffer.from(blob).toString("utf8");
}

it("原生监听不可用时，启动前改动与后续外部编辑、删除仍在后台保存，敏感状态不入历史", async () => {
  const root = mkdtempSync(join(tmpdir(), "kaitu-ui-polling-"));
  let ui: Awaited<ReturnType<typeof startUi>> | undefined;
  try {
    const ws = await initWorkspace(root);
    const before = (await history(ws)).length;
    writeFileSync(join(root, "me/synthetic.md"), "before\n");
    ui = await startUi(ws, {
      port: 0,
      open: false,
      snapshotDelayMs: 80,
      refreshDelayMs: 10,
      inboxStableMs: 30,
    });
    expect((await fetch(ui.url)).status).toBe(200);
    await expect.poll(async () => (await history(ws)).length).toBe(before + 1);
    expect(await latestText(ws)).toBe("before\n");
    const old = new Date(Date.now() - 10000);
    writeFileSync(join(root, "me/synthetic.md"), "after!\n");
    utimesSync(join(root, "me/synthetic.md"), old, old);
    await expect.poll(async () => (await history(ws)).length).toBe(before + 2);
    expect(await latestText(ws)).toBe("after!\n");
    rmSync(join(root, "me/synthetic.md"));
    ws.writeJson(".kaitu/secrets.json", { synthetic: "never-version-this" }, { internal: true });
    await expect.poll(async () => (await history(ws)).length).toBe(before + 3);
    expect(await isTracked(ws, "me/synthetic.md")).toBe(false);
    expect(await isTracked(ws, ".kaitu/secrets.json")).toBe(false);
    expect(await pendingWorkspaceFiles(ws)).toEqual([]);
  } finally {
    await ui?.close();
    rmSync(root, { recursive: true, force: true });
  }
});

it("startup 版本出现后，同秒同长度改写并恢复精确 mtime 仍保存真实内容", async () => {
  const root = mkdtempSync(join(tmpdir(), "kaitu-ui-startup-race-"));
  const path = join(root, "me/synthetic.md");
  let ui: Awaited<ReturnType<typeof startUi>> | undefined;
  // 固定 ctime 的整秒部分，保留亚秒变化，确定性覆盖 Git 秒级 stat 缓存命中。
  const lstat = fs.promises.lstat;
  const spy = vi.spyOn(fs.promises, "lstat").mockImplementation((async (
    ...args: Parameters<typeof lstat>
  ) => {
    const stat = await lstat(...args);
    if (String(args[0]) === path) stat.ctimeMs = 1700000000000 + (Number(stat.ctimeMs) % 1000);
    return stat;
  }) as typeof lstat);
  try {
    const ws = await initWorkspace(root);
    const before = (await history(ws)).length;
    writeFileSync(path, "before\n");
    const stable = Math.floor(Date.now() / 1000) - 20;
    utimesSync(path, stable, stable);
    ui = await startUi(ws, {
      port: 0,
      open: false,
      refreshDelayMs: 10,
      versionDelayMs: 80,
      snapshotDelayMs: 80,
      inboxStableMs: 30,
    });
    await expect.poll(async () => (await history(ws)).length, { interval: 5 }).toBe(before + 1);
    const stat = statSync(path);
    writeFileSync(path, "after!\n");
    utimesSync(path, stat.atimeMs / 1000, stat.mtimeMs / 1000);
    expect(statSync(path).mtimeMs).toBe(stat.mtimeMs);
    expect(statSync(path).size).toBe(stat.size);
    await expect.poll(() => latestText(ws)).toBe("after!\n");
    expect((await history(ws)).length).toBe(before + 2);
    await ui.close();
    ui = undefined;
    expect(await latestText(ws)).toBe(ws.readText("me/synthetic.md"));
  } finally {
    await ui?.close();
    spy.mockRestore();
    rmSync(root, { recursive: true, force: true });
  }
});

it("持续编辑跨过保存窗口时，停止输入前已有真实版本，随后内容全部追上", async () => {
  const root = mkdtempSync(join(tmpdir(), "kaitu-ui-continuous-"));
  let ui: Awaited<ReturnType<typeof startUi>> | undefined;
  let editing: ReturnType<typeof setInterval> | undefined;
  try {
    const ws = await initWorkspace(root);
    const before = (await history(ws))[0]?.oid;
    const written = new Set<string>();
    let sequence = 0;
    const edit = () => {
      const value = `synthetic ${++sequence}\n`;
      written.add(value);
      writeFileSync(join(root, "me/synthetic.md"), value);
    };
    ui = await startUi(ws, {
      port: 0,
      open: false,
      snapshotDelayMs: 500,
      refreshDelayMs: 30,
    });
    edit();
    editing = setInterval(edit, 100);
    await expect.poll(async () => (await history(ws))[0]?.oid, { timeout: 1800 }).not.toBe(before);
    expect(written.has(await latestText(ws))).toBe(true);
    clearInterval(editing);
    editing = undefined;
    const final = "synthetic final\n";
    writeFileSync(join(root, "me/synthetic.md"), final);
    await expect.poll(() => latestText(ws)).toBe(final);
    expect(await pendingWorkspaceFiles(ws)).toEqual([]);
  } finally {
    clearInterval(editing);
    await ui?.close();
    rmSync(root, { recursive: true, force: true });
  }
});
