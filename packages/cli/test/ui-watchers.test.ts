import { type FSWatcher, renameSync, rmSync, watch, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { setImmediate } from "node:timers/promises";
import {
  createHomeCache,
  disposeNoteIndex,
  isTracked,
  pauseNoteIndex,
  resumeNoteIndex,
  searchLibraryNotes,
} from "@kaitu/core";
import { afterEach, expect, it, vi } from "vitest";
import { freshWorkspace } from "../../core/test/helpers.js";
import { startUi } from "../src/ui/server.js";

vi.mock("node:fs", async (original) => {
  const fs = await original<typeof import("node:fs")>();
  return { ...fs, watch: vi.fn(fs.watch), renameSync: vi.fn(fs.renameSync) };
});
afterEach(() => vi.clearAllMocks());

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
  let entered!: () => void;
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
        entered();
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
    let release!: () => void;
    closingMove = new Promise<void>((resolve) => {
      release = resolve;
    });
    const movingEntered = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const moving = post("/api/product/moveStorage", [join(root, "closed"), false, "local"]);
    await movingEntered;
    const closing = ui.close();
    closed = true;
    release();
    expect((await moving).status).toBe(200);
    await closing;
    await setImmediate();
    expect(handles.active.size).toBe(0);
  } finally {
    vi.mocked(renameSync).mockImplementation(originalRename);
    if (!closed) await ui.close();
    await setImmediate();
    expect(handles.active.size).toBe(0);
    handles.restore();
    rmSync(root, { recursive: true, force: true });
  }
});
