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

it.each(["captureOnce", "learningStart", "learningSave"] as const)(
  "%s 的文件先返回，版本仍在当前写入队列中，关闭等待版本落盘",
  async (method) => {
    const ws = await freshWorkspace();
    if (method === "learningSave") await startLearning(ws, { title: "Synthetic learning" });
    const before = (await history(ws)).length;
    const ctx = new Context();
    const service = new KaituOverviewService(ctx, {}, ws, undefined, undefined, { home: null });
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
      // A timer that has not registered its work cannot be drained on shutdown.
      expect(snapshotNow).toHaveBeenCalledTimes(1);
      let settled = false;
      let disposed = false;
      const waiting = service.settled().then(() => {
        settled = true;
      });
      const closing = ctx.fiber.dispose().then(() => {
        disposed = true;
      });
      await Promise.resolve();
      expect(settled).toBe(false);
      expect(disposed).toBe(false);
      release();
      await waiting;
      await closing;
      expect((await history(ws)).length).toBe(before + 1);
      expect(await isTracked(ws, file)).toBe(true);
    } finally {
      release();
      await new Promise<void>((resolve) => setImmediate(resolve));
      await service.settled();
      await ctx.fiber.dispose();
      vi.mocked(snapshotNow).mockReset();
      rmSync(ws.root, { recursive: true, force: true });
    }
  },
);
