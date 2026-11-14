import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { Worker } from "node:worker_threads";
import { expect, it, vi } from "vitest";
import { createHomeCache } from "../src/home-cache.js";
import { addRecord, readRecords } from "../src/records.js";
import { freshWorkspace } from "./helpers.js";

it("derives documents only after accepting current home data and retains bad-row checks", async () => {
  const ws = await freshWorkspace();
  const task = addRecord(ws, "task", { title: "Obsolete home task" });
  addRecord(ws, "task", { title: "Obsolete home task", due: "2026-01-01", status: "open" }, { by: "user" });
  const path = ws.resolve(task.file);
  const current = readFileSync(path, "utf8").replaceAll("Obsolete home task", "Current home task");
  const badLine = current.trimEnd().split("\n").length + 1;
  let cache: ReturnType<typeof createHomeCache> | undefined;
  let obsolete: number | undefined;
  const summaryGenerations: number[] = [];
  const emit = Worker.prototype.emit;
  // Change the actual source immediately before the owner receives its first real worker result.
  // This makes rejection deterministic without replacing the worker or its computed payload.
  const delivery = vi.spyOn(Worker.prototype, "emit").mockImplementation(function (
    this: Worker,
    event,
    ...args
  ) {
    if (event === "message") {
      const message = args[0] as { generation: number; data?: unknown; summary?: unknown };
      if (message.data && obsolete === undefined) {
        obsolete = message.generation;
        writeFileSync(path, current);
        cache?.invalidate();
      }
      if (message.summary) summaryGenerations.push(message.generation);
    }
    return emit.call(this, event, ...args);
  });
  const errors: unknown[] = [];
  cache = createHomeCache(ws, () => {}, {
    write: (operation) => operation(),
    report: (error) => errors.push(error),
  });
  try {
    await expect
      .poll(() => cache?.read().data?.pending[0]?.title, { timeout: 15000 })
      .toBe("Current home task");
    await expect.poll(() => ws.readText("OVERVIEW.md"), { timeout: 15000 }).toContain("Current home task");
    expect(obsolete).toBeDefined();
    expect(summaryGenerations.length).toBeGreaterThan(0);
    expect(summaryGenerations).not.toContain(obsolete);
    expect(ws.readText("OVERVIEW.md")).not.toContain("Obsolete home task");

    writeFileSync(path, `${current.trimEnd()}\n{broken\n`);
    cache.invalidate();
    await expect
      .poll(() => cache?.read().presentation?.warnings, { timeout: 15000 })
      .toContainEqual(
        expect.objectContaining({ code: "invalid_record", location: `${task.file}:${badLine}` }),
      );
    expect(cache.read().data?.pending[0]?.title).toBe("Current home task");
    expect(() => readRecords(ws, "task")).toThrow();
    writeFileSync(path, current);
    cache.invalidate();
    await expect.poll(() => cache?.read().presentation?.warnings, { timeout: 15000 }).toEqual([]);
    expect(readRecords(ws, "task").some((row) => row.title === "Current home task")).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await cache.close();
    delivery.mockRestore();
    rmSync(ws.root, { recursive: true, force: true });
  }
});
