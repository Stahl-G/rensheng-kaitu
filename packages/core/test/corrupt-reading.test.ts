import { rmSync, writeFileSync } from "node:fs";
import { expect, it } from "vitest";
import {
  addRecord,
  deferSnapshots,
  readLearning,
  readLibrary,
  readOverviewPage,
  readRecords,
  readWorkbench,
  startLearning,
  updateRecord,
  writePhoneSnapshots,
} from "../src/index.js";
import { disposeNoteIndex, searchLibraryNotes } from "../src/note-search.js";
import { clonedWorkspace } from "./helpers.js";

it("a bad topic header keeps other notes searchable, reports the bad item, and recovers after external repair", async () => {
  const ws = await clonedWorkspace();
  deferSnapshots(ws, () => {});
  try {
    const good = await startLearning(ws, { title: "Healthy synthetic topic" });
    const bad = await startLearning(ws, { title: "Broken synthetic topic" });
    const file = `learning/${bad.topic}/STATUS.md`;
    const original = ws.readText(file);
    const broken = "---\ntitle: [unfinished\n---\n# Broken topic\nSyntheticbadneedle original text.\n";
    ws.writeText(file, broken);
    const notes = readLibrary(ws, { section: "notes" }).notes;
    expect(notes.find((note) => note.file === `learning/${good.topic}/STATUS.md`)?.title).toBe(good.title);
    expect(notes.find((note) => note.file === file)?.status).toContain("文件格式有误");
    expect((await searchLibraryNotes(ws, "Healthy"))[0]?.title).toBe(good.title);
    expect((await searchLibraryNotes(ws, "Syntheticbadneedle"))[0]?.snippet).toContain("Invalid document");
    expect(readWorkbench(ws).warnings.some((warning) => warning.includes(file))).toBe(true);
    expect(() => readLearning(ws, bad.topic)).toThrow();
    await writePhoneSnapshots(ws, new Date("2026-10-29T12:00:00Z"), { force: true });
    expect(ws.readJson<{ format: string }>("phone/map.json").format).toBe("kaitu.phone.map");
    expect(ws.readText(file)).toBe(broken);
    writeFileSync(ws.resolve(file), original);
    await expect
      .poll(async () =>
        (await searchLibraryNotes(ws, "Broken synthetic")).map((row) => ({
          file: row.file,
          invalid: row.snippet.includes("Invalid document"),
        })),
      )
      .toEqual([{ file, invalid: false }]);
    expect(readLibrary(ws, { section: "notes" }).notes.find((note) => note.file === file)?.status).toBeNull();
    expect(await searchLibraryNotes(ws, "Syntheticbadneedle")).toEqual([]);
  } finally {
    disposeNoteIndex(ws);
    rmSync(ws.root, { recursive: true, force: true });
  }
});

it("a corrupt record line preserves readable rows and strict writes; phone failures leave bad files untouched while other snapshots refresh", async () => {
  const ws = await clonedWorkspace();
  deferSnapshots(ws, () => {});
  try {
    const first = addRecord(ws, "task", { title: "First synthetic task", status: "open" }, { by: "user" });
    const second = addRecord(ws, "task", { title: "Second synthetic task", status: "open" }, { by: "user" });
    await writePhoneSnapshots(ws, new Date("2026-10-29T12:00:00Z"), { force: true });
    const beforeToday = ws.readText("phone/today.json");
    const original = ws.readText(first.file);
    const lines = original.trimEnd().split("\n");
    const broken = `${lines[0]}\n{"truncated":\n${lines.slice(1).join("\n")}\n`;
    ws.writeText(first.file, broken);
    const data = readWorkbench(ws);
    expect(data.records.task?.map((row) => row.id)).toEqual([first.record.id, second.record.id]);
    expect(data.warnings).toContain(`${first.file}:2 记录格式不合法`);
    expect(() => readRecords(ws, "task")).toThrow("记录格式不合法");
    expect(() => updateRecord(ws, "task", first.record.id, { status: "done" }, { by: "user" })).toThrow(
      "记录格式不合法",
    );
    ws.writeText("me/goals.json", '[{"id":');
    expect((await readOverviewPage(ws)).warnings.some((warning) => warning.startsWith("目标"))).toBe(true);
    const truncated = '{"format":"kaitu.phone.library"';
    ws.writeText("phone/library.json", truncated);
    const now = new Date("2026-10-30T12:00:00Z");
    await expect(writePhoneSnapshots(ws, now, { force: true })).rejects.toThrow("phone/today.json");
    expect(ws.readText("phone/today.json")).toBe(beforeToday);
    expect(ws.readText("phone/library.json")).toBe(truncated);
    expect(ws.readJson<{ generated_at: string }>("phone/week.json").generated_at).toBe(now.toISOString());
    expect(ws.readJson<{ generated_at: string }>("phone/map.json").generated_at).toBe(now.toISOString());
    expect(ws.readText(first.file)).toBe(broken);
    expect(ws.readText("me/goals.json")).toBe('[{"id":');
    ws.writeText(first.file, original);
    expect(readWorkbench(ws).warnings).not.toContain(`${first.file}:2 记录格式不合法`);
    expect(readRecords(ws, "task")).toHaveLength(2);
  } finally {
    rmSync(ws.root, { recursive: true, force: true });
  }
});
