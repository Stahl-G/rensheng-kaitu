import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import type { HomeData } from "./home.js";
import type { Workspace } from "./workspace.js";

export interface HomeState {
  data: HomeData | null;
  loading: boolean;
  error: string | null;
}

/** One background projection per open workspace; requests only read the published state. */
export function createHomeCache(ws: Workspace, notify: () => void) {
  let state: HomeState = { data: null, loading: true, error: null };
  let generation = 0;
  let root = ws.root;
  let closed = false;
  let worker: Worker | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  function rebuild() {
    if (closed || worker) return;
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
    function finish(data: HomeData | null, error: string | null) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      void active.terminate();
      worker = null;
      if (closed) return;
      if (current !== generation) {
        rebuild();
        return;
      }
      state = { data: data ?? state.data, loading: false, error };
      notify();
    }
    active.on("message", (message) => finish(message.data ?? null, message.error ?? null));
    active.once("error", () => finish(null, "首页读取失败"));
    active.once("exit", () => finish(null, "首页读取中断"));
  }
  function invalidate() {
    if (closed) return;
    generation++;
    if (root !== ws.root) {
      root = ws.root;
      state = { data: null, loading: true, error: null };
    }
    state = { ...state, loading: true, error: null };
    clearTimeout(timer);
    timer = setTimeout(rebuild, 100);
  }
  timer = setTimeout(rebuild, 0);
  return {
    read: () => state,
    invalidate,
    close() {
      closed = true;
      clearTimeout(timer);
      void worker?.terminate();
      worker = null;
    },
  };
}
