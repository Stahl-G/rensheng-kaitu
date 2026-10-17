import { describe, expect, it } from "vitest";
import {
  completeNext,
  decideProposal,
  history,
  initWorkspace,
  parseFrontmatter,
  readStatus,
  refreshOverview,
  scheduleNext,
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

  it("Agent 手写的 STATUS.md 缺 id、状态写成完成、updated 只写日期也能读，今天页能完成那一步；无 frontmatter 的交接也算", async () => {
    const ws = await freshWorkspace("Asia/Shanghai");
    ws.writeText(
      "health/STATUS.md",
      "---\nupdated: 2026-10-17\nnext:\n  - 晚上 40 分钟力量训练\n  - { title: 买蛋白粉, status: 完成 }\n---\n",
    );
    const health = readStatus(ws).modules.find((module) => module.file === "health/STATUS.md");
    const next = health?.next ?? [];
    expect(next.map((item) => [item.title, item.status])).toEqual([
      ["晚上 40 分钟力量训练", "todo"],
      ["买蛋白粉", "done"],
    ]);
    await completeNext(ws, "health/STATUS.md", next[0]?.id as string);
    expect(
      readStatus(ws).modules.find((module) => module.file === "health/STATUS.md")?.next?.[0]?.status,
    ).toBe("done");
    ws.writeText("handoffs/20261017T0647-grok-bot.md", "## 做了什么\n- 采集资讯\n## 当前下一步\n- 写小说\n");
    refreshOverview(ws);
    expect(ws.readText("OVERVIEW.md")).toContain("grok-bot");
    expect(validateWorkspace(ws)).toEqual([]);
  });

  it("完成别的下一步、整份写回时，带时间的截止不丢时间", async () => {
    const ws = await freshWorkspace("Asia/Shanghai");
    ws.writeText(
      "health/STATUS.md",
      '---\nnext:\n  - 散步\n  - { title: 复查, due: "2026-10-18T14:00:00+08:00" }\n---\n',
    );
    const next = readStatus(ws).modules.find((module) => module.file === "health/STATUS.md")?.next ?? [];
    // 没写 id 的下一步也能排时间（id 和今天页看到的一样）。
    await scheduleNext(ws, "health/STATUS.md", next[1]?.id as string, "09:00", "10:00");
    await completeNext(ws, "health/STATUS.md", next[0]?.id as string);
    const saved = parseFrontmatter<{ next: { title: string }[] }>(ws.readText("health/STATUS.md")).data.next;
    expect(saved.find((item) => item.title === "复查")).toMatchObject({
      due: "2026-10-18",
      when: "2026-10-18T14:00:00+08:00",
    });
  });

  it("下一步和日程的状态、优先级、类型认常见写法，写了却认不出的报格式错误，不悄悄改成别的", async () => {
    const ws = await freshWorkspace("Asia/Shanghai");
    ws.writeText(
      "health/STATUS.md",
      "---\nnext:\n  - { title: 跑步, status: closed, priority: urgent }\n---\n",
    );
    ws.writeText(
      "NOW.md",
      '---\ndate: "2026-10-17"\nblocks:\n  - { title: 会议, kind: appointment, start: "10:00", end: "11:00", status: cancelled }\n---\n',
    );
    expect(
      readStatus(ws).modules.find((module) => module.file === "health/STATUS.md")?.next?.[0],
    ).toMatchObject({
      status: "done",
      priority: "high",
    });
    expect(validateWorkspace(ws)).toEqual([]);
    for (const [status, block] of [
      ["{ title: 跑步, status: donee }", '{ title: 会议, start: "10:00", end: "11:00", status: maybe }'],
      ["{ title: 跑步, priority: 很急 }", '{ title: 会议, kind: meetup, start: "10:00", end: "11:00" }'],
    ]) {
      ws.writeText("health/STATUS.md", `---\nnext:\n  - ${status}\n---\n`);
      ws.writeText("NOW.md", `---\ndate: "2026-10-17"\nblocks:\n  - ${block}\n---\n`);
      expect(validateWorkspace(ws).map((issue) => issue.file)).toEqual(
        expect.arrayContaining(["health/STATUS.md", "NOW.md"]),
      );
    }
    // 写了却读不出的时间（25:00）原样保留给校验，不悄悄删掉
    ws.writeText("health/STATUS.md", "---\nnext:\n  - 跑步\n---\n");
    ws.writeText(
      "NOW.md",
      '---\ndate: "2026-10-17"\nblocks:\n  - { title: 写周报, kind: task, start: "25:00" }\n---\n',
    );
    expect(validateWorkspace(ws).map((issue) => issue.file)).toEqual(["NOW.md"]);
  });

  it("--sample 创建的工作区符合已有数据规范", async () => {
    const ws = await initWorkspace(tmp(), { sample: true });
    expect(validateWorkspace(ws)).toEqual([]);
  });
});
