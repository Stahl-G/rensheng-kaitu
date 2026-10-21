import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { inboxNotes } from "../src/inbox-notes.js";
import { readLibrary, readLibraryDocument } from "../src/library.js";
import { completeNext, statusFiles } from "../src/workbench.js";
import { freshWorkspace, tmp } from "./helpers.js";

it("资料目录不读正文，收件箱逐页遍历及来源筛选不漏项，单份详情不读取无关资料或附件", async () => {
  const ws = await freshWorkspace();
  try {
    const create = (file: string, text: string) => {
      mkdirSync(join(ws.root, file, ".."), { recursive: true });
      writeFileSync(join(ws.root, file), text);
    };
    const expected: string[] = [];
    for (let i = 0; i < 125; i++) {
      const path = `inbox/notes/${i % 2 ? "done/" : ""}2026-10-19/${String(i).padStart(3, "0")}.md`;
      create(path, `---\nkind: capture\ndate: 2026-10-19\n---\n合成原文 ${i}\n`);
      expected.push(path);
    }
    const mail = "inbox/notes/2026-10-01/channel.note.md";
    create(mail, "---\nagent: 只读采集 · gmail\ndate: 2026-10-01\n---\n合成邮件正文\n");
    expected.push(mail);
    const doc = "decisions/example/STATUS.md";
    create(doc, "---\nupdated: null\n---\n# 合成决定\n");
    create("health/data/workouts/2026-10.jsonl", "无关的损坏数据\n");
    for (let i = 0; i < 100; i++) create(`health/files/attachments/${i}/image.bin`, "合成附件");
    create(
      "custom/module.json",
      JSON.stringify({ id: "custom", name: "合成模块", version: 1, visibility: "agent" }),
    );
    create("custom/nested/topic/STATUS.md", "---\nupdated: null\n---\n自建嵌套主题\n");
    create(
      "learning/files/STATUS.md",
      "---\nupdated: null\nnext:\n  - id: topic-next\n    title: 合法主题下一步\n    status: todo\n---\n# files 主题\n",
    );
    create("custom/nested/files/STATUS.md", "---\nupdated: null\n---\n合法自建主题\n");
    const reads = vi.spyOn(ws, "readBytes");
    const summary = readLibrary(ws, { section: "summary" });
    expect(summary.sections.some((section) => section.id === "inbox")).toBe(true);
    expect(reads).not.toHaveBeenCalled();
    const first = readLibrary(ws, { section: "inbox" });
    expect(first.inbox).toHaveLength(40);
    expect(reads.mock.calls).toHaveLength(41);
    expect(reads.mock.calls.every(([file]) => file.startsWith("inbox/notes/"))).toBe(true);
    const seen = first.inbox.map((row) => row.file);
    let before = first.next;
    while (before) {
      const page = readLibrary(ws, { section: "inbox", before });
      seen.push(...page.inbox.map((row) => row.file));
      before = page.next;
    }
    expect(seen.sort()).toEqual(expected.sort());
    expect(readLibrary(ws, { section: "inbox", source: "mail" }).inbox.map((row) => row.file)).toEqual([
      mail,
    ]);
    reads.mockClear();
    expect(readLibraryDocument(ws, doc)).toContain("合成决定");
    expect(reads.mock.calls.map(([file]) => file)).toEqual([doc]);
    const outside = tmp();
    mkdirSync(join(outside, "topic"));
    writeFileSync(join(outside, "topic/STATUS.md"), "不能读取");
    symlinkSync(join(outside, "topic"), join(ws.root, "decisions/escape"));
    expect(() => readLibraryDocument(ws, "decisions/escape/STATUS.md")).toThrow();
    expect(() => readLibraryDocument(ws, "decisions/../me/STATUS.md")).toThrow();
    expect(() => readLibraryDocument(ws, ".kaitu/secrets.json")).toThrow();
    reads.mockClear();
    const recent = inboxNotes(ws, "inbox/notes", { from: "2026-10-19" });
    expect(recent).toHaveLength(63);
    expect(reads.mock.calls.some(([file]) => file === mail)).toBe(false);
    reads.mockRestore();
    const paths = vi.spyOn(ws, "resolve");
    const statuses = statusFiles(ws);
    expect(statuses.some((row) => row.file === "custom/nested/topic/STATUS.md")).toBe(true);
    expect(paths.mock.calls.some(([file]) => file.startsWith("health/files/"))).toBe(false);
    expect(paths.mock.calls.some(([file]) => file === "health/data/workouts")).toBe(false);
    expect(statuses.some((row) => row.file === "learning/files/STATUS.md")).toBe(true);
    expect(statuses.some((row) => row.file === "custom/nested/files/STATUS.md")).toBe(true);
    paths.mockRestore();
    expect(
      readLibrary(ws, { section: "notes" }).notes.some((row) => row.file === "learning/files/STATUS.md"),
    ).toBe(true);
    await completeNext(ws, "learning/files/STATUS.md", "topic-next");
    expect(ws.readText("learning/files/STATUS.md")).toContain("status: done");
    rmSync(outside, { recursive: true, force: true });
  } finally {
    rmSync(ws.root, { recursive: true, force: true });
  }
});
