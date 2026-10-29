import { rmSync } from "node:fs";
import { Worker } from "node:worker_threads";
import { expect, it, vi } from "vitest";
import { createHomeCache } from "../src/home-cache.js";
import { freshWorkspace } from "./helpers.js";

it("publishes background data, retains it during refresh, and discards obsolete loads", async () => {
  const ws = await freshWorkspace();
  let notifications = 0;
  const cache = createHomeCache(ws, () => notifications++);
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
  } finally {
    await cache.close();
    rmSync(ws.root, { recursive: true, force: true });
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
