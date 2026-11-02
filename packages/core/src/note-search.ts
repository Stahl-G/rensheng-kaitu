import { type FSWatcher, readdirSync, watch } from "node:fs";
import { setImmediate } from "node:timers/promises";
import { assertAgentPath } from "./agent-file-policy.js";
import { excerpt, openIndex } from "./chat-search.js";
import { readTopicStatus } from "./doing-page.js";
import { KaituError } from "./errors.js";
import { redact } from "./handover.js";
import { readLibraryDocument } from "./library.js";
import type { Workspace } from "./workspace.js";

export interface NoteSearchResult {
  file: string;
  title: string;
  kind: "笔记" | "决定";
  snippet: string;
}
type IndexState = {
  root: string;
  dirty: Set<string> | null;
  errors: Set<string>;
  pending?: Promise<void>;
  watcher?: FSWatcher;
  watcherClosed?: Promise<void>;
};
const indexes = new WeakMap<Workspace, IndexState>();
const disposed = new WeakMap<Workspace, Promise<void>>();
const pauses = new WeakMap<Workspace, { done: Promise<boolean>; resume: (open: boolean) => void }>();
const notePath = /^(learning|decisions)\/[^./][^/]*\/STATUS\.md$/;

export function invalidateNoteIndex(ws: Workspace, file: string): void {
  const state = indexes.get(ws);
  if (!state) return;
  const topicFile = file.replace(/^(learning\/[^./][^/]*\/)notes\.md$/, "$1STATUS.md");
  if (notePath.test(topicFile)) state.dirty?.add(topicFile);
  else if (/^(learning|decisions)(\/[^./][^/]*)?$/.test(file)) state.dirty = null;
}
/** Permanently stop this Workspace's index and wait for its owned resources. */
export function disposeNoteIndex(ws: Workspace): Promise<void> {
  const previous = disposed.get(ws);
  if (previous) return previous;
  const state = indexes.get(ws);
  const pending = state?.pending;
  const closing = Promise.resolve().then(() => drainIndex(state, pending));
  disposed.set(ws, closing);
  indexes.delete(ws);
  pauses.get(ws)?.resume(false);
  pauses.delete(ws);
  return closing;
}

async function stopObserving(state?: IndexState): Promise<void> {
  const watcher = state?.watcher;
  if (state) state.watcher = undefined;
  watcher?.close();
  await state?.watcherClosed;
}

async function drainIndex(state?: IndexState, pending = state?.pending): Promise<void> {
  const results = await Promise.allSettled([pending, stopObserving(state)]);
  const errors = results.flatMap((result) => (result.status === "rejected" ? [result.reason] : []));
  if (errors.length > 1) throw new AggregateError(errors, "Note index shutdown failed");
  if (errors.length) throw errors[0];
}

/** Stop the listener and drain an in-flight SQLite build before moving its directories. */
export async function pauseNoteIndex(ws: Workspace): Promise<void> {
  const closing = disposed.get(ws);
  if (closing) return closing;
  if (!pauses.has(ws)) {
    let resume!: (open: boolean) => void;
    const done = new Promise<boolean>((resolve) => {
      resume = resolve;
    });
    pauses.set(ws, { done, resume });
  }
  const state = indexes.get(ws);
  await drainIndex(state);
}

export function resumeNoteIndex(ws: Workspace): void {
  if (disposed.has(ws)) return;
  const pause = pauses.get(ws);
  if (!pause) return;
  const state = indexes.get(ws);
  if (state) {
    state.root = ws.root;
    state.dirty = null;
    observe(ws, state);
  }
  pauses.delete(ws);
  pause.resume(true);
}

function observe(ws: Workspace, state: IndexState) {
  try {
    const watcher = watch(ws.root, { recursive: true }, (_event, file) => {
      if (file) invalidateNoteIndex(ws, String(file).replaceAll("\\", "/"));
      else state.dirty = null;
    });
    state.watcher = watcher;
    // Node's watcher error path closes the native handle without emitting "close".
    state.watcherClosed = new Promise<void>((resolve) => {
      const stopped = () => {
        watcher.off("close", stopped);
        watcher.off("error", stopped);
        resolve();
      };
      watcher.once("close", stopped);
      watcher.once("error", stopped);
    });
    watcher.unref();
    watcher.on("error", () => {
      if (state.watcher !== watcher) return;
      watcher.close();
      state.watcher = undefined;
      state.dirty = null;
    });
  } catch {
    /* The caller receives the same unavailable-listener error below. */
  }
}

