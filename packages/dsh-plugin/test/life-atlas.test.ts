import { settings } from "@kaitu/cartographer/settings";
import { type LifeAtlasState, readPreferences, savePreferences } from "@kaitu/core";
import { createElement } from "react";
import { type ReactTestRenderer, act, create } from "react-test-renderer";
import { expect, test, vi } from "vitest";
import { LifeAtlasPage, atlasLabel, mapAvailableHeight } from "../src/client/LifeAtlasPage.js";
import {
  defaultExploreEntries,
  exploreDestination,
  migrateLifeMapFirst,
} from "../src/client/explore-modules.js";

test("map height stays stable when its scroll container moves", () => {
  expect(mapAvailableHeight(800, 300, 0)).toBe(484);
  expect(mapAvailableHeight(800, 100, 200)).toBe(484);
  expect(mapAvailableHeight(600, 300, 0)).toBe(284);
});

test("map-first migration persists across restarts and preserves later reorder or hiding", () => {
  const root = mkdtempSync(join(tmpdir(), "kaitu-map-pref-"));
  vi.stubEnv("KAITU_LOCAL_STATE_DIR", root);
  try {
    savePreferences({ locale: null, exploreEntries: ["news", "health", "life-map"] });
    const migration = migrateLifeMapFirst(readPreferences());
    expect(migration?.exploreEntries).toEqual(["life-map", "news", "health"]);
    savePreferences(migration ?? {});
    savePreferences({ exploreEntries: ["health", "news"] });
    const entry = new URL("../../core/dist/index.js", import.meta.url).href;
    const reopened = JSON.parse(
      execFileSync(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          `import {readPreferences} from ${JSON.stringify(entry)}; console.log(JSON.stringify(readPreferences()))`,
        ],
        { encoding: "utf8" },
      ),
    );
    expect(reopened.exploreEntries).toEqual(["health", "news"]);
    expect(migrateLifeMapFirst(reopened)).toBeNull();
    savePreferences({ exploreEntries: [] });
    expect(migrateLifeMapFirst(readPreferences())).toBeNull();
    expect(readPreferences().exploreEntries).toEqual([]);
  } finally {
    vi.unstubAllEnvs();
    rmSync(root, { recursive: true, force: true });
  }
});

test("new Explore default is the map; explicit user ordering and empty selection still work", () => {
  const empty = { hometown: false, experiences: 0, healthRecords: 0, newsTopics: 0, goals: 0, directions: 0 };
  expect(exploreDestination(defaultExploreEntries, empty)).toBe("life-map");
  expect(exploreDestination(["health", "life-map"], { ...empty, healthRecords: 1 })).toBe("health");
  expect(exploreDestination([], empty)).toBe("modules");
  expect(exploreDestination(defaultExploreEntries, empty, ["footprints", "health"])).toBe("modules");
});

