import { readFileSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { Context } from "@deepseek-ai/cordis";
import { history, readRecords } from "@kaitu/core";
import { expect, it } from "vitest";
import { freshWorkspace } from "../../core/test/helpers.js";
import { KaituOverviewService } from "../src/overview-service.js";

it("日历和 Nut AI 沿同一用户确认服务完成预览、取消、确认及重复跳过", async () => {
  for (const [source, name, types] of [
    ["ics", "calendar.ics", ["event"]],
    ["nut-ai", "nut-ai-backup.json", ["meal", "metric"]],
  ] as const) {
    const ws = await freshWorkspace();
    const ctx = new Context();
    try {
      const ui = new KaituOverviewService(ctx, { workspace: ws.root });
      const bytes = readFileSync(new URL(`../../../examples/${name}`, import.meta.url));
      const counts = () => types.map((type) => readRecords(ws, type).length);
      const before = await history(ws);
      const cancelled = await ui.onboardingImportPreview(source, name, bytes.toString("base64"));
      expect(cancelled.preview.added).toBeGreaterThan(0);
      expect(counts()).toEqual(types.map(() => 0));
      expect(await history(ws)).toEqual(before);
      await ui.onboardingCancel(cancelled.token);
      await expect(ui.onboardingImportConfirm(cancelled.token)).rejects.toThrow();
      expect(counts()).toEqual(types.map(() => 0));
      expect(await history(ws)).toEqual(before);
      const preview = await ui.onboardingImportPreview(source, name, bytes.toString("base64"));
      const result = await ui.onboardingImportConfirm(preview.token);
      expect(counts().reduce((a, b) => a + b, 0)).toBe(result.result.added);
      await expect(ui.onboardingImportConfirm(preview.token)).rejects.toThrow();
      const saved = counts();
      const duplicate = await ui.onboardingImportPreview(source, name, bytes.toString("base64"));
      expect(duplicate.preview.added).toBe(0);
      expect(duplicate.preview.skipped).toBe(result.result.added);
      await ui.onboardingImportConfirm(duplicate.token);
      expect(counts()).toEqual(saved);
    } finally {
      await ctx.fiber.dispose();
      rmSync(dirname(ws.root), { recursive: true, force: true });
    }
  }
});