async function synchronize(ws: Workspace, state: IndexState): Promise<void> {
  const dirty = state.dirty;
  state.dirty = new Set();
  try {
    // Yield before the first build so the page can paint its search feedback.
    await setImmediate();
    const files = dirty
      ? [...dirty]
      : ["learning", "decisions"].flatMap((dir) =>
          ws.exists(dir)
            ? readdirSync(ws.resolve(dir), { withFileTypes: true })
                .filter(
                  (entry) =>
                    entry.isDirectory() &&
                    !entry.name.startsWith(".") &&
                    !ws.conflictCopy(`${dir}/${entry.name}`),
                )
                .map((entry) => `${dir}/${entry.name}/STATUS.md`)
            : [],
        );
    const db = openIndex(ws);
    try {
      db.exec(
        "CREATE VIRTUAL TABLE IF NOT EXISTS notes USING fts5(file UNINDEXED, title, text, tokenize='trigram')",
      );
      if (!dirty) {
        db.exec("DELETE FROM notes");
        state.errors.clear();
      }
      const remove = db.prepare("DELETE FROM notes WHERE file = ?");
      const insert = db.prepare("INSERT INTO notes(file, title, text) VALUES (?, ?, ?)");
      // Short transactions let other work use the shared, rebuildable index between batches.
      for (let start = 0; start < files.length; start += 250) {
        db.exec("BEGIN");
        try {
          for (const file of files.slice(start, start + 250)) {
            if (dirty) remove.run(file);
            state.errors.delete(file);
            if (!ws.exists(file) || ws.conflictCopy(file)) continue;
            const { data, body } = readTopicStatus(readLibraryDocument(ws, file));
            if (!data) state.errors.add(file);
            const title =
              typeof data?.title === "string" ? data.title : (body.match(/^#\s+(.+)$/m)?.[1] ?? file);
            const notesFile = file.replace(/\/STATUS\.md$/, "/notes.md");
            let notes = "";
            if (file.startsWith("learning/") && ws.exists(notesFile) && !ws.conflictCopy(notesFile)) {
              assertAgentPath(ws.root, notesFile);
              notes = ws.scanText(notesFile) ?? "";
            }
            // Keep one result per topic so existing UI routing opens its saved learning record.
            insert.run(file, redact(title, "zh-CN"), redact([body, notes].join("\n\n"), "zh-CN"));
          }
          db.exec("COMMIT");
        } catch (error) {
          db.exec("ROLLBACK");
          throw error;
        }
        await setImmediate();
      }
    } finally {
      db.close();
    }
  } catch (error) {
    state.dirty = null;
    throw error;
  }
}

/** UI search reuses the existing local SQLite FTS5 index; warm queries read no note files. */
export async function searchLibraryNotes(ws: Workspace, query: string): Promise<NoteSearchResult[]> {
  if (disposed.has(ws))
    throw new KaituError("笔记搜索已关闭 / Note search closed", "NOTE_SEARCH_UNAVAILABLE");
  const term = query.trim();
  if (!term) return [];
  const pause = pauses.get(ws);
  if (pause) {
    if (!(await pause.done))
      throw new KaituError("笔记搜索已关闭 / Note search closed", "NOTE_SEARCH_UNAVAILABLE");
    return searchLibraryNotes(ws, query);
  }
  let state = indexes.get(ws);
  if (state && state.root !== ws.root) {
    try {
      await pauseNoteIndex(ws);
    } finally {
      resumeNoteIndex(ws);
    }
    return searchLibraryNotes(ws, query);
  }
  if (!state) {
    state = { root: ws.root, dirty: null, errors: new Set() };
    indexes.set(ws, state);
    observe(ws, state);
  }
  if (!state.watcher) {
    await disposeNoteIndex(ws);
    throw new KaituError(
      "无法监听笔记变化，请重新打开工作区 / Could not watch notes; reopen the workspace",
      "NOTE_SEARCH_UNAVAILABLE",
    );
  }
  while (state.pending || state.dirty === null || state.dirty.size) {
    if (!state.pending)
      state.pending = synchronize(ws, state).finally(() => {
        if (state) state.pending = undefined;
      });
    await state.pending;
    if (indexes.get(ws) !== state)
      throw new KaituError("笔记搜索已关闭 / Note search closed", "NOTE_SEARCH_UNAVAILABLE");
    if (pauses.has(ws)) return searchLibraryNotes(ws, query);
  }
  const db = openIndex(ws);
  try {
    const rows =
      [...term].length < 3
        ? db
            .prepare(
              "SELECT file, title, text FROM notes WHERE title LIKE ? ESCAPE '\\' OR text LIKE ? ESCAPE '\\' LIMIT 50",
            )
            .all(...Array(2).fill(`%${term.replace(/[\\%_]/g, "\\$&")}%`))
        : db
            .prepare("SELECT file, title, text FROM notes WHERE notes MATCH ? ORDER BY rank LIMIT 50")
            .all(`"${term.replace(/"/g, '""')}"`);
    return rows.map((row) => ({
      file: String(row.file),
      title: String(row.title),
      kind: String(row.file).startsWith("decisions/") ? "决定" : "笔记",
      snippet: `${state.errors.has(String(row.file)) ? "文件格式有误，请检查 / Invalid document: " : ""}${excerpt(String(row.text), term)}`,
    }));
  } finally {
    db.close();
  }
}
