import { createHash, randomUUID } from "node:crypto";
import { existsSync, linkSync, mkdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import {
  type ProjectStatus,
  Workspace,
  agentRelativePath,
  findInboxNote,
  parseFrontmatter,
  projectDirectory,
  projectStatus,
  schemas,
  stringifyFrontmatter,
} from "@kaitu/core";
import { z } from "zod";

const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const use = "preview <工作区> <项目目录名> | publish <工作区> <项目目录名> <预览码> | pull <工作区>";
function id(value: unknown): string {
  if (typeof value !== "string" || !/^(?:[\da-f]{32}|[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12})$/i.test(value))
    throw new Error("需要有效的 Notion ID，请从管理数据源复制 ID");
  return value
    .replaceAll("-", "")
    .toLowerCase()
    .replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5");
}
function exactPath(ws: Workspace, file: string) {
  if (agentRelativePath(ws.root, file) !== file) throw new Error("路径已重定向，请核对工作区");
  return ws.resolve(file);
}
function preview(ws: Workspace, slug: string, library: string) {
  const source = `${projectDirectory(ws, slug)}/STATUS.md`;
  const file = exactPath(ws, source);
  const statusText = ws.readText(source);
  let raw: ProjectStatus & { sensitive?: boolean };
  try {
    raw = parseFrontmatter<typeof raw>(statusText).data;
  } catch {
    throw new Error("项目状态格式无效，请检查 STATUS.md");
  }
  if (!raw || raw.sensitive || !Object.keys(raw).length) throw new Error("项目缺少状态或已标记为敏感");
  const data = projectStatus(raw, slug);
  if (!schemas().builtin("status.schema.json")(data)) throw new Error("项目状态格式无效");
  const next = data.next?.find((item) => item.status === "todo" || item.status === "proposed");
  const done = data.next
    ?.filter((item) => item.status === "done" && item.result?.trim())
    .sort((a, b) => (Date.parse(b.completed ?? "") || 0) - (Date.parse(a.completed ?? "") || 0))[0];
  if ([next, done].some((item) => item && "sensitive" in item && item.sensitive))
    throw new Error("选中条目标记为敏感");
  const date = data.updated ?? statSync(file).mtime.toISOString();
  const lines = [
    data.title,
    `阶段：${data.stage}`,
    `下一步：${next ? `${next.title}（${next.status}）` : "未记录"}`,
    `最近结果：${done ? `${done.result}（${done.completed ?? "完成日期未记录"}）` : "未记录"}`,
    `来源：开图 ${source}`,
    `更新日期：${date}`,
  ];
  if (
    lines.some(
      (line) =>
        line.length > 1900 ||
        /-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:ntn_|secret_|gh[pousr]_|github_pat_|sk-)[\w-]{12,}/i.test(
          line,
        ),
    )
  )
    throw new Error("快照字段过长或含疑似凭证，请缩小选取的内容");
  const code = hash(JSON.stringify([library, lines]));
  return { library, title: `${data.title} · ${date.slice(0, 10)} · ${code.slice(0, 16)}`, lines, code };
}

