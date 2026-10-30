import { chmodSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { Worker } from "node:worker_threads";
import { expect, it, vi } from "vitest";
import { createHomeCache } from "../src/home-cache.js";
import { projectionDirectory } from "../src/projection-cache.js";
import { addRecord } from "../src/records.js";
import { freshWorkspace } from "./helpers.js";

it("publishes background data, retains it during refresh, and discards obsolete loads", async () => {
  const ws = await freshWorkspace();
  let notifications = 0;
  let cache = createHomeCache(ws, () => notifications++);
  const originalRoot = ws.root;
  const directory = projectionDirectory({
    root: ws.root,
    state: dirname(ws.resolve(".kaitu/cache", { internal: true })),
  });
  let other: Awaited<ReturnType<typeof freshWorkspace>> | undefined;
  try {
    expect(cache.read()).toMatchObject({ data: null, loading: true });
    await expect.poll(() => cache.read().loading, { timeout: 15000 }).toBe(false);
    expect(cache.read().error).toBeNull();
    const original = cache.read().data;
    ws.writeJson("me/goals.json", [{ id: "a", title: "first", status: "active" }]);
    cache.invalidate();
    expect(cache.read().data).toBe(original);
    ws.writeJson("me/goals.json", [{ id: "b", title: "latest", status: "active" }]);
    cache.invalidate();
    await expect.poll(() => cache.read().data?.threads[0]?.title, { timeout: 15000 }).toBe("latest");
    expect(cache.read().loading).toBe(false);
    expect(notifications).toBeGreaterThanOrEqual(2);
    await cache.close();
    const count = notifications;
    cache.invalidate();
    expect(notifications).toBe(count);
    if (!directory) throw new Error("Projection cache missing");
    expect(directory?.startsWith(ws.root)).toBe(false);
    cache = createHomeCache(ws, () => notifications++);
    expect(cache.read()).toMatchObject({ loading: false, error: null });
    expect(cache.read().data?.threads[0]?.title).toBe("latest");

    const task = addRecord(ws, "task", { title: "Original candidate" });
    const path = ws.resolve(task.file);
    const changed = readFileSync(path, "utf8").replace("Original candidate", "External change");
    writeFileSync(path, changed);
    await expect.poll(() => cache.read().data?.pending[0]?.title, { timeout: 15000 }).toBe("External change");
    writeFileSync(path, `${changed.trimEnd()}\n{broken\n`);
    await expect
      .poll(() => cache.read().presentation?.warnings, { timeout: 15000 })
      .toContainEqual(expect.objectContaining({ code: "invalid_record", location: `${task.file}:2` }));
    expect(cache.read().data?.pending[0]?.title).toBe("External change");
    if (process.platform !== "win32") {
      try {
        chmodSync(path, 0);
        await expect.poll(() => cache.read().error, { timeout: 15000 }).toBe("首页读取失败");
        expect(cache.read().data).toBeNull();
      } finally {
        chmodSync(path, 0o600);
      }
    }
    writeFileSync(path, changed);
    await expect.poll(() => cache.read().presentation?.warnings, { timeout: 15000 }).toEqual([]);
    await cache.close();
    rmSync(directory, { recursive: true, force: true });
    cache = createHomeCache(ws, () => notifications++);
    expect(cache.read()).toMatchObject({ loading: true, data: null });
    await expect.poll(() => cache.read().data?.pending[0]?.title, { timeout: 15000 }).toBe("External change");
    other = await freshWorkspace();
    ws.root = other.root;
    expect(cache.read()).toMatchObject({ loading: true, data: null });
    await expect.poll(() => cache.read().data?.threads, { timeout: 15000 }).toEqual([]);
  } finally {
    await cache.close();
    rmSync(originalRoot, { recursive: true, force: true });
    if (other) rmSync(other.root, { recursive: true, force: true });
  }
});

it("close waits for workers still retiring after publishing their result", async () => {
  const ws = await freshWorkspace();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const terminate = Worker.prototype.terminate;
  const stopping = vi.spyOn(Worker.prototype, "terminate").mockImplementation(function (this: Worker) {
    return gate.then(() => terminate.call(this));
  });
  const cache = createHomeCache(ws, () => {});
  try {
    await expect.poll(() => cache.read().loading, { timeout: 15000 }).toBe(false);
    expect(stopping).toHaveBeenCalled();
    let closed = false;
    const close = Promise.resolve(cache.close()).then(() => {
      closed = true;
    });
    await Promise.resolve();
    expect(closed).toBe(false);
    release();
    await close;
    expect(closed).toBe(true);
  } finally {
    release();
    await cache.close();
    stopping.mockRestore();
    rmSync(ws.root, { recursive: true, force: true });
  }
});
