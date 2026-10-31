import { createHash } from "node:crypto";
import { chmodSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Worker } from "node:worker_threads";
import { expect, it, vi } from "vitest";
import { history, historyDirectory } from "../src/history.js";
import { type HomeState, createHomeCache } from "../src/home-cache.js";
import { projectionDirectory, readProjection, writeProjection } from "../src/projection-cache.js";
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
    expect(JSON.parse(cache.readSerialized())).toEqual(cache.read());
    expect(notifications).toBeGreaterThanOrEqual(2);
    await cache.close();
    const count = notifications;
    cache.invalidate();
    expect(notifications).toBe(count);
    if (!directory) throw new Error("Projection cache missing");
    expect(directory?.startsWith(ws.root)).toBe(false);
    const stateRoot = process.env.KAITU_LOCAL_STATE_DIR;
    const alias = join(dirname(ws.root), "cache-alias");
    symlinkSync(ws.root, alias, "junction");
    try {
      process.env.KAITU_LOCAL_STATE_DIR = alias;
      expect(projectionDirectory({ root: ws.root, state: join(ws.root, ".kaitu") })).toBeUndefined();
    } finally {
      process.env.KAITU_LOCAL_STATE_DIR = stateRoot;
      rmSync(alias);
    }
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
    expect(JSON.parse(cache.readSerialized())).toEqual(cache.read());
    await expect.poll(() => cache.read().data?.pending[0]?.title, { timeout: 15000 }).toBe("External change");
    await cache.close();
    const head = (await history(ws))[0]?.oid;
    if (!head) throw new Error("Expected history");
    const commit = join(historyDirectory(ws), "objects", head.slice(0, 2), head.slice(2));
    const savedCommit = readFileSync(commit);
    const unrelated = join(dirname(commit), "unused-history-blob");
    try {
      writeFileSync(unrelated, "not referenced by the version list");
      cache = createHomeCache(ws, () => notifications++);
      expect(cache.read()).toMatchObject({ loading: false, error: null });
      expect(cache.read().data?.pending[0]?.title).toBe("External change");
      await cache.close();
    } finally {
      rmSync(unrelated, { force: true });
    }
    try {
      writeFileSync(commit, "corrupt commit object");
      cache = createHomeCache(ws, () => notifications++);
      expect(cache.read().loading).toBe(true);
      await expect.poll(() => cache.read().error, { timeout: 15000 }).toBe("首页读取失败");
      expect(cache.read().data).toBeNull();
    } finally {
      writeFileSync(commit, savedCommit);
    }
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

it("rebuilds the previous projection format and then reuses the current home cache", async () => {
  const ws = await freshWorkspace();
  addRecord(ws, "metric", { kind: "weight", value: 71, unit: "kg", source: "synthetic scale" });
  const input = {
    root: ws.root,
    state: dirname(ws.resolve(".kaitu/cache", { internal: true })),
  };
  let cache = createHomeCache(ws, () => {});
  try {
    await expect.poll(() => cache.read().loading, { timeout: 15000 }).toBe(false);
    const previous = readProjection<Pick<HomeState, "data" | "presentation">>(input, "home");
    if (!previous?.value.data) throw new Error("Expected saved home projection");
    await cache.close();
    writeProjection(input, "home", {
      ...previous,
      value: {
        ...previous.value,
        data: {
          ...previous.value.data,
          traces: Array.from({ length: 3 }, (_, i) => ({
            key: `version:legacy-${i}`,
            kind: "version" as const,
            date: previous.day,
            label: "Synthetic legacy system save",
            value: null,
            unit: null,
            estimated: false,
            sourceFiles: [],
          })),
        },
      },
    });
    expect(readProjection(input, "home")).toBeDefined();
    const directory = projectionDirectory(input);
    if (!directory) throw new Error("Expected local projection directory");
    const file = join(directory, "home.json");
    const envelope = JSON.parse(readFileSync(file, "utf8"));
    const content = JSON.stringify({ ...JSON.parse(envelope.content), version: 4 });
    writeFileSync(
      file,
      JSON.stringify({ checksum: createHash("sha256").update(content).digest("hex"), content }),
    );
    expect(readProjection(input, "home")).toBeUndefined();
    cache = createHomeCache(ws, () => {});
    expect(cache.read()).toMatchObject({ data: null, loading: true });
    await expect.poll(() => cache.read().loading, { timeout: 15000 }).toBe(false);
    expect(cache.read().data?.traces).toEqual([
      expect.objectContaining({ kind: "metric", value: 71, unit: "kg" }),
    ]);
    await cache.close();
    cache = createHomeCache(ws, () => {});
    expect(cache.read()).toMatchObject({ loading: false, error: null });
    expect(cache.read().data?.traces).toEqual([
      expect.objectContaining({ kind: "metric", value: 71, unit: "kg" }),
    ]);
  } finally {
    await cache.close();
    rmSync(ws.root, { recursive: true, force: true });
  }
});

it("retains the worker between updates and waits for its termination on close", async () => {
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
    expect(stopping).not.toHaveBeenCalled();
    let closed = false;
    const close = Promise.resolve(cache.close()).then(() => {
      closed = true;
    });
    expect(stopping).toHaveBeenCalledOnce();
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
