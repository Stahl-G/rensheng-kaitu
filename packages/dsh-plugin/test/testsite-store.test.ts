import { afterEach, expect, test, vi } from "vitest";

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
