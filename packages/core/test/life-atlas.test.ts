import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { atlasSource } from "../src/life-atlas-source.js";
import { changeLifeAtlas, generateLifeAtlas, invalidateLifeAtlas, readLifeAtlas } from "../src/life-atlas.js";
import { localStateRoot } from "../src/local-state.js";
import { addRecord, deleteRecord } from "../src/records.js";
import type { Workspace } from "../src/workspace.js";
import { freshWorkspace } from "./helpers.js";

async function settled(ws: Workspace) {
  const end = Date.now() + 25_000;
  while (Date.now() < end) {
    const value = readLifeAtlas(ws);
    if (!value.loading && !value.running) {
      expect(value.error).toBeNull();
      return value;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Atlas worker did not settle");
}

test("map histories preserve terrain and positions while projecting current records, including new domains", async () => {
  const ws = await freshWorkspace();
  ws.writeText(
    "health/STATUS.md",
    "---\nupdated: 2026-10-20\nnext:\n  - id: walking\n    title: 合成测试：每天散步\n    status: todo\n---\n",
  );
  ws.writeText(
    "learning/agent/STATUS.md",
    "---\ntitle: Agent 与 AI 基础\nupdated: 2026-10-20\nstage: active\n---\n",
  );
  const source = await settled(ws);
  expect(source.modules.find((m) => m.id === "health")?.recommended).toBe(true);
  const before = performance.now();
  expect(generateLifeAtlas(ws, { domains: ["health", "learning"] }).running).toBe(true);
  expect(performance.now() - before).toBeLessThan(300);
  const first = await settled(ws);
  const firstId = first.active as string;
  expect(first.resource?.settings.style).toBe("fantasy");
  expect(first.resource?.svg).toContain("<svg");
  expect(first.resource?.svg).not.toContain("@import");
  expect(first.resource?.regions.mainLandShare).toBeGreaterThan(0.85);
  expect(first.domains.map((d) => [d.id, d.slot])).toEqual([
    ["health", 0],
    ["learning", 1],
  ]);
  const key = first.resource?.key;
  const borders = first.resource?.regions.borders;
  ws.writeText(
    "learning/agent/STATUS.md",
    "---\ntitle: 合成测试：新的学习主题\nupdated: 2026-10-21\nstage: active\n---\n",
  );
  invalidateLifeAtlas(ws);
  const updated = await settled(ws);
  expect(updated.resource?.key).toBe(key);
  expect(updated.candidates).toHaveLength(1);
  expect(updated.domains.find((d) => d.id === "learning")?.facts[0]?.title).toBe("合成测试：新的学习主题");
  generateLifeAtlas(ws, { domains: ["health", "learning", "finance"], sameTerrain: true });
  const second = await settled(ws);
  const secondId = second.latest as string;
  expect(second.active).toBe(firstId);
  const preview = readLifeAtlas(ws, secondId);
  expect(preview.resource?.terrainCacheHit).toBe(true);
  expect(preview.resource?.key).toBe(key);
  expect(preview.resource?.regions.borders).toBe(borders);
  expect(preview.domains.map((d) => [d.id, d.slot])).toEqual([
    ["health", 0],
    ["learning", 1],
    ["finance", 2],
  ]);
  expect(preview.domains.find((d) => d.id === "finance")?.facts).toEqual([]);
  changeLifeAtlas(ws, secondId, "adopt");
  changeLifeAtlas(ws, firstId, "archive");
  expect(() => readLifeAtlas(ws, firstId)).toThrow();
  changeLifeAtlas(ws, firstId, "restore");
  const restored = changeLifeAtlas(ws, firstId, "adopt");
  expect(restored.resource?.key).toBe(key);
  expect(restored.domains.find((d) => d.id === "learning")?.facts[0]?.title).toBe("合成测试：新的学习主题");
  expect(() => changeLifeAtlas(ws, firstId, "archive")).toThrow();
  generateLifeAtlas(ws, { domains: ["health", "learning"] });
  const third = await settled(ws);
  expect(readLifeAtlas(ws, third.latest as string).resource?.key).not.toBe(key);
  expect(third.active).toBe(firstId);
  // A failed save must not replace the active map or add an unsaved candidate.
  const folder = join(
    localStateRoot(),
    "cartography",
    createHash("sha256").update(ws.root).digest("hex").slice(0, 24),
  );
  mkdirSync(join(folder, "manifest.json.tmp"));
  generateLifeAtlas(ws, { domains: ["health", "learning"], sameTerrain: true });
  let failed = readLifeAtlas(ws);
  const deadline = Date.now() + 20_000;
  while (failed.running && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
    failed = readLifeAtlas(ws);
  }
  expect(failed.running).toBe(false);
  expect(failed.error).toBeTruthy();
  expect(failed.active).toBe(firstId);
  expect(failed.resource?.key).toBe(key);
  expect(failed.candidates).toHaveLength(3);
  // All persisted map files contain only rendering resources/config, never source facts.
  const root = join(localStateRoot(), "cartography");
  for (const dir of readdirSync(root)) {
    const folder = join(root, dir);
    const manifest = readFileSync(join(folder, "manifest.json"), "utf8");
    expect(manifest).not.toContain("新的学习主题");
    for (const name of readdirSync(join(folder, "maps")))
      expect(readFileSync(join(folder, "maps", name), "utf8")).not.toContain("新的学习主题");
  }
}, 40_000);

test("projection treats education as history, respects record deletions and leaves unknown areas empty", async () => {
  const ws = await freshWorkspace();
  const empty = atlasSource(ws);
  expect(empty.modules.every((m) => !m.available && !m.recommended)).toBe(true);
  ws.writeText("learning/llm/STATUS.md", "---\ntitle: 大语言模型基础\nupdated: 2026-10-20\n---\n");
  ws.writeText("me/profile.md", "学历：合成测试大学\n");
  ws.writeJson("家庭事务/module.json", { id: "family", name: "家庭", version: 1, visibility: "agent" });
  ws.writeText("家庭事务/STATUS.md", "---\ntitle: 合成家庭计划\nupdated: 2026-10-20T00:00:00Z\n---\n");
  const record = addRecord(ws, "experience", {
    title: "合成测试大学",
    fact_status: "user_reported",
    event_type: "studied",
    place: { name: "合成测试地点", precision: "unknown" },
    time_precision: "year",
    source: "synthetic-test",
    ts: "2020-01-01T00:00:00+08:00",
  });
  const source = atlasSource(ws);
  expect(source.data.domains.find((d) => d.id === "learning")?.facts.map((f) => f.title)).toEqual([
    "大语言模型基础",
  ]);
  expect(source.data.domains.find((d) => d.id === "family")?.title).toBe("家庭");
  expect(source.rules.find((r) => r.id === "experience")?.temporal.kind).toBe("historical");
  expect(source.data.domains.find((d) => d.id === "experience")?.facts[0]?.title).toBe("合成测试大学");
  expect(source.data.domains.find((d) => d.id === "health")?.facts).toEqual([]);
  deleteRecord(ws, "experience", record.record.id);
  expect(atlasSource(ws).data.domains.find((d) => d.id === "experience")?.facts).toEqual([]);
});
