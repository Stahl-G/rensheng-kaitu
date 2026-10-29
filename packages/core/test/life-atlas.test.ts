import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { mapDomains, scoreDomain } from "@kaitu/cartographer/domains";
import { expect, test, vi } from "vitest";
import { atlasSource } from "../src/life-atlas-source.js";
import {
  changeLifeAtlas,
  generateLifeAtlas,
  invalidateLifeAtlas,
  phoneLifeAtlas,
  readLifeAtlas,
  readLifeAtlasProgress,
  subscribeLifeAtlas,
} from "../src/life-atlas.js";
import { localStateRoot } from "../src/local-state.js";
import { writePhoneSnapshots } from "../src/phone-snapshots.js";
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
    "---\nupdated: 2026-10-20T08:00:00Z\nnext:\n  - id: walking\n    title: 合成测试：每天散步\n    status: todo\n---\n",
  );
  ws.writeText(
    "learning/agent/STATUS.md",
    "---\ntitle: Agent 与 AI 基础\nupdated: 2026-10-20T08:00:00Z\nstage: active\n---\n",
  );
  ws.writeText("finance/STATUS.md", "---\ntitle: 合成私密财务\nupdated: 2026-10-20T08:00:00Z\n---\n");
  const source = await settled(ws);
  expect(source.modules.find((m) => m.id === "health")?.recommended).toBe(true);
  const changed = vi.fn();
  const stop = subscribeLifeAtlas(ws, changed);
  expect(generateLifeAtlas(ws, { domains: ["health", "learning"] }).running).toBe(true);
  expect(readLifeAtlasProgress(ws).running).toBe(true);
  const first = await settled(ws);
  const firstId = first.active as string;
  expect(changed).toHaveBeenCalledTimes(2); // start and completion, never each worker progress update
  stop();
  expect(readLifeAtlas(ws, undefined, undefined, firstId).resource).toBeUndefined();
  expect(JSON.stringify(readLifeAtlasProgress(ws))).not.toContain("svg");
  expect(first.resource?.settings.style).toBe("fantasy");
  expect(first.resource?.svg).toContain("<svg");
  expect(first.resource?.svg).not.toContain("@import");
  expect(first.resource?.regions.mainLandShare).toBeGreaterThan(0.85);
  expect(first.domains.map((d) => [d.id, d.slot])).toEqual([
    ["health", 0],
    ["learning", 1],
  ]);
  const phone = phoneLifeAtlas(ws);
  expect(phone?.resourceId).toBe(firstId);
  expect(phone?.resource).toEqual(first.resource);
  expect(phone).not.toHaveProperty("candidates");
  expect(phone?.domains.every((d) => !("facets" in d))).toBe(true);
  await writePhoneSnapshots(ws, new Date("2026-10-28T08:00:00Z"), { force: true });
  expect(ws.readJson<{ resourceId: string }>("phone/life-atlas.json").resourceId).toBe(firstId);
  const published = ws.readText("phone/life-atlas.json");
  const originalSvg = first.resource?.svg as string;
  if (first.resource) first.resource.svg = "x".repeat(16 * 1024 * 1024);
  try {
    await expect(writePhoneSnapshots(ws, new Date("2026-10-28T08:01:00Z"), { force: true })).rejects.toThrow(
      "16 MiB",
    );
    expect(ws.readText("phone/life-atlas.json")).toBe(published);
  } finally {
    if (first.resource) first.resource.svg = originalSvg;
  }
  ws.writeText("phone/life-atlas.json", "{broken synthetic output");
  ws.writeText("phone/week.json", "{broken synthetic output");
  const repairNotice = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    await writePhoneSnapshots(ws, new Date("2026-10-28T08:02:00Z"), { force: true });
    expect(ws.readJson<{ resourceId: string }>("phone/life-atlas.json").resourceId).toBe(firstId);
    expect(ws.readJson<{ format: string }>("phone/week.json").format).toBe("kaitu.phone.week");
    expect(repairNotice).toHaveBeenCalledTimes(2);
  } finally {
    repairNotice.mockRestore();
  }
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
  const healthModule = JSON.parse(ws.readText("health/module.json"));
  healthModule.records.workout.path = "records/workouts/{YYYY-MM}.jsonl";
  ws.writeJson("health/module.json", healthModule);
  const custom = addRecord(ws, "workout", {
    exercise: "合成非 data 目录训练",
    sets: 3,
    reps: 5,
    weight_kg: 20,
    session_id: "synthetic",
    ts: "2026-10-21T12:00:00+08:00",
  });
  invalidateLifeAtlas(ws, custom.file);
  const customUpdated = await settled(ws);
  expect(
    customUpdated.domains
      .find((d) => d.id === "health")
      ?.facts.some((f) => f.title === "合成非 data 目录训练"),
  ).toBe(true);
  expect(customUpdated.resource?.key).toBe(key);
  generateLifeAtlas(ws, { domains: ["health", "learning", "finance"], sameTerrain: true });
  const second = await settled(ws);
  const secondId = second.latest as string;
  expect(second.active).toBe(firstId);
  expect(phoneLifeAtlas(ws)?.resourceId).toBe(firstId);
  const preview = readLifeAtlas(ws, secondId);
  expect(preview.resource?.terrainCacheHit).toBe(true);
  expect(preview.resource?.key).toBe(key);
  expect(preview.resource?.regions.borders).toBe(borders);
  expect(preview.domains.map((d) => [d.id, d.slot])).toEqual([
    ["health", 0],
    ["learning", 1],
    ["finance", 2],
  ]);
  expect(preview.domains.find((d) => d.id === "finance")?.facts.some((f) => f.title === "合成私密财务")).toBe(
    true,
  );
  changeLifeAtlas(ws, secondId, "adopt");
  const shared = phoneLifeAtlas(ws);
  expect(shared?.domains.some((d) => d.id === "finance")).toBe(true);
  expect(JSON.stringify(shared)).toContain("合成私密财务");
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
  const mapsBefore = readdirSync(join(folder, "maps"));
  const cacheBefore = readdirSync(join(folder, "cache"));
  mkdirSync(join(folder, "manifest.json.tmp"));
  generateLifeAtlas(ws, { domains: ["health", "learning"] });
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
  expect(readdirSync(join(folder, "maps"))).toEqual(mapsBefore);
  expect(readdirSync(join(folder, "cache"))).toEqual(cacheBefore);
  rmSync(join(folder, "manifest.json.tmp"), { recursive: true });
  changeLifeAtlas(ws, secondId, "archive");
  const removed = changeLifeAtlas(ws, secondId, "delete");
  expect(removed.candidates).toHaveLength(2);
  expect(existsSync(join(folder, "maps", `${secondId}.json`))).toBe(false);
  expect(existsSync(join(folder, "cache", `${key}.terrain`))).toBe(true);
  expect(() => changeLifeAtlas(ws, firstId, "delete")).toThrow();
  expect(ws.readText("learning/agent/STATUS.md")).toContain("新的学习主题");
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
  addRecord(ws, "experience", {
    title: "尚未发生的合成经历",
    fact_status: "planned",
    event_type: "studied",
    place: { name: "测试", precision: "unknown" },
    time_precision: "year",
    source: "synthetic-test",
    ts: "2026-10-20T00:00:00+08:00",
  });
  const planned = atlasSource(ws);
  const [domain] = mapDomains(planned.data, {
    version: 1,
    discover: false,
    domains: planned.rules.filter((r) => r.id === "experience"),
  });
  expect(scoreDomain(domain, new Date("2026-10-27T00:00:00Z")).coverage).toBe(0);
});

