import { afterEach, expect, test, vi } from "vitest";
import { createEventSubscription } from "../src/standalone/event-source.js";

afterEach(() => vi.unstubAllGlobals());

test("subscribers share one stream, unsubscribe independently, and release the last connection", () => {
  const sources: Source[] = [];
  class Source extends EventTarget {
    close = vi.fn();
    constructor(public url: string) {
      super();
      sources.push(this);
    }
  }
  vi.stubGlobal("EventSource", Source);
  const subscribe = createEventSubscription("/api/events");
  const refresh = vi.fn();
  const offFirst = subscribe(refresh);
  const offSecond = subscribe(refresh);
  expect(sources).toHaveLength(1);
  sources[0]?.dispatchEvent(new Event("message"));
  expect(refresh).toHaveBeenCalledTimes(2);
  offFirst();
  expect(sources[0]?.close).not.toHaveBeenCalled();
  sources[0]?.dispatchEvent(new Event("message"));
  expect(refresh).toHaveBeenCalledTimes(3);
  offSecond();
  expect(sources[0]?.close).toHaveBeenCalledOnce();
  const offNext = subscribe(refresh);
  expect(sources).toHaveLength(2);
  offNext();
  expect(sources[1]?.close).toHaveBeenCalledOnce();
});
