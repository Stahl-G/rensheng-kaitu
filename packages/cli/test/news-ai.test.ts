import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initWorkspace, readNews } from "@kaitu/core";
import { expect, it } from "vitest";
import { type AskRuntime, createAskService } from "../src/ui/ask.js";
import { productRequest } from "../src/ui/product.js";

it("已连接模型的关注草稿可编辑确认，生成不会改当前方案或占用当前对话", async () => {
  const root = mkdtempSync(join(tmpdir(), "kaitu-news-ai-"));
  const ws = await initWorkspace(join(root, "workspace"));
  let notify: Parameters<AskRuntime["onNotification"]>[0] = () => {};
  const proposed = ["徒步", "摄影", "城市交通", "阅读", "低碳生活"];
  const ask = createAskService({
    state: join(root, "state"),
    workspace: ws.root,
    settings: async () => ({ configured: true, provider: "synthetic", model: "synthetic" }),
    configure: async () => ({}),
    runtime: async () => ({
      onNotification(listener) {
        notify = listener;
        return () => {};
      },
      async request(_method, params) {
        notify("session.event", {
          sessionId: params.sessionId,
          event: {
            seq: 1,
            type: "assistant/message",
            data: { message: { content: [{ type: "text", text: JSON.stringify(proposed) }] } },
          },
        });
        notify("session.status", { sessionId: params.sessionId, status: "idle" });
        return {};
      },
      async close() {},
    }),
  });
  try {
    const current = ask.create();
    const before = ws.readText("feed/feeds.json");
    const result = await productRequest(ws, "suggestNewsKeywords", [], ask);
    expect(result).toEqual(proposed);
    expect(ws.readText("feed/feeds.json")).toBe(before);
    expect(ask.events(current.id)).toEqual([]);
    const edited = ["慢跑", ...(result as string[]).slice(1)];
    await productRequest(ws, "saveNewsKeywords", [edited], ask);
    expect(readNews(ws).keywords).toEqual(edited);
    await expect(productRequest(ws, "suggestNewsKeywords", [])).rejects.toThrow();
    expect(readNews(ws).keywords).toEqual(edited);
  } finally {
    await ask.close();
    rmSync(root, { recursive: true, force: true });
  }
});
