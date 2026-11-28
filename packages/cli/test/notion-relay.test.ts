import { randomUUID } from "node:crypto";
import { inboxNoteDone, inboxNotes, processInbox, stringifyFrontmatter } from "@kaitu/core";
import { afterEach, expect, it, vi } from "vitest";
import { freshWorkspace } from "../../core/test/helpers.js";
import { notionRelay } from "../src/notion-relay.js";

const library = randomUUID();
const inbox = randomUUID();
const page = randomUUID();
const env = {
  KAITU_NOTION_LIBRARY: library,
  KAITU_NOTION_INBOX: inbox,
  KAITU_NOTION_LIBRARY_TOKEN: "demo-publisher",
  KAITU_NOTION_INBOX_TOKEN: "demo-reader",
};
const time = "2026-11-24T01:00:00Z";
const list = (results: unknown[], cursor: string | null = null) =>
  Response.json({ object: "list", results, has_more: !!cursor, next_cursor: cursor });
const row = (parent: string, title: string) => ({
  object: "page",
  id: page,
  in_trash: false,
  parent: { type: "data_source_id", data_source_id: parent },
  created_time: time,
  last_edited_time: time,
  properties: { Name: { type: "title", title: [{ type: "text", plain_text: title }] } },
});
const block = (line: string) => ({
  object: "block",
  type: "paragraph",
  parent: { type: "page_id", page_id: page },
  has_children: false,
  paragraph: { rich_text: [{ type: "text", plain_text: line }] },
});
afterEach(() => vi.unstubAllGlobals());
it("预览绑定内容与资料库，响应丢失后的重跑只验证同一页正文", async () => {
  const ws = await freshWorkspace();
  const source = "projects/demo/STATUS.md";
  const status = {
    title: "公开展览",
    stage: "active",
    updated: time,
    next: [
      { title: "整理展签", status: "todo" },
      { title: "检查样稿", status: "done", result: "合成蓝签七号", completed: time },
    ],
  };
  ws.writeText(source, stringifyFrontmatter(status, "其他正文不共享"));
  ws.writeText("projects/other/STATUS.md", stringifyFrontmatter({ ...status, title: "未选择" }, ""));
  const preview = await notionRelay(["preview", ws.root, "demo"], env);
  if (!("code" in preview)) throw new Error("缺少预览");
  const publish = ["publish", ws.root, "demo", preview.code];
  let visible = false;
  let creates = 0;
  let altered = false;
  const fetcher = vi.fn(async (url: string, init: RequestInit) => {
    expect(new URL(url).origin).toBe("https://api.notion.com");
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer demo-publisher");
    expect(new Headers(init.headers).get("Notion-Version")).toBe("2026-03-11");
    const data = JSON.parse(String(init.body ?? "{}"));
    if (url.includes(`/data_sources/${library}/query?`)) {
      expect(data.filter.title.equals).toBe(preview.title);
      return list(visible ? [row(library, preview.title)] : []);
    }
    if (url.endsWith("/pages")) {
      creates++;
      expect(data.parent.data_source_id).toBe(library);
      expect(JSON.stringify(data)).toContain("合成蓝签七号");
      expect(JSON.stringify(data)).not.toMatch(/其他正文|未选择|demo-publisher/);
      throw new Error("合成响应丢失");
    }
    if (url.includes(`/blocks/${page}/children?`))
      return list((altered ? ["人工修改"] : preview.lines).map(block));
    throw new Error("意外的目标");
  });
  vi.stubGlobal("fetch", fetcher);
  await expect(notionRelay(publish, { ...env, KAITU_NOTION_LIBRARY: randomUUID() })).rejects.toThrow();
  ws.writeText(source, stringifyFrontmatter({ ...status, stage: "done" }));
  await expect(notionRelay(publish, env)).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();
  ws.writeText(source, stringifyFrontmatter(status));
  await expect(notionRelay(publish, env)).rejects.toThrow("响应丢失");
  await expect(notionRelay(publish, env)).rejects.toThrow("待核对");
  visible = true;
  await expect(notionRelay(publish, env)).resolves.toMatchObject({ page, verified: true });
  altered = true;
  await expect(notionRelay(publish, env)).rejects.toThrow("预览不同");
  expect(creates).toBe(1);
});

it("限定收件箱，跨分页和限流拉取；经过正式导入与归档仍保留一条", async () => {
  const ws = await freshWorkspace();
  const original = ws.readText("NOW.md");
  let foreign = true;
  let limited = true;
  let blockReads = 0;
  const incoming = () => row(foreign ? library : inbox, "合成接力");
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer demo-reader");
    if (url.includes(`/data_sources/${inbox}/query?`)) {
      if (limited) {
        limited = false;
        return new Response(null, { status: 429, headers: { "Retry-After": "0" } });
      }
      return JSON.parse(String(init.body)).start_cursor === "page2" ? list([incoming()]) : list([], "page2");
    }
    if (url.includes(`/blocks/${page}/children?`)) {
      blockReads++;
      return url.includes("start_cursor=b2")
        ? list([block("第二段正文")])
        : list([block("第一段正文")], "b2");
    }
    if (url.includes(`/pages/${page}?`)) return Response.json(incoming());
    throw new Error("意外的目标");
  });
  const pull = () => notionRelay(["pull", ws.root], env);
  await expect(pull()).rejects.toThrow("超出指定数据源");
  expect(blockReads).toBe(0);
  foreign = false;
  await Promise.all([pull(), pull()]);
  const received = await processInbox(ws, { stableMs: 0 });
  expect(received.notes).toHaveLength(1);
  expect(inboxNotes(ws)[0]?.content).toContain("第一段正文\n第二段正文");
  expect(inboxNotes(ws)[0]?.content).toContain(page.replaceAll("-", ""));
  await inboxNoteDone(ws, received.notes[0] ?? "");
  await expect(pull()).resolves.toMatchObject({ queued: 0, existing: 1 });
  expect(inboxNotes(ws)).toHaveLength(0);
  expect(inboxNotes(ws, "inbox/notes/done")).toHaveLength(1);
  expect(ws.readText("NOW.md")).toBe(original);
});
