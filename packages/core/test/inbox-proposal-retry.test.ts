import { readdirSync, rmSync } from "node:fs";
import { expect, it } from "vitest";
import {
  Workspace,
  history,
  inboxNotes,
  listMemories,
  parseFrontmatter,
  processInbox,
  readRecords,
  stringifyFrontmatter,
  validateWorkspace,
} from "../src/index.js";
import { phoneReceipts } from "../src/phone-receipts.js";
import type { PlanBlock } from "../src/workbench.js";
import { freshWorkspace, workout } from "./helpers.js";

const proposal = {
  title: "合成散步安排",
  start: "18:00",
  end: "18:30",
  agent: "synthetic-agent",
  ref: "projects/synthetic/STATUS.md#next",
};
const blocks = (ws: Workspace) =>
  parseFrontmatter<{ blocks: PlanBlock[] }>(ws.readText("NOW.md")).data.blocks;

it("提案、Agent 记录、记忆和笔记重送不重复入账，不吞独立来源或改过的提案", async () => {
  const original = await freshWorkspace();
  let ws = original;
  try {
    const file = "inbox/agents/walk.proposal.json";
    let first: PlanBlock | undefined;
    for (let turn = 0; turn < 3; turn++) {
      ws.writeJson(file, proposal);
      ws.writeText(
        "inbox/agents/walk.records.jsonl",
        `${JSON.stringify({ type: "workout", ...workout, agent: "synthetic-agent" })}\n`,
      );
      ws.writeJson("inbox/agents/walk.memory.json", {
        type: "preference",
        name: "合成偏好",
        text: "喜欢散步",
        agent: "synthetic-agent",
      });
      ws.writeText("inbox/agents/walk.md", "合成散步笔记\n");
      const result = await processInbox(ws, { stableMs: 0 });
      expect(result.processed.length + result.notes.length).toBe(4);
      expect(blocks(ws)).toHaveLength(1);
      expect(readRecords(ws, "workout")).toHaveLength(1);
      expect(listMemories(ws)).toHaveLength(1);
      expect(inboxNotes(ws)).toHaveLength(1);
      first ??= blocks(ws)[0];
      expect(blocks(ws)[0]).toEqual(first);
      ws = new Workspace(ws.root, { maintain: false });
    }
    expect(first).toMatchObject({ ref: proposal.ref, kind: "proposal", status: "pending" });
    expect((await history(ws)).filter((version) => version.message.includes("提出了日程建议"))).toHaveLength(
      1,
    );
    for (const name of ["walk.proposal.json", "walk.records.jsonl", "walk.memory.json", "walk.md"])
      expect(phoneReceipts(ws)).toContainEqual(expect.objectContaining({ ref: name, status: "duplicate" }));
    // 建议从今天计划移除后，持久回执仍防止原文件把它重新加回来。
    const plan = parseFrontmatter<{ blocks: PlanBlock[] }>(ws.readText("NOW.md"));
    ws.writeText("NOW.md", stringifyFrontmatter({ ...plan.data, blocks: [] }, plan.body));
    ws.writeJson(file, proposal);
    await processInbox(new Workspace(ws.root, { maintain: false }), { stableMs: 0 });
    expect(blocks(new Workspace(ws.root, { maintain: false }))).toEqual([]);
    ws.writeJson("inbox/agents/independent.proposal.json", proposal);
    await processInbox(ws, { stableMs: 0 });
    ws.writeJson(file, { ...proposal, end: "19:00" });
    await processInbox(ws, { stableMs: 0 });
    expect(blocks(ws)).toHaveLength(2);
    expect(new Set(blocks(ws).map((block) => block.id)).size).toBe(2);
    expect(validateWorkspace(ws)).toEqual([]);
  } finally {
    rmSync(original.root, { recursive: true, force: true });
  }
});

it("归档失败保留原文，部分写入后重开不会再新增建议", async () => {
  const ws = await freshWorkspace();
  try {
    const file = "inbox/agents/retry.proposal.json";
    ws.writeJson(file, proposal);
    const source = ws.readText(file);
    // 真实文件阻挡归档目录，保留 NOW 已写成功而原文尚未归档的状态。
    ws.writeText("inbox/processed", "synthetic archive obstruction");
    await expect(processInbox(ws, { stableMs: 0 })).rejects.toThrow();
    expect(ws.readText(file)).toBe(source);
    expect(blocks(ws)).toHaveLength(1);
    const saved = blocks(ws)[0];
    // 部分提交恢复：NOW 在、回执尚未落下时，也必须复用同一个建议。
    rmSync(ws.resolve(".kaitu/inbox-records.json", { internal: true }), { force: true });
    rmSync(ws.resolve("inbox/processed"));
    const reopened = new Workspace(ws.root, { maintain: false });
    expect((await processInbox(reopened, { stableMs: 0 })).processed).toEqual([file]);
    expect(blocks(reopened)).toEqual([saved]);
    const directory = readdirSync(reopened.resolve("inbox/processed"))[0];
    expect(reopened.readText(`inbox/processed/${directory}/retry.proposal.json`)).toBe(source);
    reopened.writeText(file, source);
    await processInbox(new Workspace(ws.root, { maintain: false }), { stableMs: 0 });
    expect(blocks(new Workspace(ws.root, { maintain: false }))).toEqual([saved]);
    expect(validateWorkspace(reopened)).toEqual([]);
  } finally {
    rmSync(ws.root, { recursive: true, force: true });
  }
});
