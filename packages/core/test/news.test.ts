import { rmSync } from "node:fs";
import { expect, it } from "vitest";
import {
  type StoredRecord,
  addRecord,
  addRecords,
  dismissNews,
  history,
  parseFrontmatter,
  processInbox,
  readNews,
  readRecords,
  tryNews,
  writeAgentRecord,
} from "../src/index.js";
import { freshWorkspace } from "./helpers.js";

it("不同 Agent 重复投递带 utm 的新闻只保留一条并补全缺失信息，热门按天修订", async () => {
  const ws = await freshWorkspace();
  try {
    const first = addRecord(ws, "news_item", {
      title: "Lean 标准库更新",
      url: "https://example.com/lean/?lang=zh&utm_source=rss",
      source: "Lean 官方博客",
      via: "rss",
      ts: "2026-10-31T23:00:00+08:00",
    });
    ws.writeText(
      "inbox/agents/grok.records.jsonl",
      `${JSON.stringify({
        type: "news_item",
        agent: "grok",
        title: "另一个标题",
        url: "https://example.com/lean?lang=zh&utm_campaign=grok",
        source: "Grok",
        via: "grok",
        summary: "证明自动化更强",
        ts: "2026-11-01T10:00:00+08:00",
        relevance: { module: "learning", reason: "正在学 Lean" },
      })}\n`,
    );
    const imported = await processInbox(ws, { stableMs: 0 });
    expect(imported.processed).toEqual(["inbox/agents/grok.records.jsonl"]);
    const repeated = await writeAgentRecord(ws, "add", "news_item", "Codex", {
      title: "再次投递",
      url: "https://example.com/lean/?lang=zh&utm_medium=codex",
      source: "Codex",
      via: "codex",
      summary: "不覆盖已有摘要",
      image: "https://example.com/lean.png",
    });
    expect(repeated.record.id).toBe(first.record.id);
    expect(readRecords(ws, "news_item")).toEqual([
      expect.objectContaining({
        id: first.record.id,
        title: "Lean 标准库更新",
        source: "Lean 官方博客",
        via: "rss",
        status: "new",
        summary: "证明自动化更强",
        image: "https://example.com/lean.png",
        relevance: { module: "learning", reason: "正在学 Lean" },
      }),
    ]);
    addRecords(ws, "trend", [
      { topic: "#Lean4", posts: 8900, via: "grok", ts: "2026-11-01T00:30:00+08:00" },
      { topic: "#Lean4", posts: 9900, via: "grok", ts: "2026-10-31T20:30:00Z" },
      { topic: "#Lean4", posts: 100, via: "dot", ts: "2026-11-02T00:30:00+08:00" },
    ]);
    expect(readRecords(ws, "trend")).toHaveLength(2);
    const news = readNews(ws, new Date("2026-11-01T12:00:00+08:00"));
    expect(news.trends.map((row) => row.posts)).toEqual([9900]);
    expect(news.sources).toEqual({ rss: 1 });
  } finally {
    rmSync(ws.root, { recursive: true, force: true });
  }
});

it("试一下把新闻变成对应模块的下一步，不相关后同来源不再入选", async () => {
  const ws = await freshWorkspace();
  try {
    const now = new Date("2026-10-15T12:00:00+08:00");
    const items = addRecords(
      ws,
      "news_item",
      [
        {
          title: "训练动作参考",
          url: "https://example.com/workout",
          source: "训练周刊",
          via: "rss",
          relevance: { module: "health", reason: "配合当前训练目标" },
          published_at: "2026-10-15T10:00:00+08:00",
        },
        {
          title: "训练恢复参考",
          url: "https://example.com/rest",
          source: "训练周刊",
          via: "rss",
          relevance: { module: "health", reason: "安排恢复日" },
          published_at: "2026-10-14T10:00:00+08:00",
        },
        { title: "其他新闻", url: "https://example.com/other", source: "其他来源", via: "codex" },
      ],
      { now },
    );
    const [first, second, third] = items.map((item) => item.record) as [
      StoredRecord,
      StoredRecord,
      StoredRecord,
    ];
    expect(readNews(ws, now).picked.map((row) => row.id)).toEqual([first.id, second.id]);
    const before = await history(ws);
    const tried = await tryNews(ws, first.id);
    expect(tried.version).toBeTruthy();
    expect(await history(ws)).toHaveLength(before.length + 1);
    const steps = () => parseFrontmatter<{ next: unknown[] }>(ws.readText("health/STATUS.md")).data.next;
    expect(steps()).toEqual([
      expect.objectContaining({ title: first.title, status: "proposed", ref: first.id }),
    ]);
    await tryNews(ws, first.id);
    expect(steps()).toHaveLength(1);
    expect(readNews(ws, now).picked.map((row) => row.id)).toEqual([second.id]);
    const dismissed = await dismissNews(ws, first.id);
    expect(dismissed.version).toBeTruthy();
    expect(readNews(ws, now).picked).toEqual([]);
    expect(readNews(ws, now).others.map((row) => row.id)).toContain(second.id);
    await dismissNews(ws, first.id);
    expect(ws.readJson<{ muted: string[] }>("feed/feeds.json").muted).toEqual(["训练周刊"]);
    await tryNews(ws, third.id);
    expect(parseFrontmatter<{ next: unknown[] }>(ws.readText("me/STATUS.md")).data.next).toEqual([
      expect.objectContaining({ title: "其他新闻", status: "proposed", ref: third.id }),
    ]);
  } finally {
    rmSync(ws.root, { recursive: true, force: true });
  }
});
