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
