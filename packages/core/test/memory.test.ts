import { copyFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readAgentFile } from "../src/agent-tools.js";
import { stringifyFrontmatter } from "../src/frontmatter.js";
import { handoverPack } from "../src/handover.js";
import { history, restore } from "../src/history.js";
import { processInbox } from "../src/inbox.js";
import { readMe } from "../src/me-page.js";
import {
  addMemory,
  archiveMemory,
  importMemories,
  listMemories,
  memoryExpectation,
  normalizedMemory,
  pendingMemoryReplacements,
  removeMemory,
  replaceMemory,
  updateMemory,
} from "../src/memory.js";
import { readOverviewPage } from "../src/overview-page.js";
import { buildPhoneLibrary } from "../src/phone-projections.js";
import { validateWorkspace } from "../src/validate.js";
import { freshWorkspace } from "./helpers.js";

describe("记忆", () => {
  it.each([undefined, false])("替换敏感记忆时候选 sensitive=%j 仍保留敏感标记", async (sensitive) => {
    const ws = await freshWorkspace();
    const old = await addMemory(ws, {
      type: "fact",
      name: "私下记录",
      text: "合成敏感旧说法",
      sensitive: true,
    });
    const next = await replaceMemory(
      ws,
      old.file,
      {
        type: "fact",
        name: "新说法",
        text: "合成敏感新说法",
        ...(sensitive === undefined ? {} : { sensitive }),
      },
      { by: "user", expected: memoryExpectation(old) },
    );
    expect(next.sensitive).toBe(true);
    expect(normalizedMemory(ws, next.file)?.sensitive).toBe(true);
    expect(handoverPack(ws, "zh-CN").text).not.toContain("合成敏感新说法");
  });

  it.each([
    { type: "context" },
    { name: "changed" },
    { text: "合成变更正文" },
    { source: "changed" },
    { sensitive: true },
  ])("用户确认前旧条变动时，归档和替换均拒绝且保留当前内容：%j", async (patch) => {
    const ws = await freshWorkspace();
    const old = await addMemory(ws, { type: "fact", name: "old", text: "合成原文", source: "synthetic" });
    const { file, ...data } = old;
    const current = { ...data, ...patch };
    ws.writeText(`memory/${file}`, stringifyFrontmatter(current));
    const expected = memoryExpectation(old);
    await expect(archiveMemory(ws, file, { by: "user", expected })).rejects.toMatchObject({
      code: "CONFLICT",
    });
    await expect(
      replaceMemory(ws, file, { type: "fact", name: "new", text: "合成替换" }, { by: "user", expected }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(listMemories(ws)).toEqual([{ ...current, file }]);
    expect(normalizedMemory(ws, file)?.ended).toBeUndefined();
  });
  it("改标题和类型保留文件编号、正文和来源，普通更新不能夹带归档决定", async () => {
    const ws = await freshWorkspace();
    const old = await addMemory(ws, {
      type: "fact",
      name: "original",
      text: "合成旧说法",
      source: "synthetic",
    });
    ws.writeText(`memory/${old.file}`, `${ws.readText(`memory/${old.file}`)}\n# 原始说明\n保留的正文。\n`);
    const next = await updateMemory(ws, old.file, {
      name: "new title",
      type: "context",
      ended: "2026-10-20",
    } as Parameters<typeof updateMemory>[2]);
    expect(next.file).toBe(old.file);
    expect(next.ended).toBeUndefined();
    expect(next.source).toBe("synthetic");
    expect(ws.readText(`memory/${old.file}`)).toContain("保留的正文。");
    expect(ws.readText("memory/MEMORY.md")).toContain(`new title —— 合成旧说法（${old.file}）`);
    expect(validateWorkspace(ws)).toEqual([]);
  });

  it("用户替换和归档保留旧文件，当前索引、Agent、手机目录只列新的", async () => {
    const ws = await freshWorkspace();
    const old = await addMemory(ws, { type: "fact", name: "city", text: "合成旧城市" });
    const candidate = { type: "context" as const, name: "city now", text: "合成新城市" };
    await expect(
      replaceMemory(ws, old.file, candidate, { by: "agent", expected: memoryExpectation(old) }),
    ).rejects.toMatchObject({
      code: "USER_DECISION",
    });
    const next = await replaceMemory(ws, old.file, candidate, {
      by: "user",
      expected: memoryExpectation(old),
      now: new Date("2026-10-19T18:00:00Z"),
    });
    expect(normalizedMemory(ws, old.file)).toMatchObject({
      ended: "2026-10-20",
      replaced_by: next.file,
      text: "合成旧城市",
    });
    expect(listMemories(ws).map((m) => m.file)).toEqual([next.file]);
    expect(listMemories(ws, { includeArchived: true })).toHaveLength(2);
    expect(readAgentFile(ws, `memory/${old.file}`, true)).toContain("合成旧城市");
    expect(ws.readText("memory/MEMORY.md")).not.toContain(old.file);
    expect(handoverPack(ws, "zh-CN").text).not.toContain("合成旧城市");
    const now = new Date();
    const library = buildPhoneLibrary(ws, await readOverviewPage(ws, now), now.toISOString());
    expect(library.items.map((item) => item.path)).toContain(`memory/${next.file}`);
    expect(library.items.map((item) => item.path)).not.toContain(`memory/${old.file}`);
    expect(readMe(ws).archivedMemories[0]).toMatchObject({ file: old.file, replaced_by: next.file });
    await archiveMemory(ws, next.file, { by: "user", expected: memoryExpectation(next) });
    expect(listMemories(ws)).toEqual([]);
    expect(validateWorkspace(ws)).toEqual([]);
  });

  it("Agent 的 replaces 候选重复整理仍等待用户，确认后才替换且不重复导入", async () => {
    const ws = await freshWorkspace();
    const old = await addMemory(ws, { type: "preference", name: "training", text: "合成早上练" });
    const file = "inbox/agents/synthetic.memory.json";
    const candidate = { type: "preference" as const, name: "training", text: "合成晚上练" };
    const text = JSON.stringify([{ ...candidate, replaces: old.file, agent: "synthetic" }]);
    ws.writeText(file, text);
    for (let i = 0; i < 2; i++) expect((await processInbox(ws, { stableMs: 0 })).pending).toContain(file);
    expect(ws.readText(file)).toBe(text);
    expect(listMemories(ws).map((m) => m.text)).toEqual(["合成早上练"]);
    expect(normalizedMemory(ws, old.file)?.ended).toBeUndefined();
    expect(pendingMemoryReplacements(ws)).toEqual([{ file: old.file, candidate }]);
    await replaceMemory(ws, old.file, candidate, { by: "user", expected: memoryExpectation(old) });
    expect((await processInbox(ws, { stableMs: 0 })).processed).toContain(file);
    expect(pendingMemoryReplacements(ws)).toEqual([]);
    expect(listMemories(ws).map((m) => m.text)).toEqual(["合成晚上练"]);
  });
  it("自己放进 memory/ 的普通 Markdown 也当记忆读：名字取标题", async () => {
    const ws = await freshWorkspace();
    ws.writeText(
      "memory/我的训练习惯.md",
      "---\ntype: preference\n---\n# 训练时间\n\n喜欢晚上练，早上没精神。\n",
    );
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
    // 日期写成数字：按文字保留并报出来，整份记忆列表照常可读
    ws.writeText("memory/fact_city.md", "---\nupdated: 20261017\n---\n住在上海。\n");
    expect(listMemories(ws).find((memory) => memory.text === "住在上海。")?.updated).toBe("20261017");
    expect(validateWorkspace(ws).some((issue) => issue.file === "memory/fact_city.md")).toBe(true);
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