test("project and learning content explores land without claiming recent activity", async () => {
  const ws = await freshWorkspace();
  for (const [file, stage, body] of [
    ["projects/content/STATUS.md", "active", "# 合成标题\n已整理的接口资料与现状。\n"],
    ["learning/content/STATUS.md", "active", "# 合成标题\n已整理的学习资料。\n"],
    ["projects/shell/STATUS.md", "active", "# 合成标题\n<!-- empty -->\n---\n- [ ] 一个计划\n"],
    ["learning/guess/STATUS.md", "inferred", "推测资料。\n"],
  ])
    ws.writeText(
      file,
      `---\ntitle: 合成标题\nstage: ${stage}\nupdated: 2026-10-26\nnext:\n  - id: p\n    title: 合成计划\n    status: todo\n---\n${body}`,
    );
  const source = atlasSource(ws, new Date("2026-10-27"));
  const facts = source.data.domains.flatMap((d) => d.facts);
  for (const [file, clarity] of [
    ["projects/content/STATUS.md", 1],
    ["learning/content/STATUS.md", 1],
    ["projects/shell/STATUS.md", 0.18],
    ["learning/guess/STATUS.md", 0.18],
  ] as const) {
    const selected = facts.filter((f) => f.source === file);
    const d = mapDomains({ domains: [{ id: "check", title: "合成", facts: selected }] })[0];
    for (const time of ["2026-10-27", "2026-11-26"])
      expect(scoreDomain(d, new Date(time))).toMatchObject({ clarity, glow: 0 });
  }
  const plans = facts.filter((f) => f.kind === "plan");
  const d = mapDomains({ domains: [{ id: "plans", title: "计划", facts: plans }] })[0];
  expect(scoreDomain(d, new Date("2026-10-27"))).toMatchObject({ clarity: 0.18, glow: 0 });
});

