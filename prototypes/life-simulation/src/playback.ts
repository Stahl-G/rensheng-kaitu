export function yearDuration(speed: number): number {
  if (![1, 2, 4].includes(speed)) throw new Error("Invalid playback speed");
  return 45000 / speed;
}
interface TimerDriver {
  set: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
  clear: (handle: ReturnType<typeof setTimeout>) => void;
}
/** One pending year only. A delayed/background callback never catches up elapsed years. */
export function createYearTimer(
  canAdvance: () => boolean,
  advance: () => void,
  driver: TimerDriver = {
    // Browser timer methods require the Window receiver; never alias them onto the driver.
    set: (callback, delay) => globalThis.setTimeout(callback, delay),
    clear: (handle) => globalThis.clearTimeout(handle),
  },
) {
  let handle: ReturnType<typeof setTimeout> | undefined;
  let generation = 0;
  function stop() {
    generation++;
    if (handle !== undefined) driver.clear(handle);
    handle = undefined;
  }
  function schedule(speed: number) {
    stop();
    if (!canAdvance()) return;
    const current = generation;
    handle = driver.set(() => {
      if (generation !== current) return;
      handle = undefined;
      if (canAdvance()) advance();
    }, yearDuration(speed));
  }
  return { stop, schedule };
}
