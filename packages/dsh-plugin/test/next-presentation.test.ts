import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addGoalNext, addRecord, initWorkspace, readOverviewPage, stringifyFrontmatter } from "@kaitu/core";
import { createProject, readProjectsPage } from "@kaitu/core";
import { expect, it } from "vitest";
import {
  nextPresentation,
  todayChoices,
  todayDate,
  todayProjectDate,
  todayProjectFacts,
  todaySourceGroups,
} from "../src/client/next-presentation.js";

const file = "inbox/notes/2026-01-02/grok-bot-20260102T0800.note.md";

it("shows concise provenance, hides technical annotations, and preserves actual instructions and parentheses", () => {
  const item = Object.freeze({
    title: `吃三餐（豆类 + 鸡/蛋），先试 7 天（方案见 ${file}，用户加入）`,
    ref: file,
    source: "grok-bot",
  });
  const original = JSON.stringify(item);
  expect(nextPresentation(item)).toEqual({
    title: "吃三餐（豆类 + 鸡/蛋），先试 7 天（方案见 资料，用户加入）",
    source: "Grokbot 提供",
  });
  expect(JSON.stringify(item)).toBe(original);
  const mixed = Object.freeze({
    title:
      "提交申请（先让 Alice 审阅，参考 docs/checklist.md）；核对 /Users/me/results/scan.pdf、projects/book/draft.docx 和 meals/lunch.jpg（20 分钟）",
    source: "grok-bot",
    ref: file,
  });
  const mixedRaw = JSON.stringify(mixed);
  expect(nextPresentation(mixed)).toEqual({
    title: "提交申请（先让 Alice 审阅，参考 资料）；核对 资料、资料 和 资料（20 分钟）",
    source: "Grokbot 提供",
  });
  expect(JSON.stringify(mixed)).toBe(mixedRaw);
  expect(
    nextPresentation({ title: `本机处理 ${file} 中 3 条和 ${file} 中 2 条只有日期的待核实资讯` }),
  ).toEqual({ title: "Grokbot 提供", source: "Grokbot 提供" });
  expect(nextPresentation({ title: `本机处理 ${file} 之后跑步（20 分钟）` }).title).toBe(
    "本机处理 资料 之后跑步（20 分钟）",
  );
  expect(nextPresentation({ title: "复盘（ref: note-1）后散步（20 分钟）" }).title).toBe(
    "复盘后散步（20 分钟）",
  );
  expect(nextPresentation({ title: `阅读（${file}）`, source: "Claude", ref: file }).source).toBe(
    "Claude 提供",
  );
});

