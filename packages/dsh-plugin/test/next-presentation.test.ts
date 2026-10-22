import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initWorkspace, readOverviewPage, stringifyFrontmatter } from "@kaitu/core";
import { expect, it } from "vitest";
import { nextPresentation } from "../src/client/next-presentation.js";

const file = "inbox/notes/2026-01-02/grok-bot-20260102T0800.note.md";

it("shows concise provenance, hides technical annotations, and preserves actual instructions and parentheses", () => {
  const item = Object.freeze({
    title: `吃三餐（豆类 + 鸡/蛋），先试 7 天（方案见 ${file}，用户加入）`,
    ref: file,
    source: "grok-bot",
  });
  const original = JSON.stringify(item);
  expect(nextPresentation(item)).toEqual({
    title: "吃三餐（豆类 + 鸡/蛋），先试 7 天（方案见 资料，用户加入）",
    source: "Grokbot 提供",
  });
  expect(JSON.stringify(item)).toBe(original);
  const mixed = Object.freeze({
    title:
      "提交申请（先让 Alice 审阅，参考 docs/checklist.md）；核对 /Users/me/results/scan.pdf、projects/book/draft.docx 和 meals/lunch.jpg（20 分钟）",
    source: "grok-bot",
    ref: file,
  });
  const mixedRaw = JSON.stringify(mixed);
  expect(nextPresentation(mixed)).toEqual({
    title: "提交申请（先让 Alice 审阅，参考 资料）；核对 资料、资料 和 资料（20 分钟）",
    source: "Grokbot 提供",
  });
  expect(JSON.stringify(mixed)).toBe(mixedRaw);
  expect(
    nextPresentation({ title: `本机处理 ${file} 中 3 条和 ${file} 中 2 条只有日期的待核实资讯` }),
  ).toEqual({ title: "Grokbot 提供", source: "Grokbot 提供" });
  expect(nextPresentation({ title: `本机处理 ${file} 之后跑步（20 分钟）` }).title).toBe(
    "本机处理 资料 之后跑步（20 分钟）",
  );
  expect(nextPresentation({ title: "复盘（ref: note-1）后散步（20 分钟）" }).title).toBe(
    "复盘后散步（20 分钟）",
  );
  expect(nextPresentation({ title: `阅读（${file}）`, source: "Claude", ref: file }).source).toBe(
    "Claude 提供",
  );
});

it("keeps raw title and provenance available through the real overview without rewriting the workspace", async () => {
  const root = mkdtempSync(join(tmpdir(), "kaitu-next-source-"));
  try {
    const ws = await initWorkspace(root);
    const next = {
      id: "synthetic-source",
      title: `浏览资讯（${file}）`,
      status: "proposed",
      source: "grok-bot",
      by: "agent",
      ref: file,
    };
    ws.writeText("feed/STATUS.md", stringifyFrontmatter({ updated: null, next: [next] }, ""));
    const before = ws.readText("feed/STATUS.md");
    const data = await readOverviewPage(ws);
    const item = data.allNext.find((value) => value.id === next.id);
    if (!item) throw new Error("Synthetic next item missing from overview");
    expect(item).toMatchObject({ title: next.title, ref: file, source: "grok-bot", by: "agent" });
    expect(nextPresentation(item)).toEqual({ title: "浏览资讯（资料）", source: "Grokbot 提供" });
    expect(ws.readText("feed/STATUS.md")).toBe(before);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
