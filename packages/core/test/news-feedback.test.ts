import { expect, it } from "vitest";
import { setNewsFeedback } from "../src/news-feedback.js";
import { readNews, saveNewsKeywords } from "../src/news.js";
import { addRecord } from "../src/records.js";
import { freshWorkspace } from "./helpers.js";

it("反馈不会暗改关注方案，确认保存后生效并保留订阅和屏蔽来源", async () => {
  const ws = await freshWorkspace();
  ws.writeJson("feed/feeds.json", { feeds: [], keywords: ["原有关注"], muted: ["原有屏蔽"] });
  const item = addRecord(ws, "news_item", {
    title: "合成资讯",
    url: "https://example.com/a",
    source: "合成来源",
    via: "user",
    status: "new",
  }).record;
  await setNewsFeedback(ws, item.id, "useful");
  expect(ws.readJson<{ keywords: string[] }>("feed/feeds.json").keywords).toEqual(["原有关注"]);
  expect(readNews(ws).feedback[item.id]).toBe("useful");
  await setNewsFeedback(ws, item.id, "irrelevant");
  expect(ws.readJson<{ muted: string[] }>("feed/feeds.json").muted).toEqual(["原有屏蔽"]);
  await saveNewsKeywords(ws, [" 新方向 ", "新方向"]);
  expect(readNews(ws).keywords).toEqual(["新方向"]);
  await setNewsFeedback(ws, item.id, null);
  expect(ws.readJson("feed/feeds.json")).toEqual({ feeds: [], keywords: ["新方向"], muted: ["原有屏蔽"] });
  await saveNewsKeywords(ws, []);
  expect(readNews(ws).keywords).toEqual([]);
  expect(readNews(ws).feedback[item.id]).toBeUndefined();
});
