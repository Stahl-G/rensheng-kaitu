import { type FSWatcher, renameSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { expect, it, vi } from "vitest";
import { openIndex } from "../src/chat-search.js";
import { disposeNoteIndex, pauseNoteIndex, resumeNoteIndex, searchLibraryNotes } from "../src/note-search.js";
import { freshWorkspace } from "./helpers.js";

const control = vi.hoisted(() => ({
  remaining: 0,
  entered: () => {},
  release: undefined as Promise<void> | undefined,
  watchers: new Set<FSWatcher>(),
}));
vi.mock("node:timers/promises", async (original) => {
  const timers = await original<typeof import("node:timers/promises")>();
  return {
    ...timers,
    setImmediate: async () => {
      if (control.remaining && --control.remaining === 0) {
        control.entered();
        await control.release;
      }
      return timers.setImmediate();
    },
  };
});
vi.mock("node:fs", async (original) => {
  const fs = await original<typeof import("node:fs")>();
  return {
    ...fs,
    watch: (...args: Parameters<typeof fs.watch>) => {
      const watcher = fs.watch(...args);
      control.watchers.add(watcher);
      watcher.once("close", () => control.watchers.delete(watcher));
      return watcher;
    },
  };
});

it("pause and dispose drain real index builds before directory moves, and dispose prevents reopening", async () => {
  for (const operation of ["pause", "dispose"] as const) {
    for (const yieldNumber of [1, 2]) {
      const ws = await freshWorkspace();
      const label = `${operation}, yield ${yieldNumber}`;
      const databases = new Set<DatabaseSync>();
      const exec = DatabaseSync.prototype.exec;
      const spy = vi.spyOn(DatabaseSync.prototype, "exec").mockImplementation(function (
        this: DatabaseSync,
        sql,
      ) {
        databases.add(this);
        return exec.call(this, sql);
      });
      let release!: () => void;
      control.release = new Promise<void>((resolve) => {
        release = resolve;
      });
      const entered = new Promise<void>((resolve) => {
        control.entered = resolve;
      });
      control.remaining = yieldNumber;
      const outcome = (promise: Promise<unknown>) =>
        promise.then(
          (value) => ({ value, error: undefined }),
          (error: unknown) => ({ value: undefined, error }),
        );
      const queries: ReturnType<typeof outcome>[] = [];
      const failures: { phase: string; error: unknown }[] = [];
      try {
        ws.writeText("decisions/synthetic/STATUS.md", "---\ntitle: 合成决定\n---\n合成生命周期正文");
        queries.push(outcome(searchLibraryNotes(ws, "生命周期")));
        await entered;
        expect(
          [...databases].some((db) => db.isOpen),
          label,
        ).toBe(yieldNumber === 2);
        const stopping = operation === "pause" ? pauseNoteIndex(ws) : disposeNoteIndex(ws);
        let stopped = false;
        const settled = Promise.resolve(stopping).then(() => {
          stopped = true;
        });
        queries.push(outcome(searchLibraryNotes(ws, "生命周期")));
        await Promise.resolve();
        expect(stopped, label).toBe(false);
        release();
        await settled;
        expect(
          [...databases].every((db) => !db.isOpen),
          label,
        ).toBe(true);
        expect(control.watchers.size, label).toBe(0);
        // Real Windows rename/delete operations, with no timer or retry after the lifecycle API.
        const index = ws.resolve(".kaitu/index.sqlite", { internal: true });
        renameSync(index, `${index}.moved`);
        rmSync(`${index}.moved`);
        renameSync(ws.root, `${ws.root}-moved`);
        renameSync(`${ws.root}-moved`, ws.root);
        if (operation === "pause") {
          resumeNoteIndex(ws);
          for (const query of queries) expect((await query).value, label).toHaveLength(1);
          // The fallback for an externally changed root must reset, not terminally dispose.
          renameSync(ws.root, `${ws.root}-moved`);
          ws.root = `${ws.root}-moved`;
          expect(await searchLibraryNotes(ws, "生命周期"), label).toHaveLength(1);
        } else {
          expect(disposeNoteIndex(ws), label).toBe(stopping);
          resumeNoteIndex(ws);
          for (const query of queries)
            expect((await query).error, label).toMatchObject({ code: "NOTE_SEARCH_UNAVAILABLE" });
          await expect(searchLibraryNotes(ws, "生命周期")).rejects.toMatchObject({
            code: "NOTE_SEARCH_UNAVAILABLE",
          });
          expect(control.watchers.size, label).toBe(0);
        }
      } catch (error) {
        failures.push({ phase: "body", error });
      } finally {
        release();
        control.remaining = 0;
        try {
          try {
            await disposeNoteIndex(ws);
          } catch (error) {
            failures.push({ phase: "close", error });
          }
          await Promise.all(queries);
        } finally {
          spy.mockRestore();
        }
        for (const root of [ws.root, `${ws.root}-moved`]) {
          try {
            rmSync(root, { recursive: true, force: true });
          } catch (error) {
            failures.push({ phase: "delete", error });
          }
        }
      }
      if (failures.length > 1)
        throw new AggregateError(
          failures.map(({ error }) => error),
          `${label}: ${failures.map(({ phase }) => phase).join(", ")} failed`,
        );
      if (failures.length) throw failures[0]?.error;
    }
  }
});

it("failed SQLite initialization closes the real database and preserves the initialization error", async () => {
  const ws = await freshWorkspace();
  const failure = new Error("synthetic schema failure");
  const failures: { phase: string; error: unknown }[] = [];
  let database: DatabaseSync | undefined;
  const spy = vi.spyOn(DatabaseSync.prototype, "exec").mockImplementation(function (this: DatabaseSync) {
    database = this;
    throw failure;
  });
  try {
    let caught: unknown;
    try {
      openIndex(ws);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBe(failure);
    expect(database?.isOpen).toBe(false);
    const index = ws.resolve(".kaitu/index.sqlite", { internal: true });
    renameSync(index, `${index}.moved`);
    rmSync(`${index}.moved`);
  } catch (error) {
    failures.push({ phase: "body", error });
  } finally {
    spy.mockRestore();
    try {
      if (database?.isOpen) database.close();
    } catch (error) {
      failures.push({ phase: "close", error });
    }
    try {
      rmSync(ws.root, { recursive: true, force: true });
    } catch (error) {
      failures.push({ phase: "delete", error });
    }
  }
  if (failures.length > 1)
    throw new AggregateError(
      failures.map(({ error }) => error),
      `Index initialization: ${failures.map(({ phase }) => phase).join(", ")} failed`,
    );
  if (failures.length) throw failures[0]?.error;
});
