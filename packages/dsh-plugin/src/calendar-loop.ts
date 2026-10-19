import { type Workspace, pullCalendarSubscriptions } from "@kaitu/core";
import type { MutationQueue } from "./dsh.js";

export function startCalendarLoop(ws: Workspace, queue: MutationQueue): () => Promise<void> {
  let pending: Promise<unknown> | undefined;
  const run = () => {
    pending ??= pullCalendarSubscriptions(ws, new Date(), queue)
      .catch(() => {})
      .finally(() => {
        pending = undefined;
      });
  };
  const timer = setInterval(run, 60000);
  timer.unref();
  run();
  return async () => {
    clearInterval(timer);
    await pending;
  };
}
