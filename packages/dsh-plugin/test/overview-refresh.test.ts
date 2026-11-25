import { expect, test, vi } from "vitest";
import { createOverviewRefresh } from "../src/client/overview-refresh.js";

test("notifications and simultaneous saves await one read started after their changes", async () => {
  let version = 0;
  const gates = Array.from({ length: 3 }, () => Promise.withResolvers<void>());
  const seen: number[] = [];
  const read = vi.fn(async () => {
    const snapshot = version;
    const gate = gates[read.mock.calls.length - 1];
    await gate.promise;
    seen.push(snapshot);
  });
  const reads = createOverviewRefresh(read);
  const initial = reads.refresh();
  await Promise.resolve();
  version = 1;
  const write = reads.refresh();
  version = 2;
  expect(reads.refresh()).toBe(write);
  expect(reads.refresh()).toBe(write);
  expect(read).toHaveBeenCalledTimes(1);
  let saved = false;
  void write.then(() => {
    saved = true;
  });
  gates[0].resolve();
  await initial;
  await Promise.resolve();
  expect(seen).toEqual([0]);
  expect(saved).toBe(false);
  expect(read).toHaveBeenCalledTimes(2);
  version = 3;
  const external = reads.refresh();
  gates[1].resolve();
  await write;
  expect(seen).toEqual([0, 2]);
  gates[2].resolve();
  await external;
  expect(seen).toEqual([0, 2, 3]);
});

test("changing workspaces retires the old read and its queued retry", async () => {
  const old = Promise.withResolvers<void>();
  const applied: string[] = [];
  const read = vi.fn(async (current: () => boolean) => {
    const first = read.mock.calls.length === 1;
    if (first) await old.promise;
    if (current()) applied.push(first ? "old" : "new");
  });
  const reads = createOverviewRefresh(read);
  const started = reads.refresh();
  await Promise.resolve();
  const queued = reads.refresh();
  reads.invalidate();
  await reads.refresh();
  old.resolve();
  await Promise.all([started, queued]);
  expect(applied).toEqual(["new"]);
  expect(read).toHaveBeenCalledTimes(2);
});

test("a failed read releases its queued retry", async () => {
  const first = Promise.withResolvers<void>();
  const read = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(undefined);
  const reads = createOverviewRefresh(read);
  const failure = reads.refresh();
  await Promise.resolve();
  const retry = reads.refresh();
  first.reject(new Error("offline"));
  await expect(failure).rejects.toThrow("offline");
  await retry;
  expect(read).toHaveBeenCalledTimes(2);
});
