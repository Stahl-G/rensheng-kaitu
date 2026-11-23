/** Coalesce notifications, but let a post-write caller await a read started after its request. */
export function createOverviewRefresh(read: (current: () => boolean) => Promise<void>) {
  let generation = 0;
  let running = Promise.resolve();
  let queued: Promise<void> | undefined;

  function refresh(): Promise<void> {
    if (queued) return queued;
    const version = generation;
    queued = running.then(async () => {
      if (version !== generation) return;
      queued = undefined;
      await read(() => version === generation);
    });
    // A failed read must not prevent the next notification or explicit retry.
    running = queued.catch(() => {});
    return queued;
  }

  function invalidate() {
    generation++;
    queued = undefined;
    running = Promise.resolve();
  }

  return { refresh, invalidate };
}