test("existing map collapses controls and keyboard activation opens the correct domain", async () => {
  const config = settings();
  const value: LifeAtlasState = {
    resourceId: "one",
    storage: { count: 2, bytes: 1000, maxCount: 50, maxBytes: 512 * 1024 ** 2 },
    loading: false,
    running: false,
    progress: 0,
    error: null,
    active: "one",
    latest: null,
    candidates: [
      {
        id: "one",
        createdAt: "2026-10-20T00:00:00Z",
        seed: "test",
        variant: 0,
        settings: config,
        domains: ["health"],
        slots: { health: 0 },
      },
    ],
    modules: [{ id: "health", title: "健康", available: true, recommended: true }],
    gaps: [],
    coverage: 0.5,
    resource: {
      key: "synthetic",
      seed: "test",
      variant: 0,
      settings: config,
      generator: "test",
      upstream: "test",
      regionVersion: "test",
      svg: '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"/>',
      width: 800,
      height: 600,
      margin: 20,
      compass: { cx: 700, cy: 500, r: 60 },
      terrainCacheHit: true,
      regions: {
        provinces: [{ slot: 0, path: "M0 0L300 0L150 200Z", x: 150, y: 100, cells: 10 }],
        borders: "",
        land: "",
        mainLandShare: 1,
      },
    },
    domains: [
      {
        id: "health",
        title: "健康",
        facts: [
          {
            id: "walk",
            title: "合成测试散步计划",
            kind: "plan",
            status: "planned",
            source: "health/STATUS.md",
          },
        ],
        temporal: { kind: "live", cadenceDays: 14 },
        facets: [],
        slot: 0,
        score: { coverage: 0.5, freshness: null, clarity: 0.5, latest: null, missing: [] },
      },
    ],
  };
  value.candidates.push({ ...value.candidates[0], id: "old", archived: true });
  const change = vi.fn(async () => ({ ...value, candidates: [value.candidates[0]] }));
  const load = vi.fn(async () => value);
  const generate = vi.fn(async () => ({
    ...value,
    latest: "older-candidate",
    error: "Synthetic save failed",
  }));
  let root!: ReactTestRenderer;
  await act(async () => {
    root = create(
      createElement(LifeAtlasPage, {
        loadLifeAtlas: load,
        generateLifeAtlas: generate,
        changeLifeAtlas: change,
      }),
    );
  });
  expect(root.root.findAllByType("fieldset")).toHaveLength(0);
  const svg = () => root.root.findByProps({ "aria-label": "人生地图区域" });
  const fitWidth = svg().props.style.width;
  act(() => root.root.findByProps({ "aria-label": "放大地图" }).props.onClick());
  expect(svg().props.style.width).not.toBe(fitWidth);
  expect(generate).not.toHaveBeenCalled();
  act(() =>
    root.root
      .findByType("nav")
      .findAllByType("button")
      .find((button) => button.children.includes("适应窗口"))
      ?.props.onClick(),
  );
  expect(svg().props.style.width).toBe(fitWidth);
  expect(change).not.toHaveBeenCalled();
  const region = root.root.findByProps({ role: "button" });
  act(() => region.props.onKeyDown({ key: "Enter", preventDefault() {} }));
  expect(root.root.findByType("aside").props["aria-label"]).toBe("健康");
  expect(JSON.stringify(root.toJSON())).toContain("合成测试散步计划");
  act(() => root.root.findByType("aside").props.onKeyDown({ key: "Escape" }));
  expect(root.root.findAllByType("aside")).toHaveLength(0);
  act(() =>
    root.root
      .findAllByType("button")
      .find((button) => button.children.includes("调整地图"))
      ?.props.onClick(),
  );
  await act(async () => {
    await root.root
      .findAllByType("button")
      .find((button) => button.children.includes("生成新方案并保存"))
      ?.props.onClick();
  });
  expect(generate).toHaveBeenCalled();
  expect(load).not.toHaveBeenCalledWith("older-candidate", false);
  expect(JSON.stringify(root.toJSON())).toContain("Synthetic save failed");
  act(() =>
    root.root
      .findAllByType("button")
      .find((b) => b.children.includes("地图存档"))
      ?.props.onClick(),
  );
  act(() =>
    root.root
      .findAllByType("button")
      .find((b) => b.children.includes("永久删除"))
      ?.props.onClick(),
  );
  expect(root.root.findByProps({ role: "alertdialog" })).toBeTruthy();
  expect(change).not.toHaveBeenCalled();
  act(() =>
    root.root
      .findAllByType("button")
      .find((b) => b.children.includes("取消"))
      ?.props.onClick(),
  );
  expect(change).not.toHaveBeenCalled();
  act(() =>
    root.root
      .findAllByType("button")
      .find((b) => b.children.includes("永久删除"))
      ?.props.onClick(),
  );
  await act(async () => {
    await root.root
      .findAllByType("button")
      .find((b) => b.children.includes("确认永久删除"))
      ?.props.onClick();
  });
  expect(change).toHaveBeenCalledWith("old", "delete");
  act(() => root.unmount());
  expect(atlasLabel("很长的中文模块名称需要保持可读而且不能超出边界")).toHaveLength(2);
  expect(atlasLabel("很长的中文模块名称需要保持可读而且不能超出边界")[1]).toMatch(/…$/);
});
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
