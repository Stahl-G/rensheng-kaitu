import { renameSync, rmSync } from "node:fs";
import { expect, it, vi } from "vitest";
import { disposeNoteIndex, searchLibraryNotes } from "../src/note-search.js";
import { freshWorkspace } from "./helpers.js";

it("正文索引支持中英文、转义、修改、重命名和删除，热搜索不读资料文件", async () => {
  const ws = await freshWorkspace();
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
