import { rmSync } from "node:fs";
import { dirname } from "node:path";
import { expect, it } from "vitest";
import {
  adoptOnboardingMatter,
  changeOnboardingNext,
  draftOnboardingMatter,
  findInboxNote,
  inboxNotes,
  onboardingStatus,
  openFeishuInbox,
  readOnboardingMatter,
  saveOnboardingMatter,
} from "../src/index.js";
import { freshWorkspace } from "./helpers.js";

it("飞书普通、空和长原文可整理采纳，归档后完整保留并可完成下一步", async () => {
  const ws = await freshWorkspace();
  try {
    const bodies = ["  # 合成原文\n\n正文\n  ", "", `  ${"长".repeat(100000)}\n  `];
    for (const [index, body] of bodies.entries()) {
      const importer = openFeishuInbox(ws);
      let source: string;
      try {
        source =
          importer.capture({
            documentId: `synthetic-${index}`,
            revision: 1,
            title: `合成 ${index}`,
            url: `https://example.feishu.cn/docx/synthetic-${index}`,
            content: body,
          }) ?? "missing";
      } finally {
        importer.close();
      }
      const original = ws.readText(source);
      expect(inboxNotes(ws).some((note) => note.path === source)).toBe(true);
      expect(readOnboardingMatter(ws, source).text).toBe(body);
      const draft = { goal: `合成目标 ${index}`, current: "已带来原文", next: "走一步" };
      expect((await draftOnboardingMatter(ws, source, draft)).draft).toEqual(draft);
      const task = await adoptOnboardingMatter(ws, source, draft);
      expect(inboxNotes(ws).some((note) => note.path === source)).toBe(false);
      expect(ws.readText(findInboxNote(ws, source.split("/").at(-1) ?? "missing") ?? "missing")).toBe(
        original,
      );
      expect(readOnboardingMatter(ws, source).text).toBe(body);
      expect(onboardingStatus(ws).next?.id).toBe(task.id);
      expect((await changeOnboardingNext(ws, task.id, task.rev, "complete", "已走一步")).status).toBe("done");
    }
  } finally {
    rmSync(dirname(ws.root), { recursive: true, force: true });
  }
});

it("ULID 原文仍可读取采纳，飞书路径白名单及原有 kind/date 检查拒绝伪造来源", async () => {
  const ws = await freshWorkspace();
  try {
    const saved = await saveOnboardingMatter(ws, "合成 ULID 原文");
    expect(readOnboardingMatter(ws, saved.source).text).toBe("合成 ULID 原文");
    const task = await adoptOnboardingMatter(ws, saved.source, {
      goal: "散步",
      current: "合成",
      next: "出门",
    });
    expect((await changeOnboardingNext(ws, task.id, task.rev, "complete", "已出门")).status).toBe("done");
    expect(readOnboardingMatter(ws, saved.source).text).toBe(saved.text);
    const name = `feishu-${"a".repeat(64)}.md`;
    const source = `inbox/notes/2026-10-19/${name}`;
    ws.writeText(source, "---\nkind: capture\ndate: 2026-10-19\n---\nsentinel");
    ws.writeText(`${source}\n`, "---\nkind: capture\ndate: 2026-10-19\n---\nnewline sentinel");
    for (const bad of [
      `../${source}`,
      `${source}/../${name}`,
      `${source}/extra`,
      `${source}\n`,
      source.replace("a".repeat(64), "a".repeat(63)),
      source.replace("feishu-", "other-"),
      source.replace("2026-10-19", "2026-10-18"),
      source.replaceAll("/", "\\"),
    ]) {
      expect(() => readOnboardingMatter(ws, bad)).toThrow();
    }
    ws.writeText(source, "---\nkind: briefing\ndate: 2026-10-19\n---\nsentinel");
    expect(() => readOnboardingMatter(ws, source)).toThrow();
    ws.writeText(source, "---\nkind: capture\ndate: 2026-10-18\n---\nsentinel");
    expect(() => readOnboardingMatter(ws, source)).toThrow();
  } finally {
    rmSync(dirname(ws.root), { recursive: true, force: true });
  }
});