class Rejected extends Error {}
function api(token?: string) {
  if (!token?.trim()) throw new Error("请配置此操作所需的 Notion 进程环境凭证");
  return async (path: string, body?: object): Promise<unknown> => {
    for (let attempt = 0; ; attempt++) {
      const response = await fetch(`https://api.notion.com/v1/${path}`, {
        method: body ? "POST" : "GET",
        redirect: "error",
        signal: AbortSignal.timeout(30000),
        headers: {
          Authorization: `Bearer ${token}`,
          "Notion-Version": "2026-03-11",
          "Content-Type": "application/json",
        },
        body: body && JSON.stringify(body),
      });
      if (response.ok) return response.json();
      await response.body?.cancel();
      if (response.status === 429 && attempt < 3) {
        const seconds = Number(response.headers.get("Retry-After") ?? 2 ** attempt);
        if (Number.isFinite(seconds) && seconds >= 0 && seconds <= 60) {
          await sleep(seconds * 1000);
          continue;
        }
      }
      if (response.status === 429)
        throw new Rejected(
          `Notion 限流，请等待 ${Number(response.headers.get("Retry-After")) || 60} 秒后重试`,
        );
      const message = `Notion HTTP ${response.status}，请核对授权、数据源或稍后重试`;
      if ([400, 401, 403, 404, 413].includes(response.status)) throw new Rejected(message);
      throw new Error(message);
    }
  };
}
type Api = ReturnType<typeof api>;
const listing = z.object({
  object: z.literal("list"),
  results: z.array(z.unknown()),
  has_more: z.boolean(),
  next_cursor: z.string().nullable(),
  request_status: z.object({ type: z.string() }).optional(),
});
async function* pages(request: (cursor?: string) => Promise<unknown>) {
  const seen = new Set<string>();
  let cursor: string | undefined;
  do {
    const batch = listing.parse(await request(cursor));
    if (batch.request_status?.type === "incomplete")
      throw new Error("Notion 查询未返回完整结果，请缩小专用库");
    yield* batch.results;
    if (!batch.has_more) return;
    if (!batch.next_cursor || seen.has(batch.next_cursor)) throw new Error("Notion 分页游标无效");
    cursor = batch.next_cursor;
    seen.add(cursor);
  } while (cursor);
}
const richText = z
  .array(z.object({ type: z.literal("text"), plain_text: z.string() }))
  .transform((text) => text.map((t) => t.plain_text).join(""));
