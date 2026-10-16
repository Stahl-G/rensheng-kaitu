import { rmSync } from "node:fs";
import { expect, it } from "vitest";
import {
  Workspace,
  addRecord,
  createProject,
  history,
  readExploration,
  readExplorationSource,
  readRecordRevisions,
  writeAgentRecord,
  writeExploration,
} from "../src/index.js";
import { freshWorkspace } from "./helpers.js";

it("真实尝试的完成与假设判断分开，负面结果可暂停方向，依据、关联和修订在重启后保留", async () => {
  const ws = await freshWorkspace();
  try {
    const project = await createProject(ws, { title: "Writing project", kind: "personal" });
    ws.writeText("decisions/writing/STATUS.md", "---\nupdated: null\nnext: []\ntitle: 写作投入\n---\n");
    ws.writeText("decisions/writing/decision.md", "只投入两个周末，再根据真实读者反馈决定。\n");
    ws.writeText("me/sources/interview.md", "访谈笔记\n三位读者都不愿意继续阅读当前版本。\n");
    const created = await writeExploration(
      ws,
      {
        operation: "create_direction",
        data: {
          title: "短篇连载是否有人持续阅读",
          motivation: "想找到可持续的创作方式",
          hypothesis: "读完第一篇的人会回来读第二篇",
          references: [
            { kind: "project", ref: project.slug },
            { kind: "decision", ref: "decisions/writing/decision.md" },
          ],
        },
      },
      "user",
    );
    const attempt = await writeExploration(
      ws,
      {
        operation: "create_experiment",
        data: {
          direction_id: created.id,
          question: "是否愿意回来",
          action: "发两篇给三名志愿读者",
          budget: "两个周末，不花钱",
          deadline: "2026-10-30",
          criteria: "主动回来读第二篇的人数",
        },
      },
      "user",
    );
    const before = await history(ws);
    await expect(
      writeExploration(
        ws,
        {
          operation: "update_experiment",
          id: attempt.id,
          expected_revision: 1,
          data: { status: "completed" },
        },
        "user",
      ),
    ).rejects.toMatchObject({ code: "RESULT_REQUIRED" });
    expect((await history(ws)).length).toBe(before.length);
    await writeExploration(
      ws,
      {
        operation: "update_experiment",
        id: attempt.id,
        expected_revision: 1,
        data: {
          status: "completed",
          result: "三人完成首篇，没人愿意继续",
          source: "me/sources/interview.md#L2",
        },
      },
      "user",
    );
    expect(readExploration(ws).experiments[0]?.conclusion).toBe("unassessed");
    expect(readExploration(ws).directions[0]?.status).toBe("active");
    await writeExploration(
      ws,
      {
        operation: "update_experiment",
        id: attempt.id,
        expected_revision: 2,
        data: { conclusion: "refutes" },
      },
      "user",
    );
    const note = await writeExploration(
      ws,
      {
        operation: "add_note",
        data: {
          direction_id: created.id,
          experiment_id: attempt.id,
          kind: "evidence",
          stance: "refutes",
          text: "当前开篇没有产生继续阅读的意愿",
          source: "me/sources/interview.md#L2",
        },
      },
      "user",
    );
    await writeExploration(
      ws,
      {
        operation: "update_direction",
        id: created.id,
        expected_revision: 1,
        data: { status: "paused", favorite: true, hypothesis: "需要先改进开篇，再重新观察回访意愿" },
      },
      "user",
    );
    const second = new Workspace(ws.root);
    const read = readExploration(second);
    expect(read.directions[0]).toMatchObject({ id: created.id, status: "paused", favorite: true });
    expect(read.directions[0]?.motivation).toBe("想找到可持续的创作方式");
    expect(read.experiments[0]).toMatchObject({
      id: attempt.id,
      status: "completed",
      conclusion: "refutes",
      result: "三人完成首篇，没人愿意继续",
    });
    expect(read.notes[0]).toMatchObject({
      id: note.id,
      experiment_id: attempt.id,
      stance: "refutes",
      question: "是否愿意回来",
    });
    expect(
      read.timeline.some(
        (e) =>
          e.before === "读完第一篇的人会回来读第二篇" && e.after === "需要先改进开篇，再重新观察回访意愿",
      ),
    ).toBe(true);
    expect((await readExplorationSource(second, "direction_note", note.id)).kind).toBe("local");
    expect((await readExplorationSource(second, "exploration_experiment", attempt.id)).kind).toBe("local");
    const linked = await readExplorationSource(second, "direction", created.id, 1);
    expect(linked.kind === "local" && linked.text.includes("两个周末")).toBe(true);
    await writeExploration(
      second,
      { operation: "update_direction", id: created.id, expected_revision: 2, data: { status: "archived" } },
      "user",
    );
    expect(readExploration(second).notes).toHaveLength(1);
    expect(readExploration(second).experiments).toHaveLength(1);
    expect(readRecordRevisions(second, "direction")).toHaveLength(3);
  } finally {
    rmSync(ws.root, { recursive: true, force: true });
  }
});

