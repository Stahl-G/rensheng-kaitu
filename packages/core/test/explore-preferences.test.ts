import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { readPreferences, resolvePreferences, savePreferences } from "../src/index.js";
import { freshWorkspace } from "./helpers.js";

it("入口顺序、全隐藏及重新启用持久化，跟随系统语言仍保留入口", async () => {
  const state = mkdtempSync(join(tmpdir(), "kaitu-explore-preferences-"));
  vi.stubEnv("KAITU_LOCAL_STATE_DIR", state);
  try {
    const ws = await freshWorkspace();
    expect(readPreferences().exploreEntries).toBeUndefined();
    savePreferences({ locale: null, exploreEntries: ["news", "footprints", "health"] });
    expect(resolvePreferences(ws, "en-US")).toMatchObject({
      locale: "en",
      followSystem: true,
      exploreEntries: ["news", "footprints", "health"],
    });
    savePreferences({ exploreEntries: [] });
    expect(resolvePreferences(ws, "zh-CN").exploreEntries).toEqual([]);
    savePreferences({ locale: "en" });
    expect(readPreferences().exploreEntries).toEqual([]);
    savePreferences({ exploreEntries: ["health", "news"] });
    expect(readPreferences()).toEqual({ locale: "en", exploreEntries: ["health", "news"] });
  } finally {
    vi.unstubAllEnvs();
    rmSync(state, { recursive: true, force: true });
  }
});

it("重复入口被入口校验拒绝，已保存的顺序和语言保持原样", () => {
  const state = mkdtempSync(join(tmpdir(), "kaitu-explore-preferences-"));
  vi.stubEnv("KAITU_LOCAL_STATE_DIR", state);
  try {
    const saved = savePreferences({ locale: "zh-CN", exploreEntries: ["health"] });
    expect(() => savePreferences({ exploreEntries: ["health", "health"] })).toThrow("界面偏好不合法");
    expect(readPreferences()).toEqual(saved);
  } finally {
    vi.unstubAllEnvs();
    rmSync(state, { recursive: true, force: true });
  }
});
