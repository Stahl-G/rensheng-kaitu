import { type FSWatcher, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { setImmediate } from "node:timers/promises";
import { history, readLifeAtlas } from "@kaitu/core";
import { expect, it, vi } from "vitest";
import { freshWorkspace } from "../../core/test/helpers.js";
import { startUi } from "../src/ui/server.js";

const active = vi.hoisted(() => new Map<FSWatcher, string>());
const shutdown = vi.hoisted(() => ({ error: undefined as Error | undefined }));
vi.mock("../../core/src/note-search.js", async (original) => {
  const notes = await original<typeof import("../../core/src/note-search.js")>();
  return {
    ...notes,
    disposeNoteIndex: async (ws: Parameters<typeof notes.disposeNoteIndex>[0]) => {
      await notes.disposeNoteIndex(ws);
      if (shutdown.error) throw shutdown.error;
    },
  };
});
vi.mock("node:fs", async (original) => {
  const fs = await original<typeof import("node:fs")>();
  return {
    ...fs,
    watch: (...args: Parameters<typeof fs.watch>) => {
      const watcher = fs.watch(...args);
      active.set(watcher, String(args[0]));
      watcher.once("close", () => active.delete(watcher));
      return watcher;
    },
  };
});

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

it("closes old directory listeners before moving and observes real edits at the new root", async (context) => {
  const mark = lifecycle(context);
  mark("setup.begin");
  const ws = await freshWorkspace();
  mark("workspace.ready");
  const root = dirname(ws.root);
  const source = ws.root;
  const state = dirname(ws.resolve(".kaitu/cache", { internal: true }));
  let paused = false;
  const ui = await startUi(ws, {
    port: 0,
    open: false,
    onWorkspaceChanging: async () => {
      await setImmediate();
      expect([...active.values()]).not.toContain(source);
      expect([...active.values()]).not.toContain(state);
      paused = true;
    },
  });
  const post = (method: string, args: unknown[]) =>
    fetch(`${ui.url}/api/product/${method}`, {
      method: "POST",
      headers: { "X-Kaitu": "1", Origin: ui.url },
      body: JSON.stringify(args),
    });
  const home = async () => (await post("home", []).then((response) => response.json())).data;
  const search = async (term: string) => {
    const response = await post("searchLibraryNotes", [term]);
    expect(response.status).toBe(200);
    return response.json();
  };
  const file = "decisions/synthetic/STATUS.md";
  const failures: unknown[] = [];
  try {
    ws.writeText(file, "---\ntitle: 合成决定\n---\n迁移前正文");
    mark("ui.search");
    expect(await search("迁移前")).toHaveLength(1);
    mark("ui.home.wait");
    await expect.poll(home, { timeout: 15000 }).not.toBeNull();
    expect([...active.values()]).toContain(source);
    expect([...active.values()]).toContain(state);
    const target = join(root, "cloud");
    mark("storage.move");
    expect((await post("moveStorage", [target, true, "nutstore"])).status).toBe(200);
    mark("storage.moved");
    expect(paused).toBe(true);
    expect(ws.root).toBe(target);
    mark("projection.resume.wait");
    // Let the resumed projection settle before external edits, so a startup read cannot mask missing watchers.
    await expect
      .poll(async () => (await post("home", []).then((response) => response.json())).loading, {
        timeout: 15000,
      })
      .toBe(false);
    mark("ui.search");
    expect(await search("迁移前")).toHaveLength(1);
    writeFileSync(ws.resolve(file), "---\ntitle: 合成决定\n---\n新目录正文");
    writeFileSync(
      ws.resolve("me/goals.json"),
      JSON.stringify([{ id: "a", title: "新目录目标", status: "active" }]),
    );
    mark("ui.external-search.wait");
    await expect.poll(() => search("新目录")).toHaveLength(1);
    mark("ui.external-home.wait");
    await expect.poll(async () => (await home())?.threads[0]?.title, { timeout: 15000 }).toBe("新目录目标");
    shutdown.error = new Error("synthetic index shutdown failure");
  } catch (error) {
    failures.push(error);
  } finally {
    mark("cleanup.begin");
    try {
      if (shutdown.error) await expect(ui.close()).rejects.toBe(shutdown.error);
      else await ui.close();
      mark("cleanup.server-closed");
      await expect(fetch(ui.url)).rejects.toThrow();
    } catch (error) {
      failures.push(error);
      shutdown.error = undefined;
      // Only clean up a server proved still listening; preserve any assertion failure.
      if (
        await fetch(ui.url).then(
          () => true,
          () => false,
        )
      ) {
        try {
          await ui.close();
        } catch (cleanupError) {
          failures.push(cleanupError);
        }
      }
    } finally {
      shutdown.error = undefined;
    }
    try {
      await setImmediate();
      expect([...active.values()]).not.toContain(ws.root);
      expect([...active.values()]).not.toContain(dirname(ws.resolve(".kaitu/cache", { internal: true })));
      rmSync(root, { recursive: true, force: true });
      mark("cleanup.files-removed");
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 1) throw new AggregateError(failures, "UI lifecycle and cleanup failed");
  if (failures.length) throw failures[0];
});

it("refreshes an already open atlas after restoring a version at the same root", async (context) => {
  const mark = lifecycle(context);
  mark("setup.begin");
  const ws = await freshWorkspace();
  mark("workspace.ready");
  const source = ws.root;
  const version = (await history(ws))[0]?.oid;
  const moduleFile = "learning/module.json";
  const module = ws.readJson<{ name: string }>(moduleFile);
  const ui = await startUi(ws, { port: 0, open: false });
  const title = () => readLifeAtlas(ws).modules.find((item) => item.id === "learning")?.title;
  try {
    await expect.poll(title, { timeout: 15000 }).toBe(module.name);
    writeFileSync(ws.resolve(moduleFile), JSON.stringify({ ...module, name: "合成改名" }));
    await expect.poll(title, { timeout: 15000 }).toBe("合成改名");
    const response = await fetch(`${ui.url}/api/product/restoreVersion`, {
      method: "POST",
      headers: { "X-Kaitu": "1", Origin: ui.url },
      body: JSON.stringify([version]),
    });
    expect(response.status).toBe(200);
    expect(ws.root).toBe(source);
    await expect.poll(title, { timeout: 15000 }).toBe(module.name);
  } finally {
    await ui.close();
    rmSync(dirname(source), { recursive: true, force: true });
  }
});
