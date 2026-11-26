import { readFileSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { Context } from "@deepseek-ai/cordis";
import { history, readRecords } from "@kaitu/core";
import { afterEach, expect, it, vi } from "vitest";
import { freshWorkspace, zipSync } from "../../core/test/helpers.js";
import { detectFileImportSource, normalizeGithubRepo } from "../src/client/file-import-source.js";
import { KaituOverviewService } from "../src/overview-service.js";

afterEach(() => {
  vi.useRealTimers();
});

it("日历和 Nut AI 沿同一用户确认服务完成预览、取消、确认及重复跳过", async () => {
  // 日历只导入今天前 30 天到后 180 天；示例日历的事件在 2026 年 10 月。
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-15T12:00:00+08:00"));
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

it("根据外层 ZIP 的真实目录识别可导入的来源，混合导出时交给用户选择", async () => {
  const archive = (entries: Record<string, Uint8Array>) =>
    new File([Uint8Array.from(zipSync(entries))], "export.zip");
  const health = { "apple_health_export/export.xml": new Uint8Array() };
  const chat = { "nested/conversations.json": new Uint8Array() };
  expect(await detectFileImportSource(archive(health))).toBe("apple-health");
  expect(await detectFileImportSource(archive(chat))).toBe("chatgpt-conversations");
  expect(await detectFileImportSource(archive({ ...health, ...chat }))).toBe("choose");
  expect(await detectFileImportSource(archive({ "nested.zip": zipSync(chat) }))).toBe("choose");
});

it("粘贴 GitHub 的仓库或分支网址时保留仓库名", () => {
  expect(normalizeGithubRepo("https://github.com/Stahl-G/rensheng-kaitu.git")).toBe("Stahl-G/rensheng-kaitu");
  expect(normalizeGithubRepo("https://github.com/Stahl-G/rensheng-kaitu/tree/main")).toBe(
    "Stahl-G/rensheng-kaitu",
  );
  expect(normalizeGithubRepo("  Stahl-G/rensheng-kaitu  ")).toBe("Stahl-G/rensheng-kaitu");
});
