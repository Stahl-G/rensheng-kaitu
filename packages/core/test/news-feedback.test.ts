import { expect, it } from "vitest";
import { setNewsFeedback } from "../src/news-feedback.js";
import { readNews } from "../src/news.js";
import { addRecord } from "../src/records.js";
import { freshWorkspace } from "./helpers.js";

it("有用和不相关更新采集偏好，重复反馈与撤销不丢失用户原有关注词", async () => {
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
  await setNewsFeedback(ws, item.id, "useful");
  expect(ws.readJson<{ keywords: string[] }>("feed/feeds.json").keywords).toEqual(["原有关注", "合成来源"]);
  expect(readNews(ws).feedback[item.id]).toBe("useful");
  await setNewsFeedback(ws, item.id, "irrelevant");
  expect(ws.readJson<{ muted: string[] }>("feed/feeds.json").muted).toContain("合成来源");
  await setNewsFeedback(ws, item.id, null);
  expect(ws.readJson("feed/feeds.json")).toEqual({ feeds: [], keywords: ["原有关注"], muted: ["原有屏蔽"] });
  expect(readNews(ws).feedback[item.id]).toBeUndefined();
});
