import { createElement } from "react";
import { type ReactTestRenderer, act, create } from "react-test-renderer";
import { afterEach, expect, test, vi } from "vitest";
import { AiSettings } from "../src/client/AiSettings.js";
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

test("an already authorized ChatGPT account loads and selects an available model", async () => {
  const settings = {
    configured: false,
    provider: "chatgpt-siwc",
    providerName: "ChatGPT",
    model: "",
    auth: "dsh",
    protocols: [],
    providers: [{ id: "chatgpt-siwc", name: "ChatGPT", authMethods: [{ id: "oauth" }] }],
    localAgents: [],
  };
  setup(async (name) => response(name === "siwc/status" ? connected : settings));
  const calls: string[] = [];
  vi.stubGlobal("fetch", (url: string, init: { body: string }) => {
    const method = url.split("/").at(-1) as string;
    calls.push(method);
    if (method === "askModels") return Promise.resolve(response([{ id: "synthetic-model" }]));
    if (method === "askSupport" && JSON.parse(init.body)[0] === "siwc/status")
      return Promise.resolve(response(connected));
    return Promise.resolve(response(settings));
  });
  let root!: ReactTestRenderer;
  try {
    await act(async () => {
      root = create(createElement(AiSettings, { onSaved: async () => {} }));
    });
    expect(calls.filter((method) => method === "askModels")).toHaveLength(1);
    expect(root.root.findByProps({ "aria-label": "模型" }).props.value).toBe("synthetic-model");
    expect(root.root.findAllByType("dialog")).toHaveLength(0);
  } finally {
    if (root) act(() => root.unmount());
  }
});

test("local agent settings do not present an installed agent as the active ChatGPT connection", async () => {
  const settings = {
    configured: true,
    choice: "builtin",
    provider: "chatgpt-siwc",
    providerName: "ChatGPT 计划",
    model: "synthetic-model",
    protocols: [],
    providers: [],
    localAgents: [{ id: "codebuddy", name: "CodeBuddy", path: "/synthetic/codebuddy" }],
    localAgent: { id: "codebuddy", name: "CodeBuddy" },
  };
  setup(async () => response(settings));
  let root!: ReactTestRenderer;
  try {
    await act(async () => {
      root = create(createElement(AiSettings, { localOnly: true, onSaved: async () => {} }));
    });
    expect(root.root.findByProps({ "aria-label": "Agent" }).props.value).toBe("");
    expect(button(root, "测试连接")?.props.disabled).toBe(true);
    expect(JSON.stringify(root.toJSON())).toContain("当前连接：ChatGPT 计划 · synthetic-model");
  } finally {
    if (root) act(() => root.unmount());
  }
});

test("official sign-in, manual setup and ACP are separate choices", async () => {
  const settings = {
    configured: false,
    choice: "builtin",
    provider: "chatgpt-siwc",
    providerName: "ChatGPT",
    model: "",
    auth: "dsh",
    protocols: [{ id: "openai", name: "OpenAI" }],
    providers: [
      { id: "chatgpt-siwc", name: "ChatGPT", authMethods: [{ id: "oauth" }] },
      { id: "deepseek-official", name: "DeepSeek", recommended: true },
    ],
    localAgents: [{ id: "codebuddy", name: "CodeBuddy", path: "/synthetic/codebuddy" }],
  };
  setup(async () => response(settings));
  vi.stubGlobal("fetch", (url: string, init: { body: string }) => {
    const method = url.split("/").at(-1);
    if (method === "askModels") return Promise.resolve(response([{ id: "synthetic-model" }]));
    if (method === "askSupport" && JSON.parse(init.body)[0] === "siwc/status")
      return Promise.resolve(response(connected));
    return Promise.resolve(response(settings));
  });
  let root!: ReactTestRenderer;
  try {
    await act(async () => {
      root = create(createElement(AiSettings, { onSaved: async () => {} }));
    });
    const choices = root.root.findAllByType("input").filter((node) => node.props.name === "ai-choice");
    expect(choices).toHaveLength(3);
    expect(choices[0]?.props.checked).toBe(true);
    await act(async () => choices[1]?.props.onChange());
    expect(root.root.findByProps({ "aria-label": "AI 服务" }).props.value).toBe("deepseek-official");
    await act(async () => choices[2]?.props.onChange());
    expect(root.root.findByProps({ "aria-label": "Agent" }).props.value).toBe("");
  } finally {
    if (root) act(() => root.unmount());
  }
});

test("initial status shows progress; a startup failure offers retry and recovery enables sign-in", async () => {
  let finish!: (value: unknown) => void;
  const actions: string[] = [];
  setup(async (name) => {
    actions.push(name);
    if (actions.length === 1)
      return new Promise((resolve) => {
        finish = resolve;
      });
    return response(name === "siwc/beginSignIn" ? signingIn : disconnected);
  });
  let root!: ReactTestRenderer;
  try {
    await act(async () => {
      root = create(createElement(ChatGptConnection, { onAuthorized: vi.fn() }));
    });
    expect(root.root.findByType("output").children).toContain("正在检查 ChatGPT 连接…");
    expect(button(root, "Continue with ChatGPT")?.props.disabled).toBe(true);
    await act(async () => {
      finish({ ok: false, json: async () => ({ error: "synthetic startup failure" }) });
    });
    expect(root.root.findByProps({ role: "alert" }).children).toContain("synthetic startup failure");
    expect(root.root.findAllByType("output")).toHaveLength(0);
    expect(button(root, "重试")?.props.disabled).toBe(false);
    await act(async () => {
      await button(root, "重试")?.props.onClick();
    });
    expect(button(root, "Continue with ChatGPT")?.props.disabled).toBe(false);
    await act(async () => {
      await button(root, "Continue with ChatGPT")?.props.onClick();
    });
    expect(actions).toEqual(["siwc/status", "siwc/status", "siwc/beginSignIn"]);
    expect(button(root, "取消登录")).toBeDefined();
  } finally {
    if (root) act(() => root.unmount());
  }
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
