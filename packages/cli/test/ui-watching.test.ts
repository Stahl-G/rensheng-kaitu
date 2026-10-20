import fs, { mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type Workspace,
  history,
  historyDirectory,
  inboxNotes,
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

it("监听不可用时持续编辑仍自动保存，保留 mtime 的最终内容可读回，退出保存删除且排除敏感状态", async () => {
  const root = mkdtempSync(join(tmpdir(), "kaitu-ui-continuous-"));
  let ui: Awaited<ReturnType<typeof startUi>> | undefined;
  let editing: ReturnType<typeof setInterval> | undefined;
  try {
    const ws = await initWorkspace(root);
    const before = (await history(ws))[0]?.oid;
    const written = new Set<string>();
    let sequence = 0;
    const edit = () => {
      const value = `synthetic ${String(++sequence).padStart(5, "0")}\n`;
      written.add(value);
      writeFileSync(join(root, "me/synthetic.md"), value);
    };
    edit();
    ui = await startUi(ws, {
      port: 0,
      open: false,
      snapshotDelayMs: 500,
      refreshDelayMs: 30,
    });
    expect((await fetch(ui.url)).status).toBe(200);
    editing = setInterval(edit, 100);
    await expect.poll(async () => (await history(ws))[0]?.oid, { timeout: 1800 }).not.toBe(before);
    expect(written.has(await latestText(ws))).toBe(true);
    clearInterval(editing);
    editing = undefined;
    const final = "synthetic final\n";
    const beforeEdit = statSync(join(root, "me/synthetic.md"));
    writeFileSync(join(root, "me/synthetic.md"), final);
    utimesSync(join(root, "me/synthetic.md"), beforeEdit.atimeMs / 1000, beforeEdit.mtimeMs / 1000);
    await expect.poll(() => latestText(ws)).toBe(final);
    ws.writeJson(".kaitu/secrets.json", { synthetic: "never-version-this" }, { internal: true });
    rmSync(join(root, "me/synthetic.md"));
    await ui.close();
    ui = undefined;
    expect(await isTracked(ws, "me/synthetic.md")).toBe(false);
    expect(await isTracked(ws, ".kaitu/secrets.json")).toBe(false);
    expect(await pendingWorkspaceFiles(ws)).toEqual([]);
  } finally {
    clearInterval(editing);
    await ui?.close();
    rmSync(root, { recursive: true, force: true });
  }
});

it("首次异步盘点期间收到的收件箱文件仍会自动处理", async () => {
  const root = mkdtempSync(join(tmpdir(), "kaitu-ui-inbox-baseline-"));
  let ui: Awaited<ReturnType<typeof startUi>> | undefined;
  let releaseScan = () => {};
  const scanHeld = new Promise<void>((resolve) => {
    releaseScan = resolve;
  });
  let signalScan!: () => void;
  const scanStarted = new Promise<void>((resolve) => {
    signalScan = resolve;
  });
  let opening: { mockRestore: () => void } | undefined;
  try {
    const ws = await initWorkspace(root);
    ws.writeText("inbox/agents/before.note.md", "合成初始原文");
    const actualOpendir = fs.promises.opendir.bind(fs.promises);
    let held = false;
    opening = vi.spyOn(fs.promises, "opendir").mockImplementation(async (path, options) => {
      if (!held && String(path).toLowerCase().includes("kaitu-ui-inbox-baseline-")) {
        held = true;
        signalScan();
        await scanHeld;
      }
      return actualOpendir(path, options);
    });
    ui = await startUi(ws, { port: 0, open: false, refreshDelayMs: 30, inboxStableMs: 0 });
    await scanStarted;
    await expect.poll(() => ws.exists("inbox/agents/before.note.md")).toBe(false);
    ws.writeText("inbox/agents/during.note.md", "合成盘点期间原文");
    releaseScan();
    await expect.poll(() => ws.exists("inbox/agents/during.note.md")).toBe(false);
    expect(inboxNotes(ws).some((note) => note.content.includes("合成盘点期间原文"))).toBe(true);
  } finally {
    releaseScan();
    opening?.mockRestore();
    await ui?.close();
    rmSync(root, { recursive: true, force: true });
  }
});
