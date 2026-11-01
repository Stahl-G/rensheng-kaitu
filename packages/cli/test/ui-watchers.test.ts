import fs, { type FSWatcher, renameSync, rmSync, watch, writeFileSync } from "node:fs";
import { opendir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { setImmediate } from "node:timers/promises";
import {
  createHomeCache,
  disposeNoteIndex,
  history,
  historyDirectory,
  isTracked,
  pauseNoteIndex,
  readLifeAtlas,
  resumeNoteIndex,
  searchLibraryNotes,
  workspaceFileStampsAsync,
} from "@kaitu/core";
import { afterEach, expect, it, vi } from "vitest";
import { freshWorkspace } from "../../core/test/helpers.js";
import { startUi } from "../src/ui/server.js";

vi.mock("node:fs", async (original) => {
  const fs = await original<typeof import("node:fs")>();
  return { ...fs, watch: vi.fn(fs.watch), renameSync: vi.fn(fs.renameSync) };
});
vi.mock("@kaitu/core", async (original) => {
  const core = await original<typeof import("@kaitu/core")>();
  return { ...core, workspaceFileStampsAsync: vi.fn(core.workspaceFileStampsAsync) };
});
const git = createRequire(new URL("../../core/package.json", import.meta.url))("isomorphic-git");
afterEach(() => vi.clearAllMocks());
function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve: () => resolve() };
}

function observeHandles() {
  const active = new Map<FSWatcher, string>();
  const original = vi.mocked(watch).getMockImplementation() as typeof watch;
  vi.mocked(watch).mockImplementation(((...args: Parameters<typeof watch>) => {
    const watcher = original(...args);
    active.set(watcher, String(args[0]));
    watcher.once("close", () => active.delete(watcher));
    return watcher;
  }) as typeof watch);
  return { active, restore: () => vi.mocked(watch).mockImplementation(original) };
}

it("pauses native home and note listeners, drains searches, and resumes once at the current root", async () => {
  const ws = await freshWorkspace();
  const other = await freshWorkspace();
  const originalRoot = ws.root;
  const handles = observeHandles();
  const home = createHomeCache(ws, () => {});
  const file = "decisions/synthetic/STATUS.md";
  try {
    ws.writeText(file, "---\ntitle: 合成决定\n---\n旧目录正文");
    const searching = searchLibraryNotes(ws, "正文");
    await Promise.all([home.pause(), pauseNoteIndex(ws)]);
    await Promise.all([home.pause(), pauseNoteIndex(ws)]);
    await setImmediate();
    expect(handles.active.size).toBe(0);
    ws.root = other.root;
    home.read();
    expect(handles.active.size).toBe(0);
    ws.writeText(file, "---\ntitle: 合成决定\n---\n新目录正文");
    const waiting = searchLibraryNotes(ws, "新目录正文");
    resumeNoteIndex(ws);
    home.resume();
    const starts = vi.mocked(watch).mock.calls.length;
    resumeNoteIndex(ws);
    home.resume();
    expect(vi.mocked(watch).mock.calls.length).toBe(starts);
    expect(await searching).toHaveLength(1);
    expect(await waiting).toHaveLength(1);
    expect(handles.active.size).toBe(3);
    expect([...handles.active.values()]).not.toContain(originalRoot);
    await expect.poll(() => home.read().loading, { timeout: 15000 }).toBe(false);
    writeFileSync(
      ws.resolve("me/goals.json"),
      JSON.stringify([{ id: "a", title: "外部目标", status: "active" }]),
    );
    writeFileSync(ws.resolve(file), "---\ntitle: 合成决定\n---\n恢复监听后的正文");
    await expect.poll(() => home.read().data?.threads[0]?.title, { timeout: 15000 }).toBe("外部目标");
    await expect.poll(() => searchLibraryNotes(ws, "恢复监听")).toHaveLength(1);
    await pauseNoteIndex(ws);
    const cancelled = expect(searchLibraryNotes(ws, "正文")).rejects.toMatchObject({
      code: "NOTE_SEARCH_UNAVAILABLE",
    });
    disposeNoteIndex(ws);
    await cancelled;
  } finally {
    resumeNoteIndex(ws);
    disposeNoteIndex(ws);
    disposeNoteIndex(ws);
    await home.close();
    await home.close();
    home.resume();
    await setImmediate();
    expect(handles.active.size).toBe(0);
    handles.restore();
    rmSync(dirname(originalRoot), { recursive: true, force: true });
    rmSync(dirname(other.root), { recursive: true, force: true });
  }
});

