import { rmSync } from "node:fs";
import { expect, it } from "vitest";
import {
  Workspace,
  deferSnapshots,
  listLearning,
  parseFrontmatter,
  readDoing,
  readLearning,
  readLibrary,
  saveLearningCheckin,
  startLearning,
  validateWorkspace,
} from "../src/index.js";
import { freshWorkspace } from "./helpers.js";

it("资料进入既有主题，真实理解与疑问追加保存，重新打开可继续；完成须明确选择", async () => {
  const ws = await freshWorkspace();
  try {
    const snapshots: string[] = [];
    deferSnapshots(ws, (message) => snapshots.push(message));
    const source = {
      title: "合成例子：复利",
      url: "https://example.com/compound",
      text: "已有摘要：增长基数随时间变化。",
    };
    const first = await startLearning(ws, { title: "Compound interest", source });
    expect(first.topic).toBe("compound-interest");
    const firstSource = ws.readText(first.sources[0]?.file ?? "missing.md");
    await startLearning(ws, { title: "Compound interest", source });
    expect(readLearning(ws, first.topic).sources).toHaveLength(1);
    expect(ws.readText(first.sources[0]?.file ?? "missing.md")).toBe(firstSource);
    const saved = await saveLearningCheckin(ws, {
      topic: first.topic,
      operationId: "first-study-0001",
      understanding: "我用本金加利息作为下一期基数。",
      questions: "连续复利怎样理解？",
      next: "用 100 元算两期",
    });
    expect(saved.next[0]?.status).toBe("todo");
    expect(readDoing(ws).learning[0]?.next).toBe("用 100 元算两期");
    expect(readLibrary(ws).notes.some((item) => item.file === `learning/${first.topic}/STATUS.md`)).toBe(
      true,
    );
    await startLearning(ws, {
      topic: first.topic,
      title: "另一个材料",
      source: { title: "补充", text: "合成补充材料" },
    });
    const reopened = new Workspace(ws.root, { maintain: false });
    expect(readLearning(reopened, first.topic).notes).toContain("连续复利怎样理解");
    expect(readLearning(reopened, first.topic).sources).toHaveLength(2);
    const result = await saveLearningCheckin(ws, {
      topic: first.topic,
      operationId: "second-study-0002",
      understanding: "两期后是 121 元。",
      questions: "",
      next: "解释利率减半的影响",
      completedNextId: saved.next[0]?.id,
      completedNextTitle: saved.next[0]?.title,
    });
    expect(result.notes).toContain("我用本金加利息");
    expect(result.notes).toContain("两期后是 121 元");
    expect(result.next.find((item) => item.id === saved.next[0]?.id)?.status).toBe("done");
    expect(result.next[0]?.title).toBe("解释利率减半的影响");
    expect(parseFrontmatter(ws.readText(`learning/${first.topic}/STATUS.md`)).data).not.toHaveProperty(
      "mastery",
    );
    expect(validateWorkspace(ws, "learning")).toEqual([]);
    expect(listLearning(ws)).toHaveLength(1);
    expect(snapshots).toHaveLength(5);
  } finally {
    rmSync(ws.root, { recursive: true, force: true });
  }
});

it("非法输入和过期完成操作不写资料；不同标题的 slug 碰撞不会合并", async () => {
  const ws = await freshWorkspace();
  deferSnapshots(ws, () => {});
  try {
    for (const input of [
      { title: "bad", topic: "../me" },
      { title: "bad", source: { title: "bad", url: "file:///etc/passwd" } },
      { title: "bad", source: { title: "bad", text: "x".repeat(128 * 1024 + 1) } },
    ])
      await expect(startLearning(ws, input)).rejects.toThrow();
    expect(listLearning(ws)).toHaveLength(0);
    const a = await startLearning(ws, { title: "C++" });
    const b = await startLearning(ws, { title: "C#" });
    expect(a.topic).not.toBe(b.topic);
    const before = ws.readText(`learning/${a.topic}/STATUS.md`);
    await expect(
      saveLearningCheckin(ws, {
        topic: a.topic,
        operationId: "invalid-study-0001",
        understanding: "",
        questions: "",
        next: "",
        completedNextId: "missing",
        completedNextTitle: "Missing task",
      }),
    ).rejects.toThrow();
    expect(ws.readText(`learning/${a.topic}/STATUS.md`)).toBe(before);
    expect(ws.exists(`learning/${a.topic}/notes.md`)).toBe(false);
  } finally {
    rmSync(ws.root, { recursive: true, force: true });
  }
});

