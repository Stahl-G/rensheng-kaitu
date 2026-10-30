import { rmSync, utimesSync, writeFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { normalizeStatus } from "../src/doc-input.js";
import {
  completeNext,
  decideProposal,
  history,
  inboxNotes,
  initWorkspace,
  parseFrontmatter,
  readDoing,
  readStatus,
  readWorkbench,
  refreshOverview,
  scheduleNext,
  snapshot,
  stringifyFrontmatter,
  validateWorkspace,
  workspaceFileStampsAsync,
} from "../src/index.js";
import { userNavigation } from "../src/user-profile.js";
import { freshWorkspace, tmp } from "./helpers.js";

it("工作台复用未变的文档，外部同长度改写、损坏和修复立即可见", async () => {
  const ws = await freshWorkspace();
  try {
    const file = "learning/synthetic/STATUS.md";
    const original = "---\ntitle: 合成旧计划\nupdated: 2026-10-15T00:00:00Z\n---\n原文\n";
    ws.writeText(file, original);
    const old = new Date(Date.now() - 60000);
    utimesSync(ws.resolve(file), old, old);
    const status = () => readWorkbench(ws).statuses.find((item) => item.file === file);
    const reads = vi.spyOn(ws, "readBytes");
    expect(status()?.data.title).toBe("合成旧计划");
    expect(userNavigation(ws).files.find((item) => item.path === file)?.title).toBe("合成旧计划");
    expect(readDoing(ws).learning.find((item) => item.file === file)?.title).toBe("合成旧计划");
    expect(reads.mock.calls.filter(([path]) => path === file)).toHaveLength(1);
    expect(() => {
      const item = status();
      if (item) item.data.title = "意外修改";
    }).toThrow(TypeError);
    writeFileSync(ws.resolve(file), original.replace("旧计划", "新计划"));
    expect(status()?.data.title).toBe("合成新计划");
    expect(userNavigation(ws).files.find((item) => item.path === file)?.title).toBe("合成新计划");
    writeFileSync(ws.resolve(file), "---\ntitle: [broken\n---\n原文\n");
    const broken = readWorkbench(ws);
    expect(broken.statuses.some((item) => item.file === file)).toBe(false);
    expect(broken.warnings.some((warning) => warning.includes(file))).toBe(true);
    expect(userNavigation(ws).files.find((item) => item.path === file)?.title).toBe(file);
    expect(readDoing(ws).learning.find((item) => item.file === file)).toMatchObject({
      error: "INVALID_DOCUMENT",
      title: file,
    });
    writeFileSync(ws.resolve(file), original);
    expect(status()?.data.title).toBe("合成旧计划");
    expect(userNavigation(ws).files.find((item) => item.path === file)?.title).toBe("合成旧计划");
    expect(readDoing(ws).learning.find((item) => item.file === file)?.title).toBe("合成旧计划");
    reads.mockRestore();
  } finally {
    rmSync(ws.root, { recursive: true, force: true });
  }
});

it("现状只计数原文，打开原文列表仍读取完整内容", async () => {
  const ws = await freshWorkspace();
  try {
    for (let i = 0; i < 20; i++) ws.writeText(`inbox/notes/2026-10-20/${i}.md`, `合成原文 ${i}\n`);
    ws.writeText("me/profile.md", "合成档案\n");
    ws.writeText("me/reports/synthetic.md", "合成报告\n");
    ws.writeText("feed/digests/synthetic.md", "合成简报\n");
    const reads = vi.spyOn(ws, "readBytes");
    expect(readStatus(ws).inboxNotes).toBe(20);
    expect(
      reads.mock.calls.filter(
        ([file]) =>
          file.startsWith("inbox/notes/") ||
          file === "me/profile.md" ||
          file.startsWith("me/reports/") ||
          file.startsWith("feed/digests/"),
      ),
    ).toHaveLength(0);
    const full = readWorkbench(ws);
    expect(full.profile).toBe("合成档案\n");
    expect(full.reports[0]?.body).toBe("合成报告\n");
    expect(full.digests[0]?.body).toBe("合成简报\n");
    expect(inboxNotes(ws)).toHaveLength(20);
    expect(reads.mock.calls.filter(([file]) => file.startsWith("inbox/notes/"))).toHaveLength(20);
    const controller = new AbortController();
    await expect(
      workspaceFileStampsAsync(ws, {
        signal: controller.signal,
        progress: () => controller.abort(),
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    const stamps = await workspaceFileStampsAsync(ws);
    expect([...stamps.keys()].filter((file) => file.startsWith("inbox/notes/"))).toHaveLength(20);
    expect(reads.mock.calls.filter(([file]) => file.startsWith("inbox/notes/"))).toHaveLength(20);
    reads.mockRestore();
  } finally {
    rmSync(ws.root, { recursive: true, force: true });
  }
});

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

  it("Agent 手写的 STATUS.md 缺 id 也能读，今天页能完成那一步；无 frontmatter 的交接也算", async () => {
    const ws = await freshWorkspace("Asia/Shanghai");
    ws.writeText(
      "health/STATUS.md",
      "---\nnext:\n  - 晚上 40 分钟力量训练\n  - { title: 买蛋白粉, status: done }\n---\n",
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
    // 文件名里的时间不合法：校验报出来，不让 kaitu doctor 中断
    ws.writeText("handoffs/20261340T2500-grok-bot.md", "## 做了什么\n- 采集资讯\n");
    expect(validateWorkspace(ws).map((issue) => issue.file)).toContain("handoffs/20261340T2500-grok-bot.md");
  });

  it("下一步和日程写了认不出的状态、优先级、类型、时间，校验报给 Agent，写回时不丢", async () => {
    const ws = await freshWorkspace("Asia/Shanghai");
    for (const [status, block] of [
      ["{ title: 跑步, status: 完成 }", '{ title: 会议, start: "10:00", end: "11:00", status: 取消 }'],
      ["{ title: 跑步, status: donee }", '{ title: 会议, start: "10:00", end: "11:00", status: maybe }'],
      ["{ title: 跑步, priority: 很急 }", '{ title: 会议, kind: meetup, start: "10:00", end: "11:00" }'],
    ]) {
      ws.writeText("health/STATUS.md", `---\nnext:\n  - ${status}\n---\n`);
      ws.writeText("NOW.md", `---\ndate: "2026-10-17"\nblocks:\n  - ${block}\n---\n`);
      expect(validateWorkspace(ws).map((issue) => issue.file)).toEqual(
        expect.arrayContaining(["health/STATUS.md", "NOW.md"]),
      );
    }
    // 没标题的下一步、写成空值的进度原样保留给校验，完成别的下一步写回时也不丢
    ws.writeText(
      "health/STATUS.md",
      "---\nprogress: { label: 训练, current: null, target: 12 }\nnext:\n  - 跑步\n  - { status: todo, due: 2026-10-20 }\n---\n",
    );
    expect(validateWorkspace(ws).map((issue) => issue.file)).toContain("health/STATUS.md");
    const run = (
      normalizeStatus(parseFrontmatter(ws.readText("health/STATUS.md")).data).next as {
        id: string;
      }[]
    )[0]?.id as string;
    await expect(completeNext(ws, "health/STATUS.md", run)).rejects.toThrow(/格式不合法/);
    expect(parseFrontmatter<{ next: unknown[] }>(ws.readText("health/STATUS.md")).data.next).toHaveLength(2);
    // 读不出的时间（25:00、9点）原样保留给校验
    ws.writeText("health/STATUS.md", "---\nnext:\n  - 跑步\n---\n");
    ws.writeText(
      "NOW.md",
      '---\ndate: "2026-10-17"\nblocks:\n  - { title: 写周报, kind: task, start: "25:00" }\n  - { title: 晨跑, start: 9点, end: 10点 }\n---\n',
    );
    expect(new Set(validateWorkspace(ws).map((issue) => issue.file))).toEqual(new Set(["NOW.md"]));
  });

  it("--sample 创建的工作区符合已有数据规范", async () => {
    const ws = await initWorkspace(tmp(), { sample: true });
    expect(validateWorkspace(ws)).toEqual([]);
  });
});
