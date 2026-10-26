import { readFileSync } from "node:fs";
import { archiveMemory, captureMemory, listMemories, readMe } from "@kaitu/core";
import { createElement } from "react";
import { type ReactTestRenderer, act, create } from "react-test-renderer";
import { expect, test, vi } from "vitest";
import { clonedWorkspace } from "../../core/test/helpers.js";
import { MePage } from "../src/client/MePage.js";
import { memoryDisplayText } from "../src/client/memory-presentation.js";

const cases = JSON.parse(
  readFileSync(new URL("../../core/test/fixtures/memory-capture.json", import.meta.url), "utf8"),
) as { presentationCases: { text: string; origin: string; uncertainty: string; display: string }[] };

test("AI装饰只在显示时按来源和不确定性精确隐藏，用户原文及不匹配装饰保留", () => {
  for (const item of cases.presentationCases) {
    const original = JSON.stringify(item);
    expect(memoryDisplayText(item)).toBe(item.display);
    expect(JSON.stringify(item)).toBe(original);
  }
});

test("档案显示短AI正文与来源，撤销仍使用旧正文expected且同键重投不复活", async () => {
  const ws = await clonedWorkspace();
  const input = {
    idempotency_key: "legacy-ai-presentation",
    type: "decision" as const,
    name: "纸桥建议",
    text: "可以先做纸桥",
    source: "synthetic",
    origin: "ai-suggestion" as const,
    uncertainty: "尚未采纳",
    observed_at: "2026-10-26T12:00:00Z",
    evidence: "可以先做纸桥",
    scope: "personal" as const,
  };
  const first = await captureMemory(ws, input);
  if (!first.entry) throw new Error("Missing legacy memory");
  const original = ws.readText(`memory/${first.entry.file}`);
  const remove = vi.fn(async (file, expected) => archiveMemory(ws, file, { by: "user", expected }));
  let root!: ReactTestRenderer;
  try {
    await act(async () => {
      root = create(
        createElement(MePage, {
          loadMe: async () => readMe(ws),
          archiveMemory: remove,
          replaceMemory: vi.fn(),
          setAvatar: async () => null,
          removeAvatar: async () => {},
          onPrompt: vi.fn(),
          onImportMemory: vi.fn(),
        }),
      );
    });
    const rendered = JSON.stringify(root.toJSON());
    expect(rendered).toContain("可以先做纸桥");
    expect(rendered).toContain("AI 建议 · 尚未采纳");
    expect(rendered).not.toContain("[AI 建议 / AI suggestion");
    expect(rendered).not.toContain("原话与依据");
    expect(ws.readText(`memory/${first.entry.file}`)).toBe(original);
    const button = root.root
      .findAllByType("button")
      .find((item) => item.children.includes("撤销这条自动记录"));
    expect(button).toBeDefined();
    await act(async () => button?.props.onClick());
    expect(remove).toHaveBeenCalledWith(
      first.entry.file,
      expect.objectContaining({ text: first.entry.text }),
    );
    expect(listMemories(ws)).toHaveLength(0);
    expect((await captureMemory(ws, input)).status).toBe("undone");
  } finally {
    if (root) act(() => root.unmount());
  }
});
