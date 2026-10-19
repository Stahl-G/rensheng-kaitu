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
      understanding: "两期后是 121 元。",
      questions: "",
      next: "解释利率减半的影响",
      completedNextId: saved.next[0]?.id,
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
        understanding: "",
        questions: "",
        next: "",
        completedNextId: "missing",
      }),
    ).rejects.toThrow();
    expect(ws.readText(`learning/${a.topic}/STATUS.md`)).toBe(before);
    expect(ws.exists(`learning/${a.topic}/notes.md`)).toBe(false);
  } finally {
    rmSync(ws.root, { recursive: true, force: true });
  }
});