it("releases all UI directory listeners before migration and restores them after rollback and success", async () => {
  const ws = await freshWorkspace();
  const source = ws.root;
  const root = dirname(source);
  const handles = observeHandles();
  const originalRename = vi.mocked(renameSync).getMockImplementation() as typeof renameSync;
  let rejectMove = true;
  let migrations = 0;
  let closed = false;
  let closingMove: Promise<void> | undefined;
  const entered = gate();
  const releaseMove = gate();
  const releaseScan = gate();
  const ui = await startUi(ws, {
    port: 0,
    open: false,
    versionDelayMs: 20,
    snapshotDelayMs: 20,
    onWorkspaceChanging: async () => {
      await setImmediate();
      expect(handles.active.size).toBe(0);
      migrations++;
      if (closingMove) {
        entered.resolve();
        await closingMove;
      }
    },
  });
  const post = (path: string, body: unknown) =>
    fetch(`${ui.url}${path}`, {
      method: "POST",
      headers: { "X-Kaitu": "1", Origin: ui.url },
      body: JSON.stringify(body),
    });
  const search = async (term: string) => {
    const response = await post("/api/product/searchLibraryNotes", [term]);
    expect(response.status).toBe(200);
    return response.json();
  };
  const file = "decisions/synthetic/STATUS.md";
  try {
    ws.writeText(file, "---\ntitle: 合成决定\n---\n迁移前正文");
    expect(await search("迁移前")).toHaveLength(1);
    vi.mocked(renameSync).mockImplementation((from, to) => {
      if (String(from) === source && rejectMove) {
        rejectMove = false;
        throw Object.assign(new Error("synthetic workspace rename failure"), { code: "EACCES" });
      }
      originalRename(from, to);
    });
    const failed = await post("/api/sync/enable", { mode: "drive", dir: root, name: "cloud" });
    expect(failed.status).toBe(400);
    expect(await failed.json()).toHaveProperty("error");
    expect(rejectMove).toBe(false);
    expect(ws.root).toBe(source);
    for (const [index, path, body, target] of [
      [0, "/api/sync/enable", { mode: "drive", dir: root, name: "cloud" }, join(root, "cloud")],
      [1, "/api/drive/disable", { to: join(root, "back") }, join(root, "back")],
      [2, "/api/product/moveStorage", [join(root, "moved"), false, "local"], join(root, "moved")],
    ] as const) {
      // Raw writes must reach the resumed home cache, search index and automatic version watcher.
      writeFileSync(ws.resolve(file), `---\ntitle: 合成决定\n---\n恢复轮次${index}`);
      writeFileSync(
        ws.resolve("me/goals.json"),
        JSON.stringify([{ id: "a", title: `目标${index}`, status: "active" }]),
      );
      await expect.poll(() => search(`恢复轮次${index}`)).toHaveLength(1);
      await expect
        .poll(
          async () => {
            const response = await post("/api/product/home", []);
            return (await response.json()).data?.threads[0]?.title;
          },
          { timeout: 15000 },
        )
        .toBe(`目标${index}`);
      await expect.poll(() => isTracked(ws, file)).toBe(true);
      await expect
        .poll(async () => {
          const oid = (await history(ws))[0]?.oid;
          const { blob } = await git.readBlob({
            fs,
            dir: ws.root,
            gitdir: historyDirectory(ws),
            oid,
            filepath: file,
          });
          return Buffer.from(blob).toString();
        })
        .toContain(`恢复轮次${index}`);
      const response = await post(path, body);
      expect(response.status, await response.text()).toBe(200);
      expect(ws.root).toBe(target);
      await setImmediate();
      expect(handles.active.size).toBe(6);
      expect([...handles.active.values()].filter((path) => path === ws.root)).toHaveLength(4);
    }
    writeFileSync(ws.resolve(file), "---\ntitle: 合成决定\n---\n最终目录正文");
    await expect.poll(() => search("最终目录")).toHaveLength(1);
    expect(migrations).toBe(4);
    const version = (await history(ws))[0]?.oid;
    const moduleFile = "learning/module.json";
    const module = ws.readJson<{ name: string }>(moduleFile);
    ws.writeJson(moduleFile, { ...module, name: "合成改名" });
    const atlasTitle = () => readLifeAtlas(ws).modules.find((item) => item.id === "learning")?.title;
    await expect.poll(atlasTitle, { timeout: 15000 }).toBe("合成改名");
    expect((await post("/api/product/restoreVersion", [version])).status).toBe(200);
    await expect.poll(atlasTitle, { timeout: 15000 }).toBe(module.name);
    const scanning = gate();
    const aborted = gate();
    vi.mocked(workspaceFileStampsAsync).mockImplementationOnce(async (workspace, { signal } = {}) => {
      const directory = await opendir(workspace.root);
      signal?.addEventListener("abort", aborted.resolve, { once: true });
      scanning.resolve();
      await releaseScan.promise;
      await directory.close();
      return new Map();
    });
    const retired = [...handles.active.keys()];
    for (const [watcher, path] of handles.active)
      if (path === ws.root) watcher.emit("error", new Error("synthetic watch failure"));
    await scanning.promise;
    closingMove = releaseMove.promise;
    const moving = post("/api/product/moveStorage", [join(root, "closed"), false, "local"]);
    await aborted.promise;
    await expect.poll(() => handles.active.size).toBe(0);
    await setImmediate();
    expect(migrations).toBe(4);
    for (const watcher of retired) watcher.emit("error", new Error("late synthetic watch error"));
    expect(vi.mocked(workspaceFileStampsAsync)).toHaveBeenCalledTimes(1);
    releaseScan.resolve();
    await entered.promise;
    const closing = ui.close();
    closed = true;
    releaseMove.resolve();
    expect((await moving).status).toBe(200);
    await closing;
    await setImmediate();
    expect(handles.active.size).toBe(0);
  } finally {
    releaseScan.resolve();
    releaseMove.resolve();
    vi.mocked(renameSync).mockImplementation(originalRename);
    if (!closed) await ui.close();
    await setImmediate();
    expect(handles.active.size).toBe(0);
    handles.restore();
    rmSync(root, { recursive: true, force: true });
  }
});
