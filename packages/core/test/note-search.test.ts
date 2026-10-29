import { renameSync, rmSync, writeFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
import { deferSnapshots, readLearning, restore, saveLearningCheckin, startLearning } from "../src/index.js";
import { disposeNoteIndex, searchLibraryNotes } from "../src/note-search.js";
import { clonedWorkspace } from "./helpers.js";

it("正常保存的学习正文可搜索并打开所属主题，后续保存和仅正文更新会刷新索引", async () => {
  const ws = await clonedWorkspace();
  deferSnapshots(ws, () => {});
  try {
    const topic = await startLearning(ws, { title: "合成植物学习" });
    const file = `learning/${topic.topic}/STATUS.md`;
    const notes = `learning/${topic.topic}/notes.md`;
    await saveLearningCheckin(ws, {
      topic: topic.topic,
      operationId: "body-search-first",
      understanding: "银杏气孔调节蒸腾。 Only the learning body contains 50%_value.",
      questions: "叶脉如何运输？",
      next: "",
    });
    expect(ws.readText(file)).not.toContain("银杏气孔");
    expect(await searchLibraryNotes(ws, "银杏气孔")).toEqual([
      expect.objectContaining({ file, title: topic.title, snippet: expect.stringContaining("银杏气孔") }),
    ]);
    const result = (await searchLibraryNotes(ws, "ONLY THE LEARNING BODY"))[0];
    expect(readLearning(ws, result?.file.split("/")[1] ?? "").notes).toContain("银杏气孔");
    expect(await searchLibraryNotes(ws, "%_")).toHaveLength(1);
    await saveLearningCheckin(ws, {
      topic: topic.topic,
      operationId: "body-search-second",
      understanding: "梧桐叶片也会蒸腾。",
      questions: "",
      next: "",
    });
    expect(await searchLibraryNotes(ws, "梧桐叶片")).toHaveLength(1);
    ws.writeText(notes, "只保留枫树叶绿素的学习记录。");
    expect(await searchLibraryNotes(ws, "银杏气孔")).toEqual([]);
    expect(await searchLibraryNotes(ws, "枫树叶绿素")).toHaveLength(1);
    const read = vi.spyOn(ws, "readText");
    expect(await searchLibraryNotes(ws, "枫树")).toHaveLength(1);
    expect(read).not.toHaveBeenCalled();
  } finally {
    disposeNoteIndex(ws);
    rmSync(ws.root, { recursive: true, force: true });
  }
});

it("学习正文外部修改、删除和版本恢复保持一致，索引与摘要去掉密钥和本机路径", async () => {
  const ws = await clonedWorkspace();
  try {
    const topic = await startLearning(ws, { title: "合成版本学习" });
    const file = `learning/${topic.topic}/STATUS.md`;
    const notes = `learning/${topic.topic}/notes.md`;
    const secret = "sk-syntheticSearchFixture000000000000";
    const saved = await saveLearningCheckin(ws, {
      topic: topic.topic,
      operationId: "body-search-restore",
      understanding: `合成恢复正文 ${secret} /Users/synthetic/private-body.txt`,
      questions: "",
      next: "",
    });
    const found = await searchLibraryNotes(ws, "合成恢复正文");
    expect(found).toHaveLength(1);
    expect(found[0]?.snippet).not.toContain(secret);
    expect(found[0]?.snippet).not.toContain("/Users/");
    expect(await searchLibraryNotes(ws, "syntheticSearchFixture")).toEqual([]);
    expect(await searchLibraryNotes(ws, "private-body.txt")).toEqual([]);
    writeFileSync(ws.resolve(notes), "外部改为合成雨林正文。");
    await vi.waitFor(async () => {
      expect(await searchLibraryNotes(ws, "合成雨林正文")).toHaveLength(1);
      expect(await searchLibraryNotes(ws, "合成恢复正文")).toEqual([]);
    });
    rmSync(ws.resolve(notes));
    await vi.waitFor(async () => expect(await searchLibraryNotes(ws, "合成雨林正文")).toEqual([]));
    await restore(ws, saved.version as string, { path: notes });
    expect((await searchLibraryNotes(ws, "合成恢复正文"))[0]?.file).toBe(file);
    rmSync(ws.resolve(`learning/${topic.topic}`), { recursive: true });
    await vi.waitFor(async () => expect(await searchLibraryNotes(ws, "合成恢复正文")).toEqual([]));
    await restore(ws, saved.version as string, { path: `learning/${topic.topic}` });
    expect((await searchLibraryNotes(ws, "合成恢复正文"))[0]?.file).toBe(file);
  } finally {
    disposeNoteIndex(ws);
    rmSync(ws.root, { recursive: true, force: true });
  }
});

it("正文索引支持中英文、转义、修改、重命名和删除，热搜索不读资料文件", async () => {
  const ws = await clonedWorkspace();
  const file = "decisions/synthetic/STATUS.md";
  try {
    ws.writeText(file, "---\ntitle: 合成决定\n---\n\nOnly the body contains 海边散步 and 50%_value.");
    expect(await searchLibraryNotes(ws, "海边")).toEqual([
      expect.objectContaining({ file, title: "合成决定" }),
    ]);
    const read = vi.spyOn(ws, "readText");
    expect(await searchLibraryNotes(ws, "ONLY THE BODY")).toHaveLength(1);
    expect(await searchLibraryNotes(ws, "%_")).toHaveLength(1);
    expect(read).not.toHaveBeenCalled();
    ws.writeText(file, "---\ntitle: 合成决定\n---\n\nChanged to 山间散步.");
    expect(await searchLibraryNotes(ws, "海边")).toEqual([]);
    expect(await searchLibraryNotes(ws, "山间")).toHaveLength(1);
    renameSync(ws.resolve("decisions/synthetic"), ws.resolve("decisions/renamed"));
    await vi.waitFor(async () =>
      expect((await searchLibraryNotes(ws, "山间"))[0]?.file).toBe("decisions/renamed/STATUS.md"),
    );
    rmSync(ws.resolve("decisions/renamed"), { recursive: true });
    await vi.waitFor(async () => expect(await searchLibraryNotes(ws, "山间")).toEqual([]));
  } finally {
    disposeNoteIndex(ws);
    rmSync(ws.root, { recursive: true, force: true });
  }
});
