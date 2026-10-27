import { createElement } from "react";
import { type ReactTestRenderer, act, create } from "react-test-renderer";
import { afterEach, expect, test, vi } from "vitest";
import { ChatGptConnection } from "../src/client/ChatGptConnection.js";

const disconnected = { authenticated: false, planEnabled: false, signingIn: false };
const signingIn = { ...disconnected, signingIn: true };
const connected = { authenticated: true, planEnabled: true, signingIn: false };
const response = (value: unknown) => ({ ok: true, json: async () => value });
function setup(fetcher: (action: string, signal: AbortSignal) => Promise<unknown>) {
  vi.useFakeTimers();
  vi.stubGlobal("localStorage", { getItem: () => "1", setItem: vi.fn() });
  vi.stubGlobal("window", { dispatchEvent: vi.fn() });
  vi.stubGlobal("fetch", (_url: string, init: { body: string; signal: AbortSignal }) =>
    fetcher(JSON.parse(init.body)[0], init.signal),
  );
}
function button(root: ReactTestRenderer, label: string) {
  return root.root
    .findAllByType("button")
    .find((node) => node.children.some((child) => typeof child === "string" && child.includes(label)));
}
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test.each(["network", "http", "json"])(
  "OAuth polling recovers from one %s error, clears it, and completes once",
  async (failure) => {
    let polls = 0;
    let started = false;
    const authorized = vi.fn();
    setup(async (name) => {
      if (name === "siwc/beginSignIn") {
        started = true;
        return response(signingIn);
      }
      if (!started) return response(disconnected);
      if (++polls === 1) {
        if (failure === "http") return { ok: false, json: async () => ({ error: "temporary failure" }) };
        if (failure === "json")
          return {
            ok: true,
            json: async () => {
              throw Error("temporary failure");
            },
          };
        throw Error("temporary failure");
      }
      return response(connected);
    });
    let root!: ReactTestRenderer;
    try {
      await act(async () => {
        root = create(createElement(ChatGptConnection, { onAuthorized: authorized }));
      });
      await act(async () => {
        await button(root, "Continue with ChatGPT")?.props.onClick();
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
      expect(root.root.findByProps({ role: "alert" }).children).toContain("temporary failure");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
      expect(polls).toBe(2);
      expect(authorized).toHaveBeenCalledTimes(1);
      expect(root.root.findAllByProps({ role: "alert" })).toHaveLength(0);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60000);
      });
      expect(polls).toBe(2);
    } finally {
      if (root) act(() => root.unmount());
    }
  },
);

test("a hanging status request times out; cancel and unmount abort requests and discard late responses from an old attempt", async () => {
  let started = false;
  let polls = 0;
  const aborted: number[] = [];
  let late!: (value: unknown) => void;
  const authorized = vi.fn();
  setup(async (name, signal) => {
    if (name === "siwc/beginSignIn") {
      started = true;
      return response(signingIn);
    }
    if (name === "siwc/cancelSignIn") {
      started = false;
      return response(disconnected);
    }
    if (!started) return response(disconnected);
    const poll = ++polls;
    return new Promise((resolve, reject) => {
      late = resolve;
      signal.addEventListener(
        "abort",
        () => {
          aborted.push(poll);
          if (poll !== 2) reject(signal.reason);
        },
        { once: true },
      );
    });
  });
  let root!: ReactTestRenderer;
  try {
    await act(async () => {
      root = create(createElement(ChatGptConnection, { onAuthorized: authorized }));
    });
    await act(async () => {
      await button(root, "Continue with ChatGPT")?.props.onClick();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(31000);
    });
    expect(aborted).toEqual([1]);
    expect(root.root.findAllByProps({ role: "alert" })).toHaveLength(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(polls).toBe(2);
    const oldResponse = late;
    await act(async () => {
      await button(root, "取消登录")?.props.onClick();
    });
    expect(aborted).toEqual([1, 2]);
    await act(async () => {
      await button(root, "Continue with ChatGPT")?.props.onClick();
    });
    await act(async () => {
      oldResponse(response(connected));
    });
    expect(authorized).not.toHaveBeenCalled();
    expect(button(root, "取消登录")).toBeDefined();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(polls).toBe(3);
    await act(async () => root.unmount());
    expect(aborted).toEqual([1, 2, 3]);
    expect(vi.getTimerCount()).toBe(0);
    await act(async () => {
      late(response(connected));
      await vi.advanceTimersByTimeAsync(60000);
    });
    expect(authorized).not.toHaveBeenCalled();
  } finally {
    if (root) act(() => root.unmount());
  }
});

test("persistent failures retry with a delay capped at ten seconds and cleanup stops them", async () => {
  let started = false;
  const times: number[] = [];
  setup(async (name) => {
    if (name === "siwc/beginSignIn") {
      started = true;
      return response(signingIn);
    }
    if (!started) return response(disconnected);
    times.push(Date.now());
    throw Error("offline");
  });
  let root!: ReactTestRenderer;
  try {
    await act(async () => {
      root = create(createElement(ChatGptConnection, { onAuthorized: vi.fn() }));
    });
    await act(async () => {
      await button(root, "Continue with ChatGPT")?.props.onClick();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(35000);
    });
    expect(times.slice(1).map((time, i) => time - (times[i] as number))).toEqual([
      2000, 4000, 8000, 10000, 10000,
    ]);
  } finally {
    if (root) act(() => root.unmount());
  }
  expect(vi.getTimerCount()).toBe(0);
});
