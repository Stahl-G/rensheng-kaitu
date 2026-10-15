import { describe, expect, it } from "vitest";
import { history, restore } from "../src/history.js";
import { addMemory, importMemories, listMemories, removeMemory } from "../src/memory.js";
import { validateWorkspace } from "../src/validate.js";
import { freshWorkspace } from "./helpers.js";

describe("记忆", () => {
  it("增删后 MEMORY.md 同步", async () => {
    const ws = await freshWorkspace();
    const home = await addMemory(ws, { type: "fact", name: "Home", text: "在上海生活。喜欢散步。" });
    const gym = await addMemory(ws, { type: "preference", name: "Exercise", text: "晚上训练" });
    expect(ws.readText("memory/MEMORY.md").trim().split("\n")).toEqual([
      `- [偏好] Exercise —— 晚上训练（${gym.file}）`,
      `- [事实] Home —— 在上海生活。（${home.file}）`,
    ]);
    await removeMemory(ws, home.file);
    expect(ws.exists(`memory/${home.file}`)).toBe(false);
    expect(ws.readText("memory/MEMORY.md")).not.toContain(home.file);
  });

  it("纯中文名称生成合法文件名，日期按用户时区", async () => {
    const ws = await freshWorkspace("Asia/Shanghai");
    const m = await addMemory(
      ws,
      { type: "preference", name: "训练时间偏好", text: "晚上训练" },
      { now: new Date("2026-10-31T17:00:00Z") },
    );
    expect(m.file).toMatch(/^preference_[a-z0-9]{8}\.md$/);
    expect(m.created).toBe("2026-11-01");
    expect(validateWorkspace(ws)).toEqual([]);
  });
});

it("整批记忆只生成一个版本，恢复后全部消失", async () => {
  const ws = await freshWorkspace();
  const before = await history(ws);
  const indexBefore = ws.readText("memory/MEMORY.md");
  const inputs = [
    { type: "preference" as const, name: "语言", text: "使用中文" },
    { type: "context" as const, name: "项目", text: "正在整理读书计划" },
  ];
  await importMemories(ws, inputs, { dryRun: true });
  expect(listMemories(ws)).toEqual([]);
  expect(await history(ws)).toEqual(before);
  await importMemories(ws, inputs);
  expect(listMemories(ws)).toHaveLength(2);
  expect((await history(ws)).length).toBe(before.length + 1);
  await restore(ws, before[0]?.oid as string);
  expect(listMemories(ws)).toEqual([]);
  expect(ws.readText("memory/MEMORY.md")).toBe(indexBefore);
});
