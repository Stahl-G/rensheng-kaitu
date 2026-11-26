import { rmSync } from "node:fs";
import { expect, it } from "vitest";
import {
  addRecord,
  createProject,
  handoverPack,
  readOverviewPage,
  readRecords,
  refreshOverview,
  setProject,
  stringifyFrontmatter,
} from "../src/index.js";
import { freshWorkspace } from "./helpers.js";

it("全局重点从多个模块排序，保留全部下一步但默认只突出最应处理的三项", async () => {
  const ws = await freshWorkspace();
  try {
    for (const [module, next] of [
      [
        "health",
        [
          { id: "h1", title: "一般训练", status: "todo", priority: "normal" },
          { id: "h2", title: "高优先训练", status: "todo", priority: "high" },
          { id: "h3", title: "已完成", status: "done", priority: "high" },
        ],
      ],
      [
        "me",
        [
          { id: "m1", title: "低优先事务", status: "todo", priority: "low" },
          { id: "m2", title: "过期事项", status: "todo", due: "2020-01-01" },
          { id: "m3", title: "临近截止事项", status: "todo", priority: "high", due: "2026-10-20" },
        ],
      ],
    ] as const)
      ws.writeText(`${module}/STATUS.md`, stringifyFrontmatter({ updated: null, next }, ""));
    const result = await readOverviewPage(ws, new Date("2026-10-16T00:00:00Z"));
    expect(result.next.map((item) => item.id)).toEqual(["m2", "m3", "h2"]);
    expect(result.allNext.map((item) => item.id)).toEqual(["m2", "m3", "h2", "h1", "m1"]);
  } finally {
    rmSync(ws.root, { recursive: true, force: true });
  }
});

it("暂停或完成的项目不进今天的重点，恢复进行后回来", async () => {
  const ws = await freshWorkspace();
  try {
    const { slug } = await createProject(ws, { title: "合成项目", kind: "personal" });
    await setProject(ws, slug, { next: [{ id: "p1", title: "写第一章", status: "todo" }] });
    const ids = async () => (await readOverviewPage(ws)).allNext.map((item) => item.id);
    expect(await ids()).toContain("p1");
    for (const stage of ["paused", "done"] as const) {
      await setProject(ws, slug, { stage });
      expect(await ids()).not.toContain("p1");
    }
    await setProject(ws, slug, { stage: "active" });
    expect(await ids()).toContain("p1");
  } finally {
    rmSync(ws.root, { recursive: true, force: true });
  }
});

it("过期计划保留原文并标旧；资料包不把过期下一步当成现在要做的事", async () => {
  const ws = await freshWorkspace("Asia/Shanghai");
  try {
    // 上海已经到 10 月 16 日；UTC 仍是 15 日。
    const now = new Date("2026-10-15T17:00:00Z");
    const oldPlan = stringifyFrontmatter(
      {
        date: "2026-10-15",
        blocks: [{ id: "old", title: "昨天的安排", kind: "task", status: "pending" }],
      },
      "",
    );
    ws.writeText("NOW.md", oldPlan);
    ws.writeText(
      "me/STATUS.md",
      stringifyFrontmatter(
        {
          updated: null,
          next: [
            { id: "later", title: "旧模块步骤", status: "todo", due: "2026-10-15" },
            { id: "today", title: "今天模块步骤", status: "todo", due: "2026-10-16" },
          ],
        },
        "",
      ),
    );
    ws.writeJson("me/goals.json", [
      { id: "goal-test", title: "继续试一件事", status: "active", due: "2026-10-15" },
    ]);
    const add = (title: string, due: string, source?: string) =>
      addRecord(
        ws,
        "task",
        { title, due, status: "open", ...(source ? { source } : {}) },
        { by: "user", now },
      );
    const old = add("过期的目标下一步", "2026-10-15", "me/goals.json#goal-test").record;
    add("已过时刻的下一步", "2026-10-16T00:30:00+08:00");
    add("今天的新一步", "2026-10-16");
    add("当天尚未到时的一步", "2026-10-16T04:00:00+08:00");

    const pack = handoverPack(ws, "zh-CN", now);
    expect(pack.text).toContain("继续试一件事（原截止日 2026-10-15 已过，待重定）");
    expect(pack.text).toContain("今天的新一步");
    expect(pack.text).toContain("当天尚未到时的一步");
    expect(pack.text).not.toContain("过期的目标下一步");
    expect(pack.text).not.toContain("已过时刻的下一步");

    refreshOverview(ws, now);
    const overview = ws.readText("OVERVIEW.md");
    expect(overview).toContain("## 历史计划 · 已过期（2026-10-15）");
    expect(overview.split("## 历史计划")[0]).not.toContain("昨天的安排");
    expect(overview).toContain("昨天的安排");
    expect(overview).toContain("旧模块步骤（todo / 已过期） 截止：2026-10-15");
    expect(overview).toContain("今天模块步骤（todo） 截止：2026-10-16");
    expect(ws.readText("NOW.md")).toBe(oldPlan);
    expect(readRecords(ws, "task")).toContainEqual(expect.objectContaining({ id: old.id, status: "open" }));
  } finally {
    rmSync(ws.root, { recursive: true, force: true });
  }
});