it("AI 提议不替用户采纳，旧版本不能覆盖新状态，错方向的关联不产生写入", async () => {
  const ws = await freshWorkspace();
  try {
    const first = await writeExploration(
      ws,
      {
        operation: "create_direction",
        data: { title: "方向 A", motivation: "了解兴趣", hypothesis: "值得做一次小尝试" },
      },
      "agent",
    );
    expect(readExploration(ws).directions[0]?.status).toBe("suggested");
    expect(() =>
      addRecord(
        ws,
        "direction",
        {
          title: "未经采纳",
          motivation: "自动写入",
          hypothesis: "不该激活",
          status: "active",
          favorite: false,
        },
        { by: "agent" },
      ),
    ).toThrow();
    const input = {
      direction_id: first.id,
      question: "兴趣是否持续",
      action: "试着写一篇",
      budget: "一小时",
      deadline: "2026-10-20",
      criteria: "写完后是否还想继续",
    };
    await expect(
      writeExploration(ws, { operation: "create_experiment", data: input }, "agent"),
    ).rejects.toMatchObject({ code: "DIRECTION_INACTIVE" });
    await expect(
      writeExploration(
        ws,
        { operation: "update_direction", id: first.id, expected_revision: 1, data: { status: "active" } },
        "agent",
      ),
    ).rejects.toMatchObject({ code: "USER_DECISION" });
    await expect(
      writeAgentRecord(ws, "update", "direction", "Agent", { status: "active" }, first.id),
    ).rejects.toMatchObject({ code: "USE_EXPLORATION_API" });
    await writeExploration(
      ws,
      { operation: "update_direction", id: first.id, expected_revision: 1, data: { status: "active" } },
      "user",
    );
    const before = await history(ws);
    await expect(
      writeExploration(
        ws,
        { operation: "update_direction", id: first.id, expected_revision: 1, data: { status: "archived" } },
        "user",
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await history(ws)).length).toBe(before.length);
    const experiment = await writeExploration(ws, { operation: "create_experiment", data: input }, "agent");
    const other = await writeExploration(
      ws,
      {
        operation: "create_direction",
        data: { title: "方向 B", motivation: "另一个问题", hypothesis: "不同假设" },
      },
      "user",
    );
    await expect(
      writeExploration(
        ws,
        {
          operation: "add_note",
          data: {
            direction_id: other.id,
            experiment_id: experiment.id,
            kind: "evidence",
            stance: "unclear",
            text: "不能错连另一方向的结果",
          },
        },
        "agent",
      ),
    ).rejects.toMatchObject({ code: "BAD_REFERENCE" });
    expect(readExploration(ws).directions.find((d) => d.id === first.id)?.status).toBe("active");
    expect(readExploration(ws).notes).toHaveLength(0);
  } finally {
    rmSync(ws.root, { recursive: true, force: true });
  }
});