test("cached activity selection refreshes across event boundaries and backwards without file changes", async () => {
  const ws = await freshWorkspace();
  for (const date of ["2026-01-01", "2026-10-26", "2026-11-09", "2026-12-01"])
    addRecord(
      ws,
      "workout",
      { exercise: "合成训练", sets: 3, reps: 5, weight_kg: 20, session_id: date, ts: `${date}T10:00:00Z` },
      { by: "user" },
    );
  for (let i = 2; i <= 7; i++)
    addRecord(
      ws,
      "workout",
      {
        exercise: "合成待核",
        sets: 3,
        reps: 5,
        weight_kg: 20,
        session_id: `other-${i}`,
        ts: `2026-12-0${i}T10:00:00Z`,
      },
      { by: "agent" },
    );
  async function at(now: Date) {
    for (let i = 0; i < 1000; i++) {
      const state = readLifeAtlas(ws, undefined, now);
      if (!state.loading) {
        expect(state.error).toBeNull();
        return state;
      }
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error("source did not settle");
  }
  const initial = new Date("2026-10-27");
  await at(initial);
  generateLifeAtlas(ws, { domains: ["health"] });
  await settled(ws);
  const key = readLifeAtlas(ws).resource?.key;
  for (const time of ["2026-11-10", "2026-10-27", "2025-12-31"]) {
    const now = new Date(time);
    const warm = await at(now);
    const source = atlasSource(ws, now);
    const fresh = mapDomains(source.data, {
      version: 1,
      discover: false,
      domains: source.rules.filter((r) => r.id === "health"),
    })[0];
    expect(warm.domains[0].score).toEqual(scoreDomain(fresh, now));
    expect(warm.resource?.key).toBe(key);
    expect(warm.running).toBe(false);
  }
}, 40_000);

test("activity selection and scoring share an injected clock", async () => {
  const ws = await freshWorkspace();
  const dates = [
    "2026-01-01",
    "2026-10-26",
    "2026-11-01",
    ...Array.from({ length: 6 }, (_, i) => `2026-11-0${i + 2}`),
  ];
  for (const [i, date] of dates.entries())
    addRecord(
      ws,
      "workout",
      { exercise: "合成训练", sets: 3, reps: 5, weight_kg: 20, session_id: date, ts: `${date}T10:00:00Z` },
      { by: i < 3 ? "user" : "agent" },
    );
  const now = new Date("2026-10-27");
  const spy = vi.spyOn(Date, "now");
  try {
    const results = ["2026-10-27", "2026-11-10"].map((wall) => {
      spy.mockReturnValue(Date.parse(wall));
      const source = atlasSource(ws, now);
      const d = mapDomains(source.data, {
        version: 1,
        discover: false,
        domains: source.rules.filter((r) => r.id === "health"),
      })[0];
      return { facts: d.facts, score: scoreDomain(d, now) };
    });
    expect(results[1]).toEqual(results[0]);
    expect(results[0].score).toMatchObject({ clarity: 1, glow: 1 });
  } finally {
    spy.mockRestore();
  }
});

test("real activity illuminates briefly while explored terrain remains clear", async () => {
  const ws = await freshWorkspace();
  ws.writeText(
    "health/STATUS.md",
    "---\nupdated: 2026-10-26\nnext:\n  - id: plan\n    title: 合成计划\n    status: todo\n---\n",
  );
  addRecord(
    ws,
    "workout",
    {
      exercise: "未经确认的合成记录",
      sets: 3,
      reps: 5,
      weight_kg: 20,
      session_id: "agent",
      ts: "2026-10-26T11:00:00Z",
    },
    { by: "agent" },
  );
  const sourceBefore = atlasSource(ws);
  const plan = {
    version: 1 as const,
    discover: false,
    domains: sourceBefore.rules.filter((r) => r.id === "health"),
  };
  const before = mapDomains(sourceBefore.data, plan)[0];
  expect(scoreDomain(before, new Date("2026-10-27T00:00:00Z"))).toMatchObject({ clarity: 0.18, glow: 0 });
  addRecord(
    ws,
    "workout",
    {
      exercise: "合成训练",
      sets: 3,
      reps: 5,
      weight_kg: 20,
      session_id: "test",
      ts: "2026-10-26T10:00:00Z",
    },
    { by: "user" },
  );
  for (const ts of ["2020-01-01T10:00:00Z", "2030-01-01T10:00:00Z"])
    addRecord(
      ws,
      "workout",
      { exercise: "合成日期边界", sets: 3, reps: 5, weight_kg: 20, session_id: ts, ts },
      { by: "user" },
    );
  for (let i = 0; i < 6; i++)
    addRecord(
      ws,
      "workout",
      {
        exercise: `未经确认的合成记录 ${i}`,
        sets: 3,
        reps: 5,
        weight_kg: 20,
        session_id: `agent-${i}`,
        ts: "2026-10-26T12:00:00Z",
      },
      { by: "agent" },
    );
  const source = atlasSource(ws);
  const domain = mapDomains(source.data, {
    ...plan,
    domains: source.rules.filter((r) => r.id === "health"),
  })[0];
  const recent = scoreDomain(domain, new Date("2026-10-27T00:00:00Z"));
  const later = scoreDomain(domain, new Date("2026-11-26T00:00:00Z"));
  expect(recent).toMatchObject({ clarity: 1, glow: 1 });
  expect(later).toMatchObject({ clarity: 1, glow: 0 });
  await settled(ws);
  generateLifeAtlas(ws, { domains: ["health"] });
  await settled(ws);
  const today = readLifeAtlas(ws, undefined, new Date("2026-10-27T00:00:00Z"));
  const nextMonth = readLifeAtlas(ws, undefined, new Date("2026-11-26T00:00:00Z"));
  expect(nextMonth.active).toBe(today.active);
  expect(nextMonth.resource?.key).toBe(today.resource?.key);
  expect(today.domains[0].score).toMatchObject({ clarity: 1, glow: 1 });
  expect(nextMonth.domains[0].score).toMatchObject({ clarity: 1, glow: 0 });
  const agent = { ...domain, facts: domain.facts.map((f) => ({ ...f, actualActivityAt: undefined })) };
  expect(scoreDomain(agent, new Date("2026-10-27T00:00:00Z"))).toMatchObject({ clarity: 0.18, glow: 0 });
  const imported = await freshWorkspace();
  addRecord(
    imported,
    "workout",
    {
      exercise: "合成导入训练",
      sets: 3,
      reps: 5,
      weight_kg: 20,
      session_id: "imported",
      ts: "2026-10-26T10:00:00Z",
    },
    { by: "import:apple-health" },
  );
  const importedSource = atlasSource(imported);
  const importedDomain = mapDomains(importedSource.data, {
    version: 1,
    discover: false,
    domains: importedSource.rules.filter((r) => r.id === "health"),
  })[0];
  expect(scoreDomain(importedDomain, new Date("2026-10-27T00:00:00Z"))).toMatchObject({
    clarity: 1,
    glow: 1,
  });
  const past = {
    ...domain,
    facts: [
      { id: "past", title: "合成经历", kind: "experience" as const, status: "user_reported", source: "test" },
    ],
  };
  expect(scoreDomain(past, new Date("2030-01-01"))).toMatchObject({ clarity: 1, glow: 0 });
  expect(
    scoreDomain({ ...past, facts: [{ ...past.facts[0], status: "inferred" }] }, new Date("2030-01-01")),
  ).toMatchObject({ clarity: 0.18, glow: 0 });
}, 40_000);

test("full archives can permanently delete a map, reclaim actual bytes and generate again", async () => {
  const ws = await freshWorkspace();
  const folder = join(
    localStateRoot(),
    "cartography",
    createHash("sha256").update(ws.root).digest("hex").slice(0, 24),
  );
  const { settings } = await import("@kaitu/cartographer/settings");
  const shared = "a".repeat(24);
  const unique = "b".repeat(24);
  const candidates = Array.from({ length: 50 }, (_, i) => ({
    id: `synthetic-${i}`,
    createdAt: "2026-10-20T00:00:00Z",
    seed: "storage-test",
    variant: 0,
    settings: settings(),
    domains: ["health"],
    slots: { health: 0 },
    archived: i !== 0,
  }));
  mkdirSync(join(folder, "maps"), { recursive: true });
  mkdirSync(join(folder, "cache"));
  for (const c of candidates)
    writeFileSync(
      join(folder, "maps", `${c.id}.json`),
      JSON.stringify({ key: c.id === "synthetic-49" ? unique : shared }),
    );
  writeFileSync(
    join(folder, "manifest.json"),
    JSON.stringify({ version: 1, active: "synthetic-0", candidates }),
  );
  writeFileSync(join(folder, "cache", `${shared}.terrain`), "synthetic shared cache");
  const large = join(folder, "cache", `${unique}.terrain`);
  writeFileSync(large, "");
  truncateSync(large, 512 * 1024 ** 2); // sparse, disposable synthetic file
  await settled(ws);
  expect(() => generateLifeAtlas(ws, { domains: ["health"] })).toThrow(/上限/);
  expect(() => changeLifeAtlas(ws, "synthetic-0", "delete")).toThrow();
  const freed = changeLifeAtlas(ws, "synthetic-49", "delete");
  expect(freed.storage.count).toBe(49);
  expect(freed.storage.bytes).toBeLessThan(10_000);
  expect(existsSync(large)).toBe(false);
  expect(existsSync(join(folder, "cache", `${shared}.terrain`))).toBe(true);
  generateLifeAtlas(ws, { domains: ["health"] });
  const next = await settled(ws);
  expect(next.candidates).toHaveLength(50);
  expect(next.active).toBe("synthetic-0");
  expect(readLifeAtlas(ws, next.latest as string).resource?.svg).toContain("<svg");
}, 40_000);
