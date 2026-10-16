import { readdirSync } from "node:fs";
import { readCalendar } from "./calendar.js";
import { readDoing } from "./doing-page.js";
import { KaituError } from "./errors.js";
import { parseFrontmatter } from "./frontmatter.js";
import { inboxNotes } from "./inbox-notes.js";
import { listRecordTypes } from "./modules.js";
import { listProjects } from "./projects.js";
import { readRecords } from "./records.js";
import type { Workspace } from "./workspace.js";

export interface LibraryItem {
  id: string;
  title: string;
  count: number;
  sources: string[];
  latest: string | null;
}
export interface InboxEntry {
  file: string;
  text: string;
  source: string;
  date: string | null;
  status: "organized" | "review" | "raw";
  destination: string | null;
}
export interface LibraryData {
  sections: LibraryItem[];
  inbox: InboxEntry[];
  notes: { file: string; title: string; kind: "笔记" | "决定"; status: string | null }[];
}
export function readLibrary(ws: Workspace): LibraryData {
  const calendar = readCalendar(ws);
  const doing = readDoing(ws);
  const entry = (file: string, organized: boolean): InboxEntry => {
    const { data, body } = parseFrontmatter(ws.readText(file));
    return {
      file,
      text: body.trim(),
      source: data.kind === "capture" ? "me" : "other",
      date:
        typeof data.created === "string" ? data.created : typeof data.date === "string" ? data.date : null,
      status: organized ? "organized" : data.kind === "capture" ? "raw" : "review",
      destination: null,
    };
  };
  const inbox = inboxNotes(ws).map((note) => entry(note.path, false));
  const done = "inbox/notes/done";
  if (ws.exists(done))
    for (const day of readdirSync(ws.resolve(done), { withFileTypes: true })) {
      if (!day.isDirectory() || !/^\d{4}-\d{2}-\d{2}$/.test(day.name)) continue;
      for (const file of readdirSync(ws.resolve(`${done}/${day.name}`), { withFileTypes: true })) {
        if (file.isFile() && file.name.endsWith(".md"))
          inbox.push(entry(`${done}/${day.name}/${file.name}`, true));
      }
    }
  inbox.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  const records = (types: string[]) => types.flatMap((type) => readRecords(ws, type));
  const health = records(
    listRecordTypes(ws)
      .filter((r) => r.module.def.id === "health")
      .map((r) => r.type),
  );
  const finance = records(["finance_account", "finance_transaction", "finance_holding_snapshot"]);
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
    inbox,
    notes,
    sections: [
      {
        id: "calendar",
        title: "日程",
        count: calendar.events.length,
        sources: [...new Set(calendar.events.map((row) => row.source))],
        latest:
          calendar.subscriptions
            .map((row) => row.syncedAt)
            .filter((date): date is string => !!date)
            .sort()
            .at(-1) ?? null,
      },
      {
        id: "projects",
        title: "在做的事",
        count: listProjects(ws).length,
        sources: ["本机项目档案"],
        latest: null,
      },
      { id: "health", title: "健康", count: health.length, ...fromRecords(health) },
      { id: "finance", title: "财务", count: finance.length, ...fromRecords(finance) },
      {
        id: "notes",
        title: "笔记与决策",
        count: notes.length,
        sources: ["学习笔记", "决策记录"],
        latest: null,
      },
      {
        id: "inbox",
        title: "收件箱",
        count: inbox.length,
        sources: [...new Set(inbox.map((row) => (row.source === "me" ? "随手记" : "其他原文")))],
        latest: inbox[0]?.date ?? null,
      },
    ],
  };
}
export function readLibraryDocument(ws: Workspace, file: string) {
  if (!readLibrary(ws).notes.some((note) => note.file === file))
    throw new KaituError("找不到这份资料", "NOT_FOUND");
  return ws.readText(file);
}
