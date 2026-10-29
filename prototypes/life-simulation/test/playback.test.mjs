import assert from "node:assert/strict";
import { test } from "node:test";
import { createYearTimer } from "../dist/playback.js";

test("year clock waits at each speed, stops for decisions/details/hidden tabs, and never catches up", () => {
  let now = 0;
  let id = 0;
  let years = 0;
  let running = true;
  let pendingChoice = false;
  let hidden = false;
  let speed = 1;
  const tasks = new Map();
  const driver = {
    set(callback, delay) {
      const handle = ++id;
      tasks.set(handle, { callback, due: now + delay });
      return handle;
    },
    clear(handle) {
      tasks.delete(handle);
    },
  };
  const clock = createYearTimer(
    () => running && !pendingChoice && !hidden,
    () => {
      years++;
      clock.schedule(speed);
    },
    driver,
  );
  const tick = (ms) => {
    now += ms;
    for (const [handle, task] of [...tasks])
      if (task.due <= now) {
        tasks.delete(handle);
        task.callback();
      }
  };
  clock.schedule(speed);
  tick(44999);
  assert.equal(years, 0);
  tick(1);
  assert.equal(years, 1);
  // A blocked main thread returning five minutes late processes one year, never a burst.
  tick(300000);
  assert.equal(years, 2);
  tick(44999);
  assert.equal(years, 2);
  tick(1);
  assert.equal(years, 3);
  const staleCallback = [...tasks.values()][0].callback;
  running = false;
  clock.stop();
  staleCallback();
  tick(300000);
  assert.equal(years, 3);
  assert.equal(tasks.size, 0);
  running = true;
  speed = 2;
  clock.schedule(speed);
  assert.equal(years, 3); // Continue starts a timer, not an immediate year.
  tick(22499);
  assert.equal(years, 3);
  tick(1);
  assert.equal(years, 4);
  pendingChoice = true;
  clock.schedule(speed);
  tick(300000);
  assert.equal(years, 4);
  assert.equal(tasks.size, 0);
  pendingChoice = false;
  speed = 4;
  clock.schedule(speed);
  tick(11249);
  assert.equal(years, 4);
  tick(1);
  assert.equal(years, 5);
  hidden = true;
  clock.stop();
  tick(300000);
  hidden = false;
  tick(300000);
  assert.equal(years, 5);
  clock.schedule(speed);
  tick(11250);
  assert.equal(years, 6);
  clock.stop();
});

test("default timer driver retains the host receiver when scheduling and cancelling", (context) => {
  const delays = [];
  const cancelled = [];
  context.mock.method(globalThis, "setTimeout", function (_callback, delay) {
    assert.equal(this, globalThis, "browser timers reject a driver object as this");
    delays.push(delay);
    return 42;
  });
  context.mock.method(globalThis, "clearTimeout", function (handle) {
    assert.equal(this, globalThis, "clearTimeout must also retain the host receiver");
    cancelled.push(handle);
  });
  const clock = createYearTimer(
    () => true,
    () => assert.fail("Cancelled timer fired"),
  );
  clock.schedule(2);
  clock.stop();
  assert.deepEqual(delays, [22500]);
  assert.deepEqual(cancelled, [42]);
});
