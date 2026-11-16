import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { Context } from "@deepseek-ai/cordis";
import { history, isTracked, snapshot, startLearning } from "@kaitu/core";
import { expect, it, vi } from "vitest";
import { freshWorkspace } from "../../core/test/helpers.js";
import { KaituOverviewService } from "../src/overview-service.js";
vi.mock("@kaitu/core", async (original) => {
  const core = await original<typeof import("@kaitu/core")>();
  return { ...core, snapshot: vi.fn(core.snapshot) };
});
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
it.each(["learningStart", "learningSave", "captureOnce"] as const)(
  "%s returns saved files first, but immediate disposal waits for its version",
  async (method) => {
    const ws = await freshWorkspace();
    if (method === "learningSave") await startLearning(ws, { title: "Synthetic learning" });
    const before = (await history(ws)).length;
    const ctx = new Context();
    let pending: Promise<unknown> = Promise.resolve();
    const queue = <T>(run: () => Promise<T>) => {
      const next = pending.then(run);
      pending = next.catch(() => {});
      return next;
    };
    ctx.effect(() => () => queue(async () => {}));
    const service = new KaituOverviewService(ctx, {}, ws, queue);
    const actual = await vi.importActual<typeof import("@kaitu/core")>("@kaitu/core");
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.mocked(snapshot).mockImplementation(async (...args) => {
      await gate;
      return actual.snapshot(...args);
    });
    let closing: Promise<unknown> | undefined;
    try {
      const result =
        method === "learningStart"
          ? await service.learningStart({ title: "Synthetic learning" })
          : method === "captureOnce"
            ? await service.captureOnce("Synthetic original", randomUUID())
            : await service.learningSave({
                topic: "synthetic-learning",
                operationId: "synthetic-close-0001",
                understanding: "Synthetic saved learning",
                questions: "",
                next: "",
              });
      const file = "path" in result ? result.path : "learning/synthetic-learning/STATUS.md";
      if (!file) throw new Error("Missing saved file");
      expect(ws.exists(file)).toBe(true);
      let closed = false;
      closing = ctx.fiber.dispose().then(() => {
        closed = true;
      });
      await tick();
      await tick();
      expect(closed).toBe(false);
      expect((await history(ws)).length).toBe(before);
      release();
      await closing;
      expect((await history(ws)).length).toBe(before + 1);
      expect(await isTracked(ws, file)).toBe(true);
      await expect(service.learningStart({ title: "Late write" })).rejects.toThrow("已关闭");
    } finally {
      release();
      await closing;
      await ctx.fiber.dispose();
      await pending;
      vi.mocked(snapshot).mockImplementation(actual.snapshot);
      rmSync(ws.root, { recursive: true, force: true });
    }
  },
);
it("default executor drains an accepted write on immediate disposal and reports version failure", async () => {
  const ws = await freshWorkspace();
  const ctx = new Context();
  const service = new KaituOverviewService(ctx, {}, ws);
  const actual = await vi.importActual<typeof import("@kaitu/core")>("@kaitu/core");
  vi.mocked(snapshot).mockRejectedValue(Object.assign(new Error("Synthetic no space"), { code: "ENOSPC" }));
  const warning = vi.spyOn(ctx.logger, "warn");
  const writing = service.learningStart({ title: "Synthetic failure" });
  const closing = ctx.fiber.dispose();
  // Cordis logs effect failures rather than rejecting its outer dispose promise.
  try {
    const saved = await writing;
    expect(saved.version).toBeNull();
    await closing;
    expect(warning).toHaveBeenCalledWith(expect.stringContaining("Synthetic no space"));
    expect(ws.exists("learning/synthetic-failure/STATUS.md")).toBe(true);
    vi.mocked(snapshot).mockImplementation(actual.snapshot);
    await actual.snapshot(ws, "Retry synthetic version");
    expect(await isTracked(ws, "learning/synthetic-failure/STATUS.md")).toBe(true);
  } finally {
    vi.mocked(snapshot).mockImplementation(actual.snapshot);
    rmSync(ws.root, { recursive: true, force: true });
  }
});
