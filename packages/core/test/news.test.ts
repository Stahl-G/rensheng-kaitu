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
        details: ["改进证明搜索", "支持库更新", "有发布说明"],
        comment: "可以试用新版本。",
        published_at: "2026-11-01T09:00:00+08:00",
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
      details: ["改进证明搜索", "支持库更新", "有发布说明"],
      comment: "可以试用新版本。",
      published_at: "2026-11-01T09:00:00+08:00",
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

it("试一下生成待确认的下一步，不相关只影响该条新闻并保留来源设置", async () => {
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
        {
          title: "其他新闻",
          url: "https://example.com/other",
          source: "其他来源",
          via: "codex",
          summary: "其他来源的新消息",
          details: ["要点一", "要点二", "要点三"],
          comment: "可持续关注。",
          published_at: "2026-10-15T10:00:00+08:00",
        },
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
    const settings = { feeds: [], keywords: ["训练"], muted: ["广告"] };
    ws.writeJson("feed/feeds.json", settings);
    const dismissed = await dismissNews(ws, first.id);
    expect(dismissed.version).toBeTruthy();
    expect(readRecords(ws, "news_item").find((row) => row.id === first.id)?.status).toBe("dismissed");
    expect(readNews(ws, now).picked.map((row) => row.id)).toEqual([second.id]);
    expect(readNews(ws, now).others.map((row) => row.id)).not.toContain(first.id);
    await dismissNews(ws, first.id);
    expect(ws.readJson("feed/feeds.json")).toEqual(settings);
    await tryNews(ws, third.id);
    expect(parseFrontmatter<{ next: unknown[] }>(ws.readText("me/STATUS.md")).data.next).toEqual([
      expect.objectContaining({ title: "其他新闻", status: "proposed", ref: third.id }),
    ]);
  } finally {
    rmSync(ws.root, { recursive: true, force: true });
  }
});

it("缺摘要的 Agent 新闻转待整理，并保留缺失字段原因", async () => {
  const ws = await freshWorkspace();
  try {
    ws.writeText(
      "inbox/agents/incomplete.news.jsonl",
      `${JSON.stringify({
        type: "news_item",
        agent: "grok",
        via: "grok",
        title: "合成新闻",
        url: "https://example.com/incomplete",
        source: "合成来源",
        details: ["第一点", "第二点", "第三点"],
        comment: "值得关注。",
        published_at: "2026-10-15T06:00:00+08:00",
      })}\n`,
    );
    const result = await processInbox(ws, { stableMs: 0 });
    expect(readRecords(ws, "news_item")).toEqual([]);
    expect(result.notes).toHaveLength(1);
    expect(ws.readText(result.notes[0] as string)).toContain("缺少字段 summary");
  } finally {
    rmSync(ws.root, { recursive: true, force: true });
  }
});
