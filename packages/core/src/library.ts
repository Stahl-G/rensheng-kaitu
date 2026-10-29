import { lstatSync, readdirSync } from "node:fs";
import { basename } from "node:path";
import { assertAgentPath } from "./agent-file-policy.js";
import { readCalendar } from "./calendar.js";
import { readDoing } from "./doing-page.js";
import { KaituError } from "./errors.js";
import { frontmatterBody, parseFrontmatter } from "./frontmatter.js";
import { inboxNotes, isCaptureSource } from "./inbox-notes.js";
import { listRecordTypes } from "./modules.js";
import { listProjects } from "./projects.js";
import { readRecords } from "./records.js";
import type { ModuleStatus } from "./workbench.js";
import type { Workspace } from "./workspace.js";

export interface LibraryItem {
  id: string;
  title: string;
  count: number | null;
  sources: string[];
  latest: string | null;
}
export interface InboxEntry {
  file: string;
  text: string;
  attachment?: string;
  source: string;
  /** Original capture identity, independent of its current archive path and display timestamp. */
  originalSource: string | null;
  date: string | null;
  status: "organized" | "review" | "raw";
  destination: string | null;
  error?: "INVALID_FRONTMATTER";
}
export interface LibraryQuery {
  section?: "summary" | "inbox" | "notes" | "health";
  before?: string;
  source?: string;
}
export interface LibraryData {
  next?: string | null;
  sections: LibraryItem[];
  inbox: InboxEntry[];
  notes: { file: string; title: string; kind: "笔记" | "决定"; status: string | null }[];
}
export function readLibrary(ws: Workspace, query: LibraryQuery = {}): LibraryData {
  const section = query.section;
  if (section && !["summary", "inbox", "notes", "health"].includes(section))
    throw new KaituError("未知资料分类", "BAD_ARGS");
  const calendar = !section ? readCalendar(ws) : null;
  const doing = !section || section === "notes" ? readDoing(ws) : { learning: [], decisions: [] };
  const pendingSources =
    !section || section === "inbox"
      ? ws.scanParsed("me/STATUS.md", "library-pending", (text) => {
          const { data } = parseFrontmatter<ModuleStatus>(text);
          return new Set(
            (data.next ?? [])
              .filter((item) => item.status === "proposed" && item.id?.startsWith("onboarding-matter-"))
              .map((item) => item.ref),
          );
        })
      : undefined;
  // 还没从云盘下载的笔记先不列，下载后自然出现。
  const entry = (file: string, organized: boolean): InboxEntry[] => {
    const parsed = ws.scanParsed(file, "library-note", (text) => {
      try {
        return { ...parseFrontmatter(text), error: undefined };
      } catch {
        return {
          data: {} as Record<string, unknown>,
          body: frontmatterBody(text),
          error: "INVALID_FRONTMATTER" as const,
        };
      }
    });
    if (!parsed) return [];
    if (parsed.error)
      return [
        {
          file,
          text: parsed.body.trim(),
          source: "other",
          originalSource: null,
          date: null,
          status: "review",
          destination: null,
          error: parsed.error,
        },
      ];
    const { data, body } = parsed;
    const captureSource =
      data.kind === "capture" && typeof data.date === "string"
        ? `inbox/notes/${data.date}/${basename(file)}`
        : null;
    const originalSource = isCaptureSource(captureSource) ? captureSource : null;
    const channelSource =
      typeof data.agent === "string"
        ? data.agent.match(/^只读采集 · (gmail|imap|slack|feishu)$/)?.[1]
        : undefined;
    return [
      {
        file,
        text: body.trim(),
        ...(typeof data.attachment === "string" ? { attachment: data.attachment } : {}),
        originalSource,
        source:
          data.kind === "capture"
            ? "me"
            : channelSource === "gmail" || channelSource === "imap"
              ? "mail"
              : (channelSource ?? "other"),
        date:
          typeof data.created === "string" ? data.created : typeof data.date === "string" ? data.date : null,
        status:
          originalSource && pendingSources?.has(originalSource)
            ? "review"
            : organized
              ? "organized"
              : data.kind === "capture"
                ? "raw"
                : "review",
        destination: null,
      },
    ];
  };
  const page = section === "inbox" ? inboxPage(ws, query, entry) : null;
  const inbox = page?.inbox ?? (!section ? inboxNotes(ws).flatMap((note) => entry(note.path, false)) : []);
  const done = "inbox/notes/done";
  if (!section && ws.exists(done))
    for (const day of readdirSync(ws.resolve(done), { withFileTypes: true })) {
      if (!day.isDirectory() || !/^\d{4}-\d{2}-\d{2}$/.test(day.name)) continue;
      for (const file of readdirSync(ws.resolve(`${done}/${day.name}`), { withFileTypes: true })) {
        if (file.isFile() && file.name.endsWith(".md"))
          inbox.push(...entry(`${done}/${day.name}/${file.name}`, true));
      }
    }
  if (!page) inbox.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  const records = (types: string[]) => types.flatMap((type) => readRecords(ws, type));
  const health =
    !section || section === "health"
      ? records(
          listRecordTypes(ws)
            .filter((r) => r.module.def.id === "health")
            .map((r) => r.type),
        )
      : [];
  const finance = !section
    ? records(["finance_account", "finance_transaction", "finance_holding_snapshot"])
    : [];
  const fromRecords = (rows: ReturnType<typeof records>) => ({
    sources: [
      ...new Set(
        rows.map((row) => {
          const source = String(row.source ?? row.by);
          return (
            (
              {
                user: "你记录的",
                agent: "本机 AI",
                "apple-health": "Apple 健康",
                "nut-ai": "Nut AI",
                "import:apple-health": "Apple 健康导入",
                "import:ics": "日历导入",
              } as Record<string, string>
            )[source] ?? source
          );
        }),
      ),
    ],
    latest:
      rows
        .map((row) => row.ts)
        .sort()
        .at(-1) ?? null,
  });
  const notes = [
    ...doing.learning.map((row) => ({ ...row, status: row.next, kind: "笔记" as const })),
    ...doing.decisions.map((row) => ({ ...row, kind: "决定" as const })),
  ];
  return {
    ...(page ? { next: page.next } : {}),
    inbox,
    notes,
    sections: [
      {
        id: "calendar",
        title: "日程",
        count: calendar?.events.length ?? null,
        sources: [...new Set((calendar?.events ?? []).map((row) => row.source))],
        latest:
          calendar?.subscriptions
            .map((row) => row.syncedAt)
            .filter((date): date is string => !!date)
            .sort()
            .at(-1) ?? null,
      },
      {
        id: "projects",
        title: "在做的事",
        count: !section ? listProjects(ws).length : null,
        sources: ["本机项目档案"],
        latest: null,
      },
      {
        id: "health",
        title: "健康",
        count: !section || section === "health" ? health.length : null,
        ...fromRecords(health),
      },
      { id: "finance", title: "财务", count: !section ? finance.length : null, ...fromRecords(finance) },
      {
        id: "notes",
        title: "笔记与决策",
        count: !section || section === "notes" ? notes.length : null,
        sources: ["学习笔记", "决策记录"],
        latest: null,
      },
      {
        id: "inbox",
        title: "收件箱",
        count: !section ? inbox.length : null,
        sources: [...new Set(inbox.map((row) => (row.source === "me" ? "随手记" : "其他原文")))],
        latest: inbox[0]?.date ?? null,
      },
    ],
  };
}
export function readLibraryDocument(ws: Workspace, file: string) {
  // 资料详情只接受目录页所列的主题状态文档；不为验证一个路径读取其他资料。
  if (!/^(learning|decisions)\/[^./][^/]*\/STATUS\.md$/.test(file) || file.includes("\\"))
    throw new KaituError("找不到这份资料", "NOT_FOUND");
  assertAgentPath(ws.root, file);
  if (
    !ws.exists(file) ||
    !lstatSync(ws.resolve(file.slice(0, file.lastIndexOf("/")))).isDirectory() ||
    ws.conflictCopy(file)
  )
    throw new KaituError("找不到这份资料", "NOT_FOUND");
  return ws.readText(file);
}

