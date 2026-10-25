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
