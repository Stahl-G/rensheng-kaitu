import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Context } from "@deepseek-ai/cordis";
import { addRecord, initWorkspace } from "@kaitu/core";
import { expect, it } from "vitest";
import { TYPERT } from "../lib/typert.host.js";
import { KaituOverviewService } from "../src/overview-service.js";

it("富内容新闻与热门的原帖、讨论在 Remote 数据中完整返回", async () => {
  const root = mkdtempSync(join(tmpdir(), "kaitu-news-remote-"));
  try {
    const ws = await initWorkspace(root);
    const published_at = new Date(Date.now() - 60000).toISOString();
    const post = {
      author: "合成作者",
      handle: "@example",
      text: "合成原帖\n第二行",
      url: "https://x.com/example/status/1",
      media: ["https://example.com/image.png"],
      likes: 0,
      reposts: 12,
      replies: 3,
      posted_at: published_at,
    };
    const discussion = [{ stance: "赞成试用", quote: "希望减少重复工作", who: "@reader" }];
    const content = {
      kind: "x_post",
      title: "合成消息",
      url: post.url,
      source: "X",
      via: "grok",
      summary: "合成摘要",
      details: ["第一点", "第二点", "第三点"],
      comment: "可以在项目中小范围试用。",
      published_at,
      post,
      discussion,
      sources: [{ name: "发布说明", url: "https://example.com/release" }],
    };
    addRecord(ws, "news_item", content);
    addRecord(ws, "trend", {
      topic: "合成热门",
      via: "grok",
      summary: "热门摘要",
      posts: 20,
      samples: [post],
      discussion,
    });
    const service = new KaituOverviewService(new Context(), { workspace: root });
    const contract = TYPERT as {
      invocations: {
        namespace: string;
        method: string;
        result: { create(): { parse(value: unknown): unknown } };
      }[];
    };
    const codec = contract.invocations.find(
      (entry) => entry.namespace === "kaitu" && entry.method === "news",
    );
    expect(codec).toBeDefined();
    const data = JSON.parse(JSON.stringify(codec?.result.create().parse(await service.news())));
    expect(data.others).toEqual([expect.objectContaining(content)]);
    expect(data.trends).toEqual([expect.objectContaining({ posts: 20, samples: [post], discussion })]);
    expect(await service.workspacePath()).toBe(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