it("既有 STATUS 简写经过同一规范化可读取、添资料与保存，正文不丢失", async () => {
  const ws = await freshWorkspace();
  deferSnapshots(ws, () => {});
  try {
    const file = "learning/legacy/STATUS.md";
    const body = "# 旧学习主题\n\n保留这段既有正文。\n";
    ws.writeText(file, `---\ntitle: 旧学习主题\nnext: [读一段材料]\n---\n${body}`);
    expect(validateWorkspace(ws, "learning")).toEqual([]);
    expect(readLearning(ws, "legacy").next).toEqual([
      expect.objectContaining({ title: "读一段材料", status: "todo" }),
    ]);
    const source = { title: "合成补充", text: "只供兼容性验证。" };
    const started = await startLearning(ws, { topic: "legacy", title: "旧学习主题", source });
    const oldNext = started.next[0];
    if (!oldNext) throw new Error("missing legacy next");
    const saved = await saveLearningCheckin(ws, {
      topic: "legacy",
      operationId: "legacy-study-0001",
      understanding: "实际读完后的理解。",
      questions: "还需一个例子。",
      next: "练习一个例子",
      completedNextId: oldNext.id,
      completedNextTitle: oldNext.title,
    });
    expect(saved.next.find((item) => item.id === oldNext.id)?.status).toBe("done");
    expect(parseFrontmatter(ws.readText(file)).body).toBe(body);
    expect(saved.sources).toHaveLength(1);
    expect(saved.notes).toContain("实际读完后的理解。");
    expect(validateWorkspace(ws, "learning")).toEqual([]);
  } finally {
    rmSync(ws.root, { recursive: true, force: true });
  }
});

it("同一次已完成保存跨重开重试不重复总结或完成；新操作允许相同学习内容", async () => {
  const ws = await freshWorkspace();
  deferSnapshots(ws, () => {});
  try {
    const topic = await startLearning(ws, { title: "Retry learning" });
    const previous = await saveLearningCheckin(ws, {
      topic: topic.topic,
      operationId: "seed-study-0001",
      understanding: "",
      questions: "",
      next: "做一个例子",
    });
    const input = {
      topic: topic.topic,
      understanding: "我解释了这个例子。",
      questions: "边界是什么？",
      next: "再举反例",
      completedNextId: previous.next[0]?.id,
      completedNextTitle: previous.next[0]?.title,
      operationId: "same-save-0001",
    };
    const first = await saveLearningCheckin(ws, input);
    const statusBefore = ws.readText(`learning/${topic.topic}/STATUS.md`);
    const reopened = new Workspace(ws.root, { maintain: false });
    const retry = await saveLearningCheckin(reopened, input);
    expect(retry.replayed).toBe(true);
    expect(retry.notes).toBe(first.notes);
    expect(reopened.readText(`learning/${topic.topic}/STATUS.md`)).toBe(statusBefore);
    await expect(saveLearningCheckin(ws, { ...input, understanding: "其他内容" })).rejects.toThrow(
      "编号已用于其他内容",
    );
    const again = await saveLearningCheckin(ws, {
      ...input,
      completedNextId: undefined,
      completedNextTitle: undefined,
      operationId: "another-save-0002",
    });
    expect(again.notes.match(/我解释了这个例子。/g)).toHaveLength(2);
    expect(again.replayed).toBe(false);
  } finally {
    rmSync(ws.root, { recursive: true, force: true });
  }
});

it("旧界面不能把相同 id 下已被改名的下一步误标完成", async () => {
  const ws = await freshWorkspace();
  deferSnapshots(ws, () => {});
  try {
    const topic = await startLearning(ws, { title: "Concurrent edit" });
    const original = await saveLearningCheckin(ws, {
      topic: topic.topic,
      operationId: "seed-study-0001",
      understanding: "",
      questions: "",
      next: "读第一节",
    });
    const old = original.next[0];
    if (!old) throw new Error("missing next");
    const path = `learning/${topic.topic}/STATUS.md`;
    const text = ws.readText(path).replace("读第一节", "完成整章");
    ws.writeText(path, text);
    await expect(
      saveLearningCheckin(ws, {
        topic: topic.topic,
        understanding: "旧任务做完。",
        questions: "",
        next: "",
        completedNextId: old.id,
        completedNextTitle: old.title,
        operationId: "stale-save-0001",
      }),
    ).rejects.toThrow("已变化");
    expect(ws.readText(path)).toBe(text);
    expect(readLearning(ws, topic.topic).notes).toBe(original.notes);
    expect(readLearning(ws, topic.topic).next[0]).toMatchObject({
      id: old.id,
      title: "完成整章",
      status: "todo",
    });
  } finally {
    rmSync(ws.root, { recursive: true, force: true });
  }
});
