import { type FSWatcher, existsSync, watch } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import type { HomeData, HomeSources } from "./home.js";
import { publishOverview } from "./overview.js";
import { projectionDay, projectionUnchanged, readProjection } from "./projection-cache.js";
import type { Workspace, WorkspaceWrite } from "./workspace.js";

export interface HomeState {
  data: HomeData | null;
  presentation?: Pick<
    HomeSources["overview"],
    "today" | "timeZone" | "cutoff" | "metrics" | "proposedTasks" | "warnings"
  >;
  loading: boolean;
  error: string | null;
}

/** One background projection per open workspace; requests only read the published state. */
export function createHomeCache(
  ws: Workspace,
  notify: () => void,
  options: { write?: WorkspaceWrite; report?: (error: unknown) => void } = {},
) {
  let state: HomeState = { data: null, loading: true, error: null };
  let serialized = JSON.stringify(state);
  let refreshing = serialized;
  function publish(next: HomeState) {
    state = next;
    serialized = JSON.stringify(next);
    refreshing = JSON.stringify({ ...next, loading: true, error: null });
  }
  let generation = 0;
  let root = ws.root;
  let closed = false;
  let paused = false;
  let worker: Worker | null = null;
  let pending: number | null = null;
  let summaryOnly = false;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let retiring: Promise<unknown> = Promise.resolve();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timeZone = "UTC";
  let day = "";
  let expires: number | null = null;
  let watchers: FSWatcher[] = [];
  const inputs = () => ({ root: ws.root, state: dirname(ws.resolve(".kaitu/cache", { internal: true })) });
  const cached = readProjection<Pick<HomeState, "data" | "presentation">>(inputs(), "home");
  if (cached) {
    publish({ ...cached.value, loading: false, error: null });
    ({ timeZone, day, expires } = cached);
  }
  function observe() {
    for (const watcher of watchers) watcher.close();
    watchers = [];
    for (const directory of new Set([ws.root, inputs().state])) {
      try {
        const watcher = watch(directory, { recursive: true }, (_event, file) => {
          if (
            file &&
            /^(?:phone(?:[/\\]|$)|OVERVIEW\.md$|USER\.md$)|(?:^|[/\\])(?:index\.sqlite[^/\\]*|cache|secrets\.json|\.git)(?:[/\\]|$)|\.tmp$/.test(
              String(file),
            )
          )
            return;
          invalidate();
        });
        watcher.unref();
        watcher.on("error", () => invalidate());
        watchers.push(watcher);
      } catch {
        /* Periodic revalidation below also covers unavailable native watchers. */
      }
    }
  }
  observe();
  function retire(active: Worker) {
    retiring = Promise.all([retiring, active.terminate()]);
  }
  function failed(active: Worker, error: string) {
    if (worker !== active) return;
    const request = pending;
    clearTimeout(deadline);
    pending = null;
    worker = null;
    retire(active);
    if (closed || paused) return;
    if (request !== null && request !== generation) {
      rebuild();
      return;
    }
    publish({ data: null, loading: false, error });
    notify();
  }
  function rebuild(onlySummary = false) {
    if (closed || paused || pending !== null) return;
    summaryOnly = onlySummary;
    const request = { root: ws.root, generation, summary: !!options.write, summaryOnly };
    pending = generation;
    if (worker) {
      worker.ref();
      worker.postMessage(request);
    } else {
      const entry = [
        "./home-worker.js",
        "../dist/home-worker.js",
        "../engine/home-worker.js",
        "../../dist/engine/home-worker.js",
      ]
        .map((path) => new URL(path, import.meta.url))
        .find((path) => existsSync(fileURLToPath(path)));
      if (!entry) {
        pending = null;
        publish({ data: null, loading: false, error: "首页组件缺失" });
        notify();
        return;
      }
      try {
        worker = new Worker(entry, { workerData: request });
      } catch {
        pending = null;
        publish({ data: null, loading: false, error: "首页读取失败" });
        notify();
        return;
      }
      const active = worker;
      active.on("message", (message) => {
        if (worker !== active || closed || paused) return;
        if (message.summary || message.summaryError) {
          if (message.summaryOnly && summaryOnly && pending === message.generation) {
            clearTimeout(deadline);
            pending = null;
          }
          if (pending === null) active.unref();
          if (message.generation !== generation) {
            if (state.loading) rebuild();
            return;
          }
          if (message.summaryError) {
            options.report?.(new Error(message.summaryError));
            return;
          }
          void options
            .write?.(async () => {
              if (closed || paused || message.generation !== generation || ws.root !== message.input.root)
                return;
              if (
                (message.manifest && !projectionUnchanged(message.input, message.manifest)) ||
                !publishOverview(ws, message.summary)
              ) {
                invalidate();
                return;
              }
              notify();
            })
            .catch((error) => options.report?.(error));
          return;
        }
        clearTimeout(deadline);
        pending = null;
        if (message.changed) generation++;
        if (message.generation !== generation) {
          rebuild();
          return;
        }
        if (message.data) ({ timeZone, day, expires } = message);
        publish({
          data: message.error ? null : message.data,
          presentation: message.error ? undefined : message.presentation,
          loading: false,
          error: message.error ?? null,
        });
        active.unref();
        notify();
      });
      active.once("error", () => failed(active, "首页读取失败"));
      active.once("exit", () => failed(active, "首页读取中断"));
    }
    const active = worker;
    deadline = setTimeout(() => failed(active, "首页读取超时"), 30_000);
  }
  function invalidate() {
    if (closed) return;
    generation++;
    const moved = root !== ws.root;
    if (moved) {
      root = ws.root;
      publish({ data: null, loading: true, error: null });
      observe();
    }
    const changed = moved || !state.loading;
    state = { ...state, loading: true, error: null };
    serialized = refreshing;
    if (changed) notify();
    clearTimeout(timer);
    timer = setTimeout(rebuild, 100);
  }
  if (!cached) timer = setTimeout(rebuild, 0);
  const check = setInterval(() => {
    if (paused || closed || pending !== null) return;
    try {
      if (!readProjection<HomeData>(inputs(), "home")) invalidate();
    } catch {
      invalidate();
    }
  }, 60_000);
  check.unref();
  async function stopWorker() {
    clearTimeout(timer);
    const active = worker;
    worker = null;
    pending = null;
    clearTimeout(deadline);
    if (active) retire(active);
    await retiring;
  }
  function read() {
    if (
      root !== ws.root ||
      (!state.loading &&
        day &&
        (projectionDay(new Date(), timeZone) !== day || (expires !== null && Date.now() >= expires)))
    )
      invalidate();
    return state;
  }
  return {
    read,
    readSerialized: () => {
      read();
      return serialized;
    },
    invalidate,
    refreshDerived: () => {
      if (options.write) rebuild(!state.loading);
    },
    async pause() {
      paused = true;
      await stopWorker();
    },
    resume() {
      paused = false;
      invalidate();
    },
    async close() {
      closed = true;
      clearInterval(check);
      for (const watcher of watchers) watcher.close();
      await stopWorker();
    },
  };
}
