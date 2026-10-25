import { afterEach, expect, test, vi } from "vitest";
import { todayChoices, todaySourceGroups } from "../src/client/next-presentation.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

test("demo capture keeps the original and failed persistence does not claim a save", async () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
  vi.stubGlobal("sessionStorage", storage);
  const store = await import("../src/testsite/store.js");
  const original = "  合成示例：第一行\n第二行  ";
  await store.capture(original);
  expect(store.snapshot().notes[0]?.text).toBe(original);
  vi.resetModules();
  const reloaded = await import("../src/testsite/store.js");
  expect(reloaded.snapshot().notes[0]?.text).toBe(original);
  storage.setItem = () => {
    throw new Error("QuotaExceededError");
  };
  await expect(reloaded.capture("不应保存的示例")).rejects.toThrow();
  expect(reloaded.snapshot().notes.map((note) => note.text)).not.toContain("不应保存的示例");
});

test("reset removes only demo state and clears adopted progress and captured notes", async () => {
  const values = new Map<string, string>([["other-app", "keep"]]);
  vi.stubGlobal("sessionStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
  const store = await import("../src/testsite/store.js");
  store.selectMode("pending");
  await store.capture("合成示例：重置后应移除");
  store.adopt();
  store.complete("合成示例：已约好访谈");
  store.reset();
  expect([...values]).toEqual([["other-app", "keep"]]);
  expect(store.overview().proposedTasks).toHaveLength(1);
  expect(store.snapshot().notes).toHaveLength(1);
  expect(store.snapshot().result).toBe("");
});

test("clear persists an empty demo, preserves unrelated storage and keeps prior state when persistence fails", async () => {
  const values = new Map<string, string>([["other-app", "keep"]]);
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
  vi.stubGlobal("sessionStorage", storage);
  const store = await import("../src/testsite/store.js");
  store.selectMode("pending");
  await store.capture("合成示例：保留到确认清除");
  store.adopt();
  store.complete("  合成示例：结果保留原样  ");
  const prior = store.snapshot();
  const persist = storage.setItem;
  storage.setItem = () => {
    throw new Error("QuotaExceededError");
  };
  expect(() => store.clear()).toThrow();
  expect(store.snapshot()).toBe(prior);
  storage.setItem = persist;
  store.clear();
  vi.resetModules();
  const reloaded = await import("../src/testsite/store.js");
  expect(reloaded.snapshot()).toEqual({ version: 1, notes: [], task: "skipped", result: "" });
  expect(values.get("other-app")).toBe("keep");
});

test("Today demo scenarios keep sources and goal links through review, capture and reload", async () => {
  const values = new Map<string, string>();
  vi.stubGlobal("sessionStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
  const store = await import("../src/testsite/store.js");
  store.clear();
  expect(store.overview().empty).toBe(true);
  await store.capture("  合成原文\n保留换行  ");
  expect(store.overview().metrics).toEqual([]);
  expect(await store.projects()).toEqual([]);
  store.selectMode("data");
  const data = store.overview();
  expect(data.proposedTasks).toEqual([]);
  const choice = todayChoices(data, 60)[0];
  expect(choice?.goal).toBe(data.plans.goals[0]?.title);
  expect(choice?.item.id).toBe(data.plans.goals[0]?.next?.id);
  expect(todayChoices(data, 10)[0]?.opening).toBe(true);
  expect(todayChoices(data, 5)).toEqual([]);
  expect(data.metrics.every((metric) => todaySourceGroups(metric, data.timeZone, "zh-CN").length > 0)).toBe(
    true,
  );
  const cutoff = data.cutoff;
  await store.capture(`${data.today} · 开图想问你\n合成问题\n\n合成回答`);
  expect(store.overview().cutoff).not.toBe(cutoff);
  store.selectMode("pending");
  expect(store.overview().allNext).toEqual([]);
  store.dismiss();
  expect(store.overview().proposedTasks).toEqual([]);
  store.selectMode("pending");
  store.adopt();
  await store.capture("  合成结果原文  ");
  store.complete();
  vi.resetModules();
  const reloaded = await import("../src/testsite/store.js");
  expect(reloaded.overview().plans.goals[0]?.lastResult).toBe("  合成结果原文  ");
  expect(reloaded.overview().allNext).toEqual([]);
  expect(reloaded.snapshot().notes.some((note) => note.text === "  合成原文\n保留换行  ")).toBe(true);
  expect(await reloaded.projects()).toHaveLength(1);
});

test("Xiaolin projections share recorded-day totals and keep partial weeks bounded", async () => {
  vi.useFakeTimers();
  try {
    vi.setSystemTime(new Date("2026-10-21T12:00:00Z"));
    vi.stubGlobal("sessionStorage", { getItem: () => null, setItem: () => {}, removeItem: () => {} });
    const store = await import("../src/testsite/store.js");
    const overview = store.overview();
    const health = store.healthData();
    const workouts = overview.metrics.find((m) => m.key === "workouts");
    const recent = health.training.recent.filter(
      (r) => r.date >= (workouts?.from ?? "") && r.date <= overview.today,
    );
    expect(workouts?.value).toBe(recent.length);
    expect(health.training.week).toBe(health.training.recent.filter((r) => r.date >= "2026-10-19").length);
    const sleep = overview.metrics.find((m) => m.key === "sleep");
    const nights = health.sleep.filter((r) => r.date >= (sleep?.from ?? "") && r.value !== null);
    expect(sleep?.value).toBe(
      Number((nights.reduce((sum, r) => sum + (r.value ?? 0), 0) / nights.length).toFixed(1)),
    );
    const protein = overview.metrics.find((m) => m.key === "protein");
    const days = health.nutrition.protein.filter((r) => r.value !== null);
    expect(protein?.value).toBe(
      Number((days.reduce((sum, r) => sum + (r.value ?? 0), 0) / days.length).toFixed(1)),
    );
    const pack = await store.handover();
    expect(
      pack.sections
        .find((s) => s.id === "results")
        ?.lines.some((line) => line.includes(`${workouts?.value} 次`)),
    ).toBe(true);
  } finally {
    vi.useRealTimers();
  }
});

test("Xiaolin news proposals and direction changes survive session reload", async () => {
  const values = new Map<string, string>();
  vi.stubGlobal("sessionStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
  const store = await import("../src/testsite/store.js");
  const news = (await store.news()).picked[0];
  if (!news) throw new Error("Missing news sample");
  await store.tryNews(news.id);
  expect(store.overview().proposedTasks.some((t) => t.id === news.id)).toBe(true);
  store.adopt(news.id);
  expect(store.overview().allNext.some((t) => t.id === news.id)).toBe(true);
  const suggestion = (await store.exploration()).directions.find((d) => d.status === "suggested");
  if (!suggestion) throw new Error("Missing direction sample");
  await store.writeExploration({
    operation: "update_direction",
    id: suggestion.id,
    expected_revision: suggestion.rev ?? 1,
    data: { status: "active" },
  });
  await store.feedbackNews(news.id, "useful");
  vi.resetModules();
  const reloaded = await import("../src/testsite/store.js");
  expect(reloaded.overview().allNext.some((t) => t.id === news.id)).toBe(true);
  expect((await reloaded.news()).feedback[news.id]).toBe("useful");
  expect((await reloaded.exploration()).directions.find((d) => d.id === suggestion.id)?.status).toBe(
    "active",
  );
});
