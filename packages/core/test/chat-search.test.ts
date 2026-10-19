import { rmSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { searchChats } from "../src/chat-search.js";
import { isTracked, snapshot } from "../src/history.js";
import { freshWorkspace } from "./helpers.js";

describe("对话检索", () => {
  it("中文短词、长词与英文都能搜到；删掉索引后结果不变；索引不进版本历史", async () => {
    const ws = await freshWorkspace();
    const file = "chats/2026/10/training.jsonl";
    const rows = [
      {
        type: "chat",
        id: "training",
        title: "训练安排",
        source: "chatgpt",
        created: "2026-10-15T08:00:00+08:00",
        updated: "2026-10-15T08:00:00+08:00",
      },
      { type: "message", id: "m1", role: "user", ts: null, text: "开始力量训练计划，Strength training。" },
    ];
    ws.writeText(file, `${rows.map((r) => JSON.stringify(r)).join("\n")}\n`);

    for (const q of ["力量", "力量训练计划", "STRENGTH"]) {
      expect(
        searchChats(ws, q).map((r) => r.file),
        q,
      ).toEqual([file]);
    }
    for (let i = 0; i < 120; i++) {
      const other = `chats/2026/10/archive-${i}.jsonl`;
      ws.writeText(
        other,
        `${JSON.stringify({ ...rows[0], id: `archive-${i}`, title: "旧对话" })}\n${JSON.stringify({ ...rows[1], text: "归档正文".repeat(1000) })}\n`,
      );
    }
    searchChats(ws, "力量训练");
    const reads = vi.spyOn(ws, "readBytes");
    let before = searchChats(ws, "力量训练");
    expect(reads).not.toHaveBeenCalled();
    ws.writeText(
      file,
      `${rows.map((r) => JSON.stringify(r)).join("\n")}\n${JSON.stringify({ ...rows[1], id: "m2", text: "增量更新的内容" })}\n`,
    );
    reads.mockClear();
    expect(searchChats(ws, "增量更新").map((r) => r.file)).toEqual([file]);
    expect(reads.mock.calls.map(([path]) => path)).toEqual([file]);
    reads.mockRestore();
    before = searchChats(ws, "力量训练");
    rmSync(ws.resolve(".kaitu/index.sqlite", { internal: true }));
    expect(searchChats(ws, "力量训练")).toEqual(before);

    await snapshot(ws, "保存对话");
    expect(await isTracked(ws, ".kaitu/index.sqlite")).toBe(false);
  });
});