it("keeps raw title and provenance available through the real overview without rewriting the workspace", async () => {
  const root = mkdtempSync(join(tmpdir(), "kaitu-next-source-"));
  try {
    const ws = await initWorkspace(root);
    const next = {
      id: "synthetic-source",
      title: `浏览资讯（${file}）`,
      status: "proposed",
      source: "grok-bot",
      by: "agent",
      ref: file,
    };
    ws.writeText("feed/STATUS.md", stringifyFrontmatter({ updated: null, next: [next] }, ""));
    const before = ws.readText("feed/STATUS.md");
    const data = await readOverviewPage(ws);
    const item = data.allNext.find((value) => value.id === next.id);
    if (!item) throw new Error("Synthetic next item missing from overview");
    expect(item).toMatchObject({ title: next.title, ref: file, source: "grok-bot", by: "agent" });
    expect(nextPresentation(item)).toEqual({ title: "浏览资讯（资料）", source: "Grokbot 提供" });
    expect(ws.readText("feed/STATUS.md")).toBe(before);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it("无时长且关联目标的已采纳下一步可选，十分钟只开头，累时不推工作", async () => {
  const root = mkdtempSync(join(tmpdir(), "kaitu-today-choices-"));
  try {
    const ws = await initWorkspace(root);
    ws.writeJson("me/goals.json", [
      { id: "g1", title: "摄影集" },
      { id: "g2", title: "整理照片" },
    ]);
    await addGoalNext(ws, "g1", "挑出封面候选");
    await addGoalNext(ws, "g2", "整理照片 45分钟");
    addRecord(ws, "task", { title: "未采纳的工作", status: "proposed" });
    const data = await readOverviewPage(ws);
    const raw = JSON.stringify(data);
    expect(todayChoices(data, 60).map(({ item }) => item.title)).toEqual(["挑出封面候选", "整理照片 45分钟"]);
    expect(todayChoices(data, 10).map(({ minutes, opening }) => ({ minutes, opening }))).toEqual([
      { minutes: null, opening: true },
      { minutes: 45, opening: true },
    ]);
    expect(todayChoices(data, 5)).toEqual([]);
    expect(JSON.stringify(data)).toBe(raw);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it("训练按工作区当地日期和 session 分组，UTC 午夜两边的动作仍能对应真实训练次数", async () => {
  const root = mkdtempSync(join(tmpdir(), "kaitu-today-sources-"));
  try {
    const ws = await initWorkspace(root, { timeZone: "America/Los_Angeles" });
    for (const [ts, exercise] of [
      ["2026-10-24T23:00:00Z", "深蹲"],
      ["2026-10-25T00:30:00Z", "硬拉"],
      ["2026-10-25T08:30:00Z", "深蹲"],
    ])
      addRecord(ws, "workout", {
        ts,
        exercise,
        sets: 3,
        reps: 12,
        weight_kg: 40,
        session_id: "same-session",
      });
    const data = await readOverviewPage(ws, new Date("2026-10-25T09:00:00Z"));
    const metric = data.metrics.find((entry) => entry.key === "workouts");
    if (!metric) throw new Error("Missing workout metric");
    const groups = todaySourceGroups(metric, data.timeZone, "zh-CN");
    expect(groups.map(({ rows }) => rows.map((row) => row.exercise))).toEqual([["深蹲", "硬拉"], ["深蹲"]]);
    expect(groups).toHaveLength(metric.value ?? 0);
    const early = await readOverviewPage(ws, new Date("2026-10-25T01:00:00Z"));
    expect(todayDate(early.today, "zh-CN")).toContain("10月24日 星期六");
    expect(todayProjectDate("2026-10-24", early.today, "zh-CN")).toBe("今天");
    expect(todayProjectDate("2026-10-23", early.today, "zh-CN")).toBe("昨天");
    expect(todayProjectDate("2026-10-22", early.today, "zh-CN")).toBe("2天前");
    expect(todayProjectDate("2026-10-17", early.today, "zh-CN")).toBe("10/17");
    expect(todayProjectDate("2025-10-24", early.today, "en")).toBe("2025-10-24");
    expect(
      todaySourceGroups(
        { ...metric, sources: [{ file: "hidden", text: "invalid" }] },
        data.timeZone,
        "zh-CN",
      ),
    ).toEqual([]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it("项目只陈述确有日期的过去日志，不把缺失日志或未来日期当作停滞", () => {
  const project = { slug: "photos", title: "摄影集", stage: "active" };
  const items = [
    { ...project, recentLog: null },
    { ...project, slug: "blank", recentLog: { date: "2026-10-01", text: " " } },
    { ...project, slug: "invalid", recentLog: { date: "2026-02-30", text: "错误日期" } },
    { ...project, slug: "future", recentLog: { date: "2026-12-01", text: "未来计划" } },
    { ...project, slug: "older", recentLog: { date: "2025-10-14", text: "筛选了封面" } },
    { ...project, recentLog: { date: "2026-10-14", text: "从80张筛到34张" } },
  ] as import("../src/types.js").DoingProject[];
  const original = JSON.stringify(items);
  expect(todayProjectFacts(items, "2026-10-24").map((p) => p.slug)).toEqual(["photos"]);
  expect(todayProjectFacts(items.slice(0, 4), "2026-10-24")).toEqual([]);
  expect(JSON.stringify(items)).toBe(original);
});

it("首页从现有原始日志优先取人工进展，只将同步正增量作为后备，读取不改来源", async () => {
  const root = mkdtempSync(join(tmpdir(), "kaitu-project-fact-"));
  try {
    const ws = await initWorkspace(root);
    const { slug } = await createProject(ws, { title: "摄影集", kind: "personal" });
    expect(todayProjectFacts(readProjectsPage(ws), "2026-10-24")).toEqual([]);
    ws.writeText(`projects/${slug}/log.md`, "# 项目进展\n\n## 2026-10-14\n\n从80张筛到34张。\n");
    const facts = todayProjectFacts(readProjectsPage(ws), "2026-10-24");
    expect(facts.map((p) => p.recentLog)).toEqual([{ date: "2026-10-14", text: "从80张筛到34张。" }]);
    const file = `projects/${slug}/log.md`;
    ws.writeText(
      file,
      [
        "# 项目进展",
        "",
        "## 2026-10-24",
        "",
        "- 字数 1,212（+1,200） <!-- sync:words -->",
        "",
        "## 2026-10-23",
        "",
        "- 创建合成示例。",
        "",
      ].join("\n"),
    );
    const original = ws.readText(file);
    expect(todayProjectFacts(readProjectsPage(ws), "2026-10-24")[0]?.recentLog).toEqual({
      date: "2026-10-23",
      text: "创建合成示例。",
    });
    expect(ws.readText(file)).toBe(original);
    for (const text of [
      "字数 12（首次统计） <!-- sync:words -->",
      "字数 12（+0） <!-- sync:words -->",
      "字数 12（-2） <!-- sync:words -->",
      "0 次提交： <!-- sync:commits -->",
    ]) {
      ws.writeText(file, `# 项目进展\n\n## 2026-10-24\n\n- ${text}\n`);
      expect(todayProjectFacts(readProjectsPage(ws), "2026-10-24")).toEqual([]);
    }
    ws.writeText(file, "# 项目进展\n\n## 2026-10-24\n\n- 字数 1,212（+1,200） <!-- sync:words -->\n");
    expect(todayProjectFacts(readProjectsPage(ws), "2026-10-24")[0]?.recentLog).toEqual({
      date: "2026-10-24",
      text: "多写了 1,200 字。",
    });
    ws.writeText(file, "# 项目进展\n\n## 2026-10-24\n\n- 2 次提交：示例一；示例二 <!-- sync:commits -->\n");
    expect(todayProjectFacts(readProjectsPage(ws), "2026-10-24", "en")[0]?.recentLog).toEqual({
      date: "2026-10-24",
      text: "Added 2 commits.",
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
