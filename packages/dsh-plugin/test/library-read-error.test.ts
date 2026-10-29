import { createElement } from "react";
import { act, create } from "react-test-renderer";
import { expect, test, vi } from "vitest";
import { LibraryPage } from "../src/client/LibraryPage.js";
import type { LibraryData, OverviewData } from "../src/types.js";

test("资料读取失败时搜索显示可重试错误，不把旧数据当成零条结果", async () => {
  const retry = vi.fn();
  let app!: ReturnType<typeof create>;
  try {
    await act(async () => {
      app = create(
        createElement(LibraryPage, {
          query: "synthetic",
          onQuery: vi.fn(),
          data: { inbox: [], sections: [], notes: [] } as LibraryData,
          overview: { plans: { goals: [] }, sync: {}, versions: [] } as unknown as OverviewData,
          readError: "读取资料失败",
          retry,
          searchLibraryNotes: async () => [],
          open: vi.fn(),
          onOpenOriginal: vi.fn(),
          onOpenNote: vi.fn(),
          onOpenGoal: vi.fn(),
        }),
      );
    });
    const text = JSON.stringify(app.toJSON());
    expect(text).toContain("搜索未完成");
    expect(text).not.toContain("没有匹配");
    expect(text).not.toContain("原文 0");
    await act(async () =>
      app.root
        .findAllByType("button")
        .find((button) => button.children.includes("重试"))
        ?.props.onClick(),
    );
    expect(retry).toHaveBeenCalledOnce();
  } finally {
    await act(async () => app?.unmount());
  }
});
