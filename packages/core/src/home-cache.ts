import { type FSWatcher, existsSync, watch } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import type { HomeData, HomeSources } from "./home.js";
import { projectionDay, readProjection } from "./projection-cache.js";
import type { Workspace } from "./workspace.js";

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
export function createHomeCache(ws: Workspace, notify: () => void) {
  let state: HomeState = { data: null, loading: true, error: null };
  let generation = 0;
  let root = ws.root;
  let closed = false;
  let paused = false;
  let worker: Worker | null = null;
  let retiring: Promise<unknown> = Promise.resolve();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timeZone = "UTC";
  let day = "";
  let expires: number | null = null;
  let watchers: FSWatcher[] = [];
  const inputs = () => ({ root: ws.root, state: dirname(ws.resolve(".kaitu/cache", { internal: true })) });
  const cached = readProjection<Pick<HomeState, "data" | "presentation">>(inputs(), "home");
  if (cached) {
    state = { ...cached.value, loading: false, error: null };
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
  function rebuild() {
    if (closed || paused || worker) return;
    const current = generation;
    const entry = [
      "./home-worker.js",
      "../dist/home-worker.js",
      "../engine/home-worker.js",
      "../../dist/engine/home-worker.js",
    ]
      .map((path) => new URL(path, import.meta.url))
      .find((path) => existsSync(fileURLToPath(path)));
    if (!entry) {
      state = { ...state, loading: false, error: "首页组件缺失" };
      notify();
      return;
    }
    let active: Worker;
    try {
      active = new Worker(entry, { workerData: { root: ws.root } });
    } catch {
      state = { ...state, loading: false, error: "首页读取失败" };
      notify();
      return;
    }
    worker = active;
    let settled = false;
    const timeout = setTimeout(() => finish(null, "首页读取超时"), 30_000);
    function finish(data: HomeData | null, error: string | null, presentation?: HomeState["presentation"]) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      retiring = Promise.all([retiring, active.terminate()]);
      worker = null;
      if (closed || paused) return;
      if (current !== generation) {
        rebuild();
        return;
      }
      state = {
        data: error ? null : (data ?? state.data),
        presentation: error ? undefined : presentation,
        loading: false,
        error,
      };
      notify();
    }
    active.on("message", (message) => {
      if (message.changed) {
        generation++;
        finish(null, null);
        return;
      }
      if (message.data) ({ timeZone, day, expires } = message);
      finish(message.data ?? null, message.error ?? null, message.presentation);
    });
    active.once("error", () => finish(null, "首页读取失败"));
    active.once("exit", () => finish(null, "首页读取中断"));
  }
  function invalidate() {
    if (closed) return;
    generation++;
    if (root !== ws.root) {
      root = ws.root;
      state = { data: null, loading: true, error: null };
      observe();
    }
    state = { ...state, loading: true, error: null };
    clearTimeout(timer);
    timer = setTimeout(rebuild, 100);
  }
  if (!cached) timer = setTimeout(rebuild, 0);
  const check = setInterval(() => {
    if (!paused && !closed && !worker && !readProjection<HomeData>(inputs(), "home")) invalidate();
  }, 60_000);
  check.unref();
  async function stopWorker() {
    clearTimeout(timer);
    const active = worker;
    worker = null;
    if (active) retiring = Promise.all([retiring, active.terminate()]);
    await retiring;
  }
  return {
    read: () => {
      if (
        root !== ws.root ||
        (day && (projectionDay(new Date(), timeZone) !== day || (expires !== null && Date.now() >= expires)))
      )
        invalidate();
      return state;
    },
    invalidate,
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
