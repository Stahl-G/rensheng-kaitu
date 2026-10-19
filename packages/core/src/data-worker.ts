import { existsSync } from "node:fs";
import { Worker } from "node:worker_threads";
import { KaituError } from "./errors.js";
import type { Workspace } from "./workspace.js";

export interface DataProgress {
  phase: string;
  completed: number;
  total?: number;
}
export interface DataRunOptions {
  signal?: AbortSignal;
  progress?: (value: DataProgress) => void;
}

/** 只供全文索引与 ZIP 两项 CPU 重活；没有持久任务库或新缓存。 */
export async function runDataWorker<T>(
  ws: Workspace,
  operation: "search" | "reindex" | "index-update" | "export",
  args: unknown,
  options: DataRunOptions = {},
): Promise<T> {
  options.signal?.throwIfAborted();
  const cancelled = new Int32Array(new SharedArrayBuffer(4));
  const entry = [
    "./data-worker-entry.js",
    "./data-worker.mjs",
    "./engine/data-worker.mjs",
    "../dist/data-worker-entry.js",
  ]
    .map((path) => new URL(path, import.meta.url))
    .find((path) => existsSync(path));
  if (!entry) throw new KaituError("找不到后台资料执行文件，请重新构建", "BACKGROUND_OPERATION");
  return new Promise<T>((resolve, reject) => {
    const worker = new Worker(entry, {
      workerData: { root: ws.root, operation, args, cancelled: cancelled.buffer },
    });
    let settled = false;
    const finish = (error?: Error, value?: T) => {
      if (settled) return;
      settled = true;
      options.signal?.removeEventListener("abort", abort);
      error ? reject(error) : resolve(value as T);
    };
    const abort = () => {
      Atomics.store(cancelled, 0, 1);
      // 导出只读，可直接停止压缩；SQLite 作业在文件间检查标记并回滚事务。
      if (operation === "export") {
        void worker.terminate();
        finish(new DOMException("Operation cancelled", "AbortError"));
      }
    };
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) abort();
    worker.on("message", (message) => {
      if (message.progress) options.progress?.(message.progress);
      else if (message.error)
        finish(
          options.signal?.aborted || message.error.name === "AbortError"
            ? new DOMException("Operation cancelled", "AbortError")
            : new KaituError(message.error.message, message.error.code),
        );
      else finish(undefined, message.result);
    });
    worker.on("error", (error) => finish(error));
    worker.on("exit", (code) => {
      if (!settled) finish(new Error(`Background operation exited (${code})`));
    });
  });
}
