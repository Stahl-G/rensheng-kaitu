import { type FSWatcher, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { setImmediate } from "node:timers/promises";
import { history, readLifeAtlas } from "@kaitu/core";
import { expect, it, vi } from "vitest";
import { freshWorkspace } from "../../core/test/helpers.js";
import { startUi } from "../src/ui/server.js";

const active = vi.hoisted(() => new Map<FSWatcher, string>());
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

it("closes old directory listeners before moving and observes real edits at the new root", async ({
  onTestFailed,
}) => {
  const started = performance.now();
  const stages: [string, number][] = [];
  const mark = (stage: string) => void stages.push([stage, performance.now() - started]);
  onTestFailed(() => console.error("ui-watchers-stages", { stages, elapsedMs: performance.now() - started }));
  mark("workspace");
  const ws = await freshWorkspace();
  const root = dirname(ws.root);
  const source = ws.root;
  const state = dirname(ws.resolve(".kaitu/cache", { internal: true }));
  let paused = false;
  mark("start-ui");
  const ui = await startUi(ws, {
    port: 0,
    open: false,
    onWorkspaceChanging: async () => {
      mark("changing-hook");
      await setImmediate();
      expect([...active.values()]).not.toContain(source);
      expect([...active.values()]).not.toContain(state);
      paused = true;
    },
    onWorkspaceChanged: () => mark("resumed"),
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
  const errors: unknown[] = [];
  try {
    mark("old-search");
    ws.writeText(file, "---\ntitle: 合成决定\n---\n迁移前正文");
    expect(await search("迁移前")).toHaveLength(1);
    mark("old-home");
    await expect.poll(home, { timeout: 15000 }).not.toBeNull();
    expect([...active.values()]).toContain(source);
    expect([...active.values()]).toContain(state);
    const target = join(root, "cloud");
    mark("move-request");
    expect((await post("moveStorage", [target, true, "nutstore"])).status).toBe(200);
    expect(paused).toBe(true);
    expect(ws.root).toBe(target);
    // Let the resumed projection settle before external edits, so a startup read cannot mask missing watchers.
    mark("resumed-home");
    await expect
      .poll(async () => (await post("home", []).then((response) => response.json())).loading, {
        timeout: 15000,
      })
      .toBe(false);
    mark("resumed-search");
    expect(await search("迁移前")).toHaveLength(1);
    writeFileSync(ws.resolve(file), "---\ntitle: 合成决定\n---\n新目录正文");
    writeFileSync(
      ws.resolve("me/goals.json"),
      JSON.stringify([{ id: "a", title: "新目录目标", status: "active" }]),
    );
    mark("external-search");
    await expect.poll(() => search("新目录")).toHaveLength(1);
    mark("external-home");
    await expect.poll(async () => (await home())?.threads[0]?.title, { timeout: 15000 }).toBe("新目录目标");
  } catch (error) {
    errors.push(error);
  }
  try {
    mark("close");
    await ui.close();
    mark("cleanup");
    await setImmediate();
    expect([...active.values()]).not.toContain(ws.root);
    expect([...active.values()]).not.toContain(dirname(ws.resolve(".kaitu/cache", { internal: true })));
    rmSync(root, { recursive: true, force: true });
  } catch (error) {
    errors.push(error);
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, "Watcher body and cleanup failed");
});

it("refreshes an already open atlas after restoring a version at the same root", async () => {
  const ws = await freshWorkspace();
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
