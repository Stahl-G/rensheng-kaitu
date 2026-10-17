import { type FSWatcher, watch } from "node:fs";
import { type Workspace, processInbox } from "@kaitu/core";
import type { MutationQueue } from "./dsh.js";

/** dsh 开着时处理收件箱：启动时一次、收件箱有变化时、以及每分钟兜底一次（Drive 同步不一定触发文件事件）。 */
export function startInboxLoop(
  ws: Workspace,
  intervalMs = 60000,
  queue: MutationQueue = (run) => run(),
): () => void {
  let running = false;
  let again = false;
  let closed = false;
  let timer: NodeJS.Timeout | undefined;
  const run = async () => {
    if (closed) return;
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      await queue(async () => {
        if (!closed) await processInbox(ws);
      });
    } catch (error) {
      console.warn("[kaitu] 处理收件箱失败：", (error as Error).message);
    } finally {
      running = false;
      if (again && !closed) {
        again = false;
        void run();
      }
    }
  };
  const schedule = (delay: number) => {
    clearTimeout(timer);
    timer = setTimeout(() => void run(), delay);
  };
  let watcher: FSWatcher | undefined;
  try {
    watcher = watch(ws.resolve("inbox"), { recursive: true }, () => schedule(2000));
    watcher.once("error", () => {
      watcher?.close();
      watcher = undefined;
    });
  } catch {
    // 目录不可监听时只靠定时器。
  }
  const interval = setInterval(() => void run(), intervalMs);
  void run();
  return () => {
    closed = true;
    clearTimeout(timer);
    clearInterval(interval);
    watcher?.close();
  };
}