function scopedPage(raw: unknown, source: string) {
  const page = z
    .object({
      object: z.literal("page"),
      id: z.string(),
      in_trash: z.literal(false),
      parent: z.object({ type: z.literal("data_source_id"), data_source_id: z.string() }),
      created_time: z.iso.datetime({ offset: true }),
      last_edited_time: z.string(),
      properties: z.record(z.string(), z.object({ type: z.string(), title: richText.optional() })),
    })
    .parse(raw);
  if (id(page.parent.data_source_id) !== source) throw new Error("页面超出指定数据源");
  const name = Object.values(page.properties).find((p) => p.type === "title")?.title;
  if (name === undefined) throw new Error("页面缺少标题属性");
  return { id: id(page.id), name, created: page.created_time, edited: page.last_edited_time };
}
function query(call: Api, source: string, title?: string) {
  return pages((start_cursor) =>
    call(`data_sources/${source}/query?filter_properties=title`, {
      page_size: 100,
      start_cursor,
      result_type: "page",
      ...(title ? { filter: { property: "title", title: { equals: title } } } : {}),
    }),
  );
}
async function content(call: Api, page: string) {
  const lines = [];
  let size = 0;
  for await (const raw of pages((cursor) =>
    call(
      `blocks/${page}/children?${new URLSearchParams({
        page_size: "100",
        ...(cursor ? { start_cursor: cursor } : {}),
      })}`,
    ),
  )) {
    const block = z
      .object({
        object: z.literal("block"),
        type: z.enum([
          "paragraph",
          "heading_1",
          "heading_2",
          "heading_3",
          "bulleted_list_item",
          "numbered_list_item",
          "quote",
        ]),
        parent: z.object({ type: z.literal("page_id"), page_id: z.string() }),
        has_children: z.literal(false),
      })
      .passthrough()
      .parse(raw);
    if (id(block.parent.page_id) !== page) throw new Error("正文超出指定页面");
    const line = z.object({ rich_text: richText }).parse(block[block.type]).rich_text;
    size += line.length + 1;
    if (size > 90000) throw new Error("接力正文过长，请拆成多条");
    lines.push(line);
  }
  return lines;
}
async function publish(ws: Workspace, shot: ReturnType<typeof preview>, call: Api) {
  const matching = [];
  for await (const raw of query(call, shot.library, shot.title)) {
    const page = scopedPage(raw, shot.library);
    if (page.name !== shot.title) throw new Error("资料库返回了不同标题");
    matching.push(page);
  }
  if (matching.length > 1) throw new Error("资料库有同名快照，请人工核对");
  let page = matching[0];
  if (!page) {
    const marker = ws.resolve(`.kaitu/notion-relay/${shot.code}.pending`, { internal: true });
    mkdirSync(dirname(marker), { recursive: true, mode: 0o700 });
    try {
      writeFileSync(marker, "", { flag: "wx", mode: 0o600 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST")
        throw new Error(`上次创建结果待核对，请先在资料库查找「${shot.title}」；核对文件 ${marker}`);
      throw error;
    }
    const text = (value: string) => [{ type: "text", text: { content: value } }];
    try {
      page = scopedPage(
        await call("pages", {
          parent: { type: "data_source_id", data_source_id: shot.library },
          properties: { title: { type: "title", title: text(shot.title) } },
          children: shot.lines.map((line) => ({
            object: "block",
            type: "paragraph",
            paragraph: { rich_text: text(line) },
          })),
        }),
        shot.library,
      );
    } catch (error) {
      if (error instanceof Rejected) unlinkSync(marker);
      throw error;
    }
  }
  if (page.name !== shot.title || JSON.stringify(await content(call, page.id)) !== JSON.stringify(shot.lines))
    throw new Error("远端正文或标题与预览不同，请核对快照");
  return { page: page.id, verified: true };
}
async function pull(ws: Workspace, inbox: string, call: Api) {
  exactPath(ws, "inbox/notes");
  const deferred: string[] = [];
  let queued = 0;
  let existing = 0;
  for await (const raw of query(call, inbox)) {
    const page = scopedPage(raw, inbox);
    const name = `channel-${hash(`notion:${inbox}:${page.id}`)}.note.md`;
    const dest = exactPath(ws, `inbox/agents/${name}`);
    if (existsSync(dest) || findInboxNote(ws, name)) {
      existing++;
      continue;
    }
    let body = "";
    try {
      body = (await content(call, page.id)).join("\n").trim();
    } catch (error) {
      if (!(error instanceof z.ZodError)) throw error;
    }
    if (!body) {
      deferred.push(page.id);
      continue;
    }
    exactPath(ws, `inbox/notes/${page.created.slice(0, 10)}`);
    const current = scopedPage(await call(`pages/${page.id}?filter_properties=title`), inbox);
    if (current.id !== page.id || current.edited !== page.edited)
      throw new Error("页面在读取中发生变化，请重新拉取");
    const note = stringifyFrontmatter(
      { agent: "Notion 接力", date: page.created.slice(0, 10) },
      `待核对 · ${page.name}\n来源：Notion 收件箱 ${inbox}\n原页：https://www.notion.so/${page.id.replaceAll("-", "")}\n创建：${page.created}\n\n${body}\n`,
    );
    mkdirSync(dirname(dest), { recursive: true });
    const tmp = `${dest}.${randomUUID()}.tmp`;
    writeFileSync(tmp, note, { flag: "wx", mode: 0o600 });
    try {
      linkSync(tmp, dest);
      queued++;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      existing++;
    } finally {
      unlinkSync(tmp);
    }
  }
  return { queued, existing, deferred };
}

export async function notionRelay(args: string[], env = process.env) {
  const [command, root, slug, code] = args;
  if (
    !root ||
    !(
      (command === "preview" && args.length === 3) ||
      (command === "publish" && args.length === 4) ||
      (command === "pull" && args.length === 2)
    )
  )
    throw new Error(use);
  const library = id(env.KAITU_NOTION_LIBRARY);
  const inbox = id(env.KAITU_NOTION_INBOX);
  if (library === inbox) throw new Error("资料库和收件箱必须是两个不同的数据源");
  const ws = new Workspace(root, { maintain: false });
  if (!ws.exists(".kaitu/config.json")) throw new Error("请指定已初始化的开图工作区");
  if (command === "pull") return pull(ws, inbox, api(env.KAITU_NOTION_INBOX_TOKEN));
  const shot = preview(ws, slug ?? "", library);
  for (const token of [env.KAITU_NOTION_LIBRARY_TOKEN, env.KAITU_NOTION_INBOX_TOKEN])
    if (token && shot.lines.some((line) => line.includes(token))) throw new Error("快照含有凭证");
  if (command === "preview") return shot;
  if (shot.code !== code) throw new Error("内容或目标已变化，请重新预览");
  return publish(ws, shot, api(env.KAITU_NOTION_LIBRARY_TOKEN));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  notionRelay(process.argv.slice(2))
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error) => {
      console.error(
        error instanceof z.ZodError
          ? "Notion 返回了不支持的结构，请使用直接位于专用库中的普通文字页面"
          : error.message,
      );
      process.exitCode = 1;
    });
}
