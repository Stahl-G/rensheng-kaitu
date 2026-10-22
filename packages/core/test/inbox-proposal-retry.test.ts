import { readdirSync, rmSync } from "node:fs";
import { expect, it } from "vitest";
import {
  Workspace,
  parseFrontmatter,
  processInbox,
  stringifyFrontmatter,
  validateWorkspace,
} from "../src/index.js";
import type { PlanBlock } from "../src/workbench.js";
import { freshWorkspace } from "./helpers.js";

const proposal = {
  title: "合成散步安排",
  start: "18:00",
  end: "18:30",
  agent: "synthetic-agent",
  ref: "projects/synthetic/STATUS.md#next",
};
const blocks = (ws: Workspace) =>
  parseFrontmatter<{ blocks: PlanBlock[] }>(ws.readText("NOW.md")).data.blocks;

it("同名同原文连续重送和重新打开只提出一次，不吞独立来源或改过的提案", async () => {
  const original = await freshWorkspace();
  let ws = original;
  try {
    const file = "inbox/agents/walk.proposal.json";
    let first: PlanBlock | undefined;
    for (let turn = 0; turn < 3; turn++) {
      ws.writeJson(file, proposal);
      expect((await processInbox(ws, { stableMs: 0 })).processed).toEqual([file]);
      expect(blocks(ws)).toHaveLength(1);
      first ??= blocks(ws)[0];
      expect(blocks(ws)[0]).toEqual(first);
      ws = new Workspace(ws.root, { maintain: false });
    }
    expect(first).toMatchObject({ ref: proposal.ref, kind: "proposal", status: "pending" });
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

it("归档失败保留原文，部分写入后重开和同时进入不会再新增建议", async () => {
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
    const [one, two] = await Promise.all([
      processInbox(reopened, { stableMs: 20 }),
      processInbox(new Workspace(ws.root, { maintain: false }), { stableMs: 0 }),
    ]);
    expect([...one.processed, ...two.processed]).toEqual([file]);
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
