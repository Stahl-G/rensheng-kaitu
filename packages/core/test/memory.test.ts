import { copyFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { handoverPack } from "../src/handover.js";
import { history, restore } from "../src/history.js";
import { readMe } from "../src/me-page.js";
import { addMemory, importMemories, listMemories, removeMemory, updateMemory } from "../src/memory.js";
import { validateWorkspace } from "../src/validate.js";
import { freshWorkspace } from "./helpers.js";

describe("记忆", () => {
  it("自己放进 memory/ 的普通 Markdown 也当记忆读：名字取标题，类型认中文", async () => {
    const ws = await freshWorkspace();
    ws.writeText("memory/我的训练习惯.md", "---\ntype: 偏好\n---\n# 训练时间\n\n喜欢晚上练，早上没精神。\n");
    ws.writeText("memory/notes.md", "住在杭州，在做产品经理。\n");
    expect(listMemories(ws).map((memory) => [memory.type, memory.name, memory.text])).toEqual([
      ["preference", "训练时间", "喜欢晚上练，早上没精神。"],
      ["context", "notes", "住在杭州，在做产品经理。"],
    ]);
    expect(() => readMe(ws)).not.toThrow();
    // 校验和读取用同一份补齐后的记忆，不把没有 frontmatter 的普通 Markdown 报成损坏。
    expect(validateWorkspace(ws)).toEqual([]);
  });

  it("只改正文时保留原来的类型（MCP 和问问的补丁里没写的字段是 undefined）", async () => {
    const ws = await freshWorkspace();
    const gym = await addMemory(ws, { type: "preference", name: "Exercise", text: "晚上训练" });
    expect(await updateMemory(ws, gym.file, { text: "早上训练", type: undefined })).toMatchObject({
      type: "preference",
      text: "早上训练",
    });
  });

  it("写了却认不出的记忆类型原样保留：校验报出来，不归到别的类型、不进资料包", async () => {
    const ws = await freshWorkspace();
    ws.writeText("memory/context_mom.md", "---\ntype: persno\n---\n妈妈住在杭州。\n");
    expect(listMemories(ws).find((memory) => memory.text.includes("妈妈"))?.type).toBe("persno");
    expect(validateWorkspace(ws).some((issue) => issue.file === "memory/context_mom.md")).toBe(true);
    expect(handoverPack(ws, "zh-CN").text).not.toContain("妈妈住在杭州");
  });

  it("frontmatter 写坏时按敏感处理，不进资料包", async () => {
    const ws = await freshWorkspace();
    ws.writeText("memory/fact_secret.md", "---\nsensitive: true\nname: [没写完\n---\n只给自己看的事。\n");
    // 敏感标记写成字符串 "true" 也从严
    ws.writeText("memory/context_diary.md", '---\nsensitive: "true"\n---\n日记里的私事。\n');
    expect(validateWorkspace(ws).some((issue) => issue.file === "memory/fact_secret.md")).toBe(true);
    for (const needle of ["只给自己看", "日记里的私事"]) {
      expect(listMemories(ws).find((memory) => memory.text.includes(needle))?.sensitive).toBe(true);
      expect(handoverPack(ws, "zh-CN").text).not.toContain(needle);
    }
  });

  it("记忆文件夹里有同步冲突副本时，其余记忆、个人档案和资料包照常读取", async () => {
    const ws = await freshWorkspace();
    const city = await addMemory(ws, { type: "fact", name: "city", text: "住在上海" });
    const original = join(ws.root, "memory", city.file);
    copyFileSync(original, original.replace(/\.md$/, " (Conflicted Copy).md"));
    copyFileSync(original, original.replace(/\.md$/, " 2.md"));
    expect(listMemories(ws).map((memory) => memory.text)).toEqual(["住在上海"]);
    expect(() => readMe(ws)).not.toThrow();
    expect(handoverPack(ws, "zh-CN").text).toContain("住在上海");
  });

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
