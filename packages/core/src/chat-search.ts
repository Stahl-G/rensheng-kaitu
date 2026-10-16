import { mkdirSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { type ChatDocument, listChatFiles, readChat } from "./chats.js";
import { KaituError } from "./errors.js";
import type { Workspace } from "./workspace.js";

const INDEX_FILE = ".kaitu/index.sqlite";

export interface ChatSearchResult {
  id: string;
  title: string;
  date: string;
  file: string;
  snippet: string;
}

interface IndexedFile {
  file: string;
  mtime: number;
  ctime: number;
  size: number;
}

function openIndex(ws: Workspace): DatabaseSync {
  const path = ws.resolve(INDEX_FILE, { internal: true });
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS chats USING fts5(
      file UNINDEXED, id UNINDEXED, title, date UNINDEXED, text, tokenize='trigram'
    );
    CREATE TABLE IF NOT EXISTS files (
      file TEXT PRIMARY KEY, mtime REAL NOT NULL, ctime REAL NOT NULL, size INTEGER NOT NULL
    );
  `);
  return db;
}

function transaction(db: DatabaseSync, write: () => void): void {
  db.exec("BEGIN");
  try {
    write();
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function indexDocument(db: DatabaseSync, ws: Workspace, document: ChatDocument): void {
  const { file, header, messages } = document;
  const stat = statSync(ws.resolve(file));
  db.prepare("DELETE FROM chats WHERE file = ?").run(file);
  db.prepare("INSERT INTO chats (file, id, title, date, text) VALUES (?, ?, ?, ?, ?)").run(
    file,
    header.id,
    header.title,
    header.created,
    messages.map((message) => message.text).join("\n"),
  );
  db.prepare("INSERT OR REPLACE INTO files (file, mtime, ctime, size) VALUES (?, ?, ?, ?)").run(
    file,
    stat.mtimeMs,
    stat.ctimeMs,
    stat.size,
  );
}

function syncIndex(db: DatabaseSync, ws: Workspace): void {
  const indexed = new Map(
    (db.prepare("SELECT * FROM files").all() as unknown as IndexedFile[]).map((row) => [row.file, row]),
  );
  transaction(db, () => {
    for (const file of listChatFiles(ws)) {
      const before = indexed.get(file);
      indexed.delete(file);
      const stat = statSync(ws.resolve(file));
      if (before?.mtime === stat.mtimeMs && before.ctime === stat.ctimeMs && before.size === stat.size) {
        continue;
      }
      indexDocument(db, ws, readChat(ws, file));
    }
    const unavailable = ws.unavailableFiles("chats");
    for (const file of indexed.keys()) {
      if (unavailable.some((path) => file === path || file.startsWith(`${path}/`))) continue;
      db.prepare("DELETE FROM chats WHERE file = ?").run(file);
      db.prepare("DELETE FROM files WHERE file = ?").run(file);
    }
  });
}

export function updateChatIndex(ws: Workspace, documents: ChatDocument[]): void {
  const db = openIndex(ws);
  try {
    transaction(db, () => {
      for (const document of documents) indexDocument(db, ws, document);
    });
  } finally {
    db.close();
  }
}

export function reindexChats(ws: Workspace): number {
  ws.assertDownloaded("chats");
  const db = openIndex(ws);
  try {
    const files = listChatFiles(ws);
    transaction(db, () => {
      db.exec("DELETE FROM chats; DELETE FROM files;");
      for (const file of files) indexDocument(db, ws, readChat(ws, file));
    });
    return files.length;
  } finally {
    db.close();
  }
}

function excerpt(text: string, query: string): string {
  const normalized = text.replace(/\s+/gu, " ");
  const at = normalized.toLowerCase().indexOf(query.toLowerCase());
  const start = Math.max(0, at - 35);
  const end = Math.min(normalized.length, start + 140);
  return `${start ? "…" : ""}${normalized.slice(start, end)}${end < normalized.length ? "…" : ""}`;
}

export function searchChats(ws: Workspace, query: string, opts: { limit?: number } = {}): ChatSearchResult[] {
  const term = query.trim();
  if (!term) return [];
  const limit = opts.limit ?? 20;
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new KaituError("检索条数必须是正整数", "INVALID_INPUT");
  }
  const db = openIndex(ws);
  try {
    syncIndex(db, ws);
    const columns = "id, title, date, file, text";
    let rows: Record<string, unknown>[];
    if ([...term].length < 3) {
      const pattern = `%${term.replace(/[\\%_]/g, "\\$&")}%`;
      rows = db
        .prepare(`SELECT ${columns},
          (length(lower(title)) - length(replace(lower(title), lower(?), ''))) * 3
            + length(lower(text)) - length(replace(lower(text), lower(?), '')) AS relevance
          FROM chats
          WHERE title LIKE ? ESCAPE '\\' OR text LIKE ? ESCAPE '\\'
          ORDER BY relevance DESC, julianday(date) DESC, file LIMIT ?`)
        .all(term, term, pattern, pattern, limit);
    } else {
      const phrase = `"${term.replace(/"/g, '""')}"`;
      rows = db
        .prepare(`SELECT ${columns} FROM chats WHERE chats MATCH ?
          ORDER BY bm25(chats), julianday(date) DESC, file LIMIT ?`)
        .all(phrase, limit);
    }
    const unavailable = ws.unavailableFiles("chats");
    return rows
      .filter(
        (row) => !unavailable.some((file) => row.file === file || String(row.file).startsWith(`${file}/`)),
      )
      .map((row) => ({
        id: row.id as string,
        title: row.title as string,
        date: row.date as string,
        file: row.file as string,
        snippet: excerpt(`${row.title}\n${row.text}`, term),
      }));
  } finally {
    db.close();
  }
}
