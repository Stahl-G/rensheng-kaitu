import { rmSync } from "node:fs";
import { expect, it } from "vitest";
import { createProject, readOverviewPage, setProject, stringifyFrontmatter } from "../src/index.js";
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
