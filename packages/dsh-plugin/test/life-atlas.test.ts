import { settings } from "@kaitu/cartographer/settings";
import type { LifeAtlasState } from "@kaitu/core";
import { createElement } from "react";
import { type ReactTestRenderer, act, create } from "react-test-renderer";
import { expect, test, vi } from "vitest";
import { LifeAtlasPage, atlasLabel } from "../src/client/LifeAtlasPage.js";
import { defaultExploreEntries, exploreDestination } from "../src/client/explore-modules.js";

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
  let root!: ReactTestRenderer;
  await act(async () => {
    root = create(
      createElement(LifeAtlasPage, {
        loadLifeAtlas: vi.fn(async () => value),
        generateLifeAtlas: vi.fn(),
        changeLifeAtlas: vi.fn(),
      }),
    );
  });
  expect(root.root.findAllByType("fieldset")).toHaveLength(0);
  const region = root.root.findByProps({ role: "button" });
  act(() => region.props.onKeyDown({ key: "Enter", preventDefault() {} }));
  expect(root.root.findByType("aside").props["aria-label"]).toBe("健康");
  expect(JSON.stringify(root.toJSON())).toContain("合成测试散步计划");
  act(() => root.root.findByType("aside").props.onKeyDown({ key: "Escape" }));
  expect(root.root.findAllByType("aside")).toHaveLength(0);
  act(() => root.unmount());
  expect(atlasLabel("很长的中文模块名称需要保持可读而且不能超出边界")).toHaveLength(2);
  expect(atlasLabel("很长的中文模块名称需要保持可读而且不能超出边界")[1]).toMatch(/…$/);
});
