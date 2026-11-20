import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { Context } from "@deepseek-ai/cordis";
import { history, isTracked, snapshotNow, startLearning } from "@kaitu/core";
import { expect, it, vi } from "vitest";
import { freshWorkspace } from "../../core/test/helpers.js";
import { KaituOverviewService } from "../src/overview-service.js";

vi.mock("@kaitu/core", async (original) => {
  const core = await original<typeof import("@kaitu/core")>();
  return { ...core, snapshotNow: vi.fn(core.snapshotNow) };
});

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

it.each(["captureOnce", "learningStart", "learningSave"] as const)(
  "%s 的文件先返回，版本仍在当前写入队列中，关闭等待版本落盘并拒绝之后的写入",
  async (method) => {
    const ws = await freshWorkspace();
    if (method === "learningSave") await startLearning(ws, { title: "Synthetic learning" });
    const before = (await history(ws)).length;
    const ctx = new Context();
    // Same shape as the plugin's FIFO write queue, which drains itself on dispose.
    let pending: Promise<unknown> = Promise.resolve();
    const queue = <T>(run: () => Promise<T>) => {
      const next = pending.then(run);
      pending = next.catch(() => {});
      return next;
    };
    ctx.effect(() => () => queue(async () => {}));
    const service = new KaituOverviewService(ctx, {}, ws, queue, undefined, { home: null });
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const original = await vi.importActual<typeof import("@kaitu/core")>("@kaitu/core");
    vi.mocked(snapshotNow).mockImplementation(async (...args) => {
      await blocked;
      return original.snapshotNow(...args);
    });
    try {
      const result =
        method === "captureOnce"
          ? await service.captureOnce("Synthetic note", randomUUID())
          : method === "learningStart"
            ? await service.learningStart({ title: "Synthetic learning" })
            : await service.learningSave({
                topic: "synthetic-learning",
                operationId: "synthetic-checkin-1",
                understanding: "Synthetic understanding",
                questions: "",
                next: "Synthetic next step",
              });
      const file = "path" in result ? result.path : "learning/synthetic-learning/STATUS.md";
      if (!file) throw new Error("Missing saved file");
      expect(ws.exists(file)).toBe(true);
      // Even the version's synchronous scan starts after the caller receives its result.
      expect(snapshotNow).not.toHaveBeenCalled();
      let settled = false;
      let disposed = false;
      const waiting = service.settled().then(() => {
        settled = true;
      });
      const closing = ctx.fiber.dispose().then(() => {
        disposed = true;
      });
      await tick();
      expect(snapshotNow).toHaveBeenCalledTimes(1);
      expect(settled).toBe(false);
      expect(disposed).toBe(false);
      expect((await history(ws)).length).toBe(before);
      release();
      await waiting;
      await closing;
      expect((await history(ws)).length).toBe(before + 1);
      expect(await isTracked(ws, file)).toBe(true);
      await expect(service.learningStart({ title: "Late write" })).rejects.toThrow("已关闭");
    } finally {
      release();
      await tick();
      await service.settled();
      await ctx.fiber.dispose();
      vi.mocked(snapshotNow).mockReset();
      rmSync(ws.root, { recursive: true, force: true });
    }
  },
);

it("an accepted write drains on immediate disposal; a failed version is logged and the file kept", async () => {
  const ws = await freshWorkspace();
  const ctx = new Context();
  const service = new KaituOverviewService(ctx, {}, ws, undefined, undefined, { home: null });
  const original = await vi.importActual<typeof import("@kaitu/core")>("@kaitu/core");
  vi.mocked(snapshotNow).mockRejectedValue(
    Object.assign(new Error("Synthetic no space"), { code: "ENOSPC" }),
  );
  const warning = vi.spyOn(ctx.logger, "warn");
  try {
    const writing = service.learningStart({ title: "Synthetic failure" });
    const closing = ctx.fiber.dispose();
    const saved = await writing;
    expect(saved.version).toBeNull();
    await closing;
    expect(warning).toHaveBeenCalledWith(expect.stringContaining("Synthetic no space"));
    expect(ws.exists("learning/synthetic-failure/STATUS.md")).toBe(true);
    await original.snapshotNow(ws, "Retry synthetic version");
    expect(await isTracked(ws, "learning/synthetic-failure/STATUS.md")).toBe(true);
  } finally {
    vi.mocked(snapshotNow).mockReset();
    rmSync(ws.root, { recursive: true, force: true });
  }
});
