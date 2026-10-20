import { rmSync } from "node:fs";
import { expect, it } from "vitest";
import { assertAgentWrite } from "../src/agent-file-policy.js";
import { completionRate } from "../src/completion-rate.js";
import {
  Workspace,
  addRecord,
  addTask,
  appendPreparedRecords,
  doctor,
  investmentOf,
  listInvestments,
  readExploration,
  readPhases,
  readRecords,
  updateRecord,
  writeAgentRecord,
  writeExploration,
} from "../src/index.js";
import { freshWorkspace } from "./helpers.js";

it("投入合并项目、学习和长期清单，引用优先新字段，悬空引用保存并由 doctor 提示", async () => {
  const ws = await freshWorkspace();
  try {
    rmSync(ws.resolve("me/ongoing.json"));
    expect(listInvestments(ws)).toEqual([]);
    ws.writeText("projects/data/metrics/2026-10.jsonl", "");
    ws.writeText(
      "projects/course/STATUS.md",
      "---\nupdated: null\ntitle: 编程课\nkind: 学习\nstage: active\n---\n",
    );
    ws.writeText("learning/中文主题/STATUS.md", "---\nupdated: null\ntitle: 数学\n---\n");
    ws.writeJson("me/ongoing.json", [{ id: "routine", title: "工作日常", domain: "work", status: "active" }]);
    expect(listInvestments(ws)).toEqual(
      expect.arrayContaining([
        { ref: "project:course", title: "编程课", domain: "learning", form: "project", status: "active" },
        { ref: "learning:中文主题", title: "数学", domain: "learning", form: "ongoing", status: "active" },
        { ref: "ongoing:routine", title: "工作日常", domain: "work", form: "ongoing", status: "active" },
      ]),
    );
    expect(investmentOf({ project: "course" })).toBe("project:course");
    expect(investmentOf({ project: "course", investment: "ongoing:routine" })).toBe("ongoing:routine");
    const task = await addTask(ws, { title: "完成课题", investment: "ongoing:missing" });
    expect(task.record.investment).toBe("ongoing:missing");
    expect((await doctor(ws)).find((check) => check.name === "投入引用有效")?.ok).toBe(false);
    expect(() => assertAgentWrite(ws.root, "me/ongoing.json")).toThrow();
    expect(assertAgentWrite(ws.root, "me/ongoing.json", true)).toBe("me/ongoing.json");
    ws.writeJson("me/ongoing.json", [{ id: "new", title: "新投入", domain: "personal", status: "paused" }]);
    expect(listInvestments(ws).some((item) => item.ref === "ongoing:new")).toBe(true);
  } finally {
    rmSync(ws.root, { recursive: true, force: true });
  }
});

it("阶段权限在通用入口生效，拒绝过期修订和 Agent 确认、回顾及改写用户阶段", async () => {
  const ws = await freshWorkspace();
  try {
    const data = { title: "新工作", start: "2026-10", status: "suggested" as const };
    expect(() => addRecord(ws, "phase", { ...data, status: "confirmed" })).toThrow();
    expect(() => addRecord(ws, "phase", { ...data, reflection: "冒充用户" })).toThrow();
    const created = await writeAgentRecord(ws, "add", "phase", "Synthetic agent", data);
    const id = (created as { record: { id: string } }).record.id;
    expect(() => updateRecord(ws, "phase", id, { title: "修正" })).toThrow();
    updateRecord(ws, "phase", id, { title: "新工作期" }, { by: "agent", expected_revision: 1 });
    expect(() => updateRecord(ws, "phase", id, { status: "confirmed" }, { expected_revision: 1 })).toThrow();
    expect(() => updateRecord(ws, "phase", id, { status: "confirmed" }, { expected_revision: 2 })).toThrow();
    expect(() => updateRecord(ws, "phase", id, { reflection: "回顾" }, { expected_revision: 2 })).toThrow();
    updateRecord(
      ws,
      "phase",
      id,
      { status: "confirmed", reflection: "适应了新节奏" },
      { by: "user", expected_revision: 2 },
    );
    expect(() => updateRecord(ws, "phase", id, { title: "改用户记录" }, { expected_revision: 3 })).toThrow();
    const stored = readPhases(ws)[0] as import("../src/records.js").StoredRecord;
    expect(() =>
      appendPreparedRecords(ws, [
        { type: "phase", record: { ...data, id: stored.id, ts: stored.ts, by: "agent", rev: 1 } },
      ]),
    ).toThrow();
    expect(readPhases(new Workspace(ws.root))[0]).toMatchObject({
      rev: 3,
      status: "confirmed",
      reflection: "适应了新节奏",
    });
    expect(readRecords(ws, "phase")).toHaveLength(1);
  } finally {
    rmSync(ws.root, { recursive: true, force: true });
  }
});

it("独立与挂投入的尝试均可保存，打卡引用真实尝试且不产生虚构方向时间线", async () => {
  const ws = await freshWorkspace();
  try {
    const data = {
      question: "坚持吗",
      action: "每天阅读",
      budget: "10 分钟",
      deadline: "2026-10-30",
      criteria: "是否按计划做到",
    };
    const independent = await writeExploration(ws, { operation: "create_experiment", data });
    const linked = await writeExploration(ws, {
      operation: "create_experiment",
      data: { ...data, investment: "ongoing:reading" },
    });
    await writeExploration(ws, {
      operation: "create_checkin",
      data: { experiment_id: linked.id, date: "2026-10-18", done: true },
    });
    await expect(
      writeExploration(ws, {
        operation: "create_checkin",
        data: { experiment_id: "missing", date: "2026-10-18", done: false },
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const reopened = readExploration(new Workspace(ws.root));
    expect(reopened.experiments.map((item) => item.id)).toEqual(
      expect.arrayContaining([independent.id, linked.id]),
    );
    expect(reopened.checkins).toEqual([expect.objectContaining({ experiment_id: linked.id, done: true })]);
    expect(reopened.timeline).toEqual([]);
  } finally {
    rmSync(ws.root, { recursive: true, force: true });
  }
});

it("完成率与有解析解的 Beta 分位一致，并在混合大样本时保持数值稳定", () => {
  const empty = completionRate([]);
  expect(empty).toMatchObject({ done: 0, total: 0 });
  expect(empty.lower).toBeCloseTo(0.1, 9);
  expect(empty.upper).toBeCloseTo(0.9, 9);
  const success = completionRate([{ done: true }]);
  expect(success.lower).toBeCloseTo(Math.sqrt(0.1), 9);
  expect(success.upper).toBeCloseTo(Math.sqrt(0.9), 9);
  const balanced = completionRate([{ done: true }, { done: false }]);
  expect(balanced.lower).toBeCloseTo(0.1958001056590917, 9);
  expect(balanced.upper).toBeCloseTo(0.8041998943409083, 9);
  const large = completionRate(Array.from({ length: 20000 }, (_, i) => ({ done: i % 2 === 0 })));
  expect(large.lower).toBeGreaterThan(0.49);
  expect(large.upper).toBeLessThan(0.51);
});