/** 按日期目录、文件名倒序续读；正文只在这一页或来源筛选命中之前读取。 */
function inboxPage(
  ws: Workspace,
  query: LibraryQuery,
  read: (file: string, organized: boolean) => InboxEntry[],
) {
  const limit = 40;
  const directories: { date: string; path: string; organized: boolean }[] = [];
  for (const base of ["inbox/notes", "inbox/notes/done"]) {
    if (!ws.exists(base)) continue;
    for (const dir of readdirSync(ws.resolve(base), { withFileTypes: true })) {
      if (dir.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(dir.name))
        directories.push({ date: dir.name, path: `${base}/${dir.name}`, organized: base.endsWith("/done") });
    }
  }
  const dates = [...new Set(directories.map((dir) => dir.date))].sort().reverse();
  const entries: { key: string; value: InboxEntry }[] = [];
  for (const date of dates) {
    if (query.before && date > query.before.slice(0, 10)) continue;
    const files = directories
      .filter((dir) => dir.date === date)
      .flatMap((dir) =>
        readdirSync(ws.resolve(dir.path), { withFileTypes: true })
          .filter((file) => file.isFile() && file.name.endsWith(".md"))
          .map((file) => ({
            ...dir,
            file: `${dir.path}/${file.name}`,
            key: `${date}/${file.name}/${dir.organized ? 1 : 0}`,
          })),
      )
      .sort((a, b) => b.key.localeCompare(a.key));
    for (const file of files) {
      if (query.before && file.key.localeCompare(query.before) >= 0) continue;
      for (const value of read(file.file, file.organized)) {
        // An unreadable header cannot be classified; keep its explicit error visible.
        if (query.source && query.source !== "all" && value.source !== query.source && !value.error) continue;
        entries.push({ key: file.key, value });
        if (entries.length > limit)
          return {
            inbox: entries.slice(0, limit).map((row) => row.value),
            next: entries[limit - 1]?.key ?? null,
          };
      }
    }
  }
  return { inbox: entries.map((row) => row.value), next: null };
}
