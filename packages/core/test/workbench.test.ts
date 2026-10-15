import { describe, expect, it } from "vitest";
import {
  completeNext,
  decideProposal,
  history,
  initWorkspace,
  parseFrontmatter,
  snapshot,
  stringifyFrontmatter,
  validateWorkspace,
} from "../src/index.js";
import { freshWorkspace, tmp } from "./helpers.js";

describe("工作台写入", () => {
  it("确认建议和完成 next 只修改目标字段，保留正文并各生成一个合法版本", async () => {
    const ws = await freshWorkspace();
    const body = "# 原文\n\n训练后再决定强度。\n";
    const plan = {
      date: "2026-10-15",
      extra: { keep: true },
      blocks: [
        { id: "p1", title: "腿部训练", kind: "proposal", status: "pending", start: "18:00", end: "19:00" },
        { id: "p2", title: "阅读", kind: "proposal", status: "pending", start: "20:00", end: "21:00" },
      ],
    };
    const status = {
      updated: "2026-10-15T08:00:00+08:00",
      next: [
        { id: "n1", title: "训练", status: "todo", priority: "high" },
        { id: "n2", title: "散步", status: "todo" },
      ],
      custom: [1, 2],
    };
    ws.writeText("NOW.md", stringifyFrontmatter(plan, body));
    ws.writeText("health/STATUS.md", stringifyFrontmatter(status, body));
    await snapshot(ws, "准备计划");
    let count = (await history(ws)).length;
    for (const [id, decision] of [
      ["p1", "confirmed"],
      ["p2", "rejected"],
    ] as const) {
      await decideProposal(ws, id, decision);
      for (const block of plan.blocks) if (block.id === id) block.status = decision;
      expect(parseFrontmatter(ws.readText("NOW.md"))).toEqual({ data: plan, body });
      expect((await history(ws)).length).toBe(++count);
    }
    const now = new Date("2026-10-16T01:00:00Z");
    await completeNext(ws, "health/STATUS.md", "n1", now);
    status.updated = "2026-10-16T09:00:00+08:00";
    for (const item of status.next) if (item.id === "n1") item.status = "done";
    expect(parseFrontmatter(ws.readText("health/STATUS.md"))).toEqual({ data: status, body });
    expect((await history(ws)).length).toBe(++count);
    expect(validateWorkspace(ws)).toEqual([]);
  });

  it("--sample 创建的工作区符合已有数据规范", async () => {
    const ws = await initWorkspace(tmp(), { sample: true });
    expect(validateWorkspace(ws)).toEqual([]);
  });
});
