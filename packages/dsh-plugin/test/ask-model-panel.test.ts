import { createElement } from "react";
import { type ReactTestRenderer, act, create } from "react-test-renderer";
import { afterEach, expect, test, vi } from "vitest";
import { AskPage } from "../src/client/AskPage.js";

afterEach(() => vi.unstubAllGlobals());

test("model search chooses the matching provider and a failed switch keeps the old connection", async () => {
  const settings = {
    configured: true,
    choice: "builtin",
    provider: "first",
    providerName: "First",
    model: "shared",
    protocols: [],
    providers: [],
    localAgents: [],
  };
  const requests: unknown[] = [];
  vi.stubGlobal("fetch", async (url: string, init: { body: string }) => {
    const method = url.split("/").at(-1);
    const args = JSON.parse(init.body);
    if (method === "askConfigure") {
      requests.push(args[0]);
      return { ok: false, json: async () => ({ error: "synthetic failure" }) };
    }
    const values: Record<string, unknown> = {
      askSettings: settings,
      askList: [],
      overview: { projects: [], allNext: [], notes: [] },
      automation: { asked: true, tasks: {} },
      askSupport:
        args[0] === "builtinSettings"
          ? {
              ...settings,
              saved: [
                { provider: "first", name: "First", models: ["shared"] },
                { provider: "second", name: "Second", models: ["shared"], auth: "dsh" },
              ],
            }
          : { authenticated: false },
    };
    return { ok: true, json: async () => values[method ?? ""] ?? {} };
  });
  vi.stubGlobal("window", { addEventListener: vi.fn(), removeEventListener: vi.fn() });
  vi.stubGlobal("addEventListener", vi.fn());
  vi.stubGlobal("removeEventListener", vi.fn());
  vi.stubGlobal(
    "EventSource",
    class {
      close() {}
    },
  );
  let root!: ReactTestRenderer;
  try {
    await act(async () => {
      root = create(createElement(AskPage, { workspace: "synthetic" }));
    });
    await act(async () => {
      root.root
        .findAllByType("button")
        .find((x) => x.props["aria-label"] === "选择模型")
        ?.props.onClick();
    });
    await act(async () => {
      root.root
        .findAllByType("input")
        .find((x) => x.props.type === "search")
        ?.props.onChange({ target: { value: "Second" } });
    });
    const matches = root.root.findAllByType("button").filter((x) => x.children.includes("shared"));
    expect(matches).toHaveLength(1);
    await act(async () => {
      await matches[0]?.props.onClick();
    });
    expect(requests).toEqual([{ choice: "builtin", provider: "second", model: "shared", auth: "dsh" }]);
    expect(
      root.root
        .findAllByType("button")
        .find((x) => x.props["aria-label"] === "选择模型")
        ?.findAllByType("span")[0]
        ?.children.join(""),
    ).toContain("First");
  } finally {
    if (root) act(() => root.unmount());
  }
});

test("closing and reopening the picker discards an earlier model response", async () => {
  const settings = {
    configured: true,
    choice: "builtin",
    provider: "first",
    providerName: "First",
    model: "shared",
    protocols: [],
    providers: [],
    localAgents: [],
  };
  let resolveOld!: (value: unknown) => void;
  let loads = 0;
  vi.stubGlobal("fetch", async (url: string, init: { body: string }) => {
    const method = url.split("/").at(-1);
    const args = JSON.parse(init.body);
    let value: unknown = {};
    if (method === "askSettings") value = settings;
    else if (method === "askList") value = [];
    else if (method === "overview") value = { projects: [], allNext: [], notes: [] };
    else if (method === "automation") value = { asked: true, tasks: {} };
    else if (method === "askSupport" && args[0] === "builtinSettings") {
      loads++;
      value =
        loads === 1
          ? await new Promise((resolve) => {
              resolveOld = resolve;
            })
          : { ...settings, saved: [{ provider: "new", name: "New", models: ["new-model"] }] };
    } else if (method === "askSupport") value = { authenticated: false };
    return { ok: true, json: async () => value };
  });
  vi.stubGlobal("window", { addEventListener: vi.fn(), removeEventListener: vi.fn() });
  vi.stubGlobal("addEventListener", vi.fn());
  vi.stubGlobal("removeEventListener", vi.fn());
  vi.stubGlobal(
    "EventSource",
    class {
      close() {}
    },
  );
  let root!: ReactTestRenderer;
  try {
    await act(async () => {
      root = create(createElement(AskPage, { workspace: "synthetic" }));
    });
    const button = () => root.root.findAllByType("button").find((x) => x.props["aria-label"] === "选择模型");
    await act(async () => {
      button()?.props.onClick();
    });
    await act(async () => {
      button()?.props.onClick();
    });
    await act(async () => {
      button()?.props.onClick();
    });
    await act(async () => {
      resolveOld({ ...settings, saved: [{ provider: "old", name: "Old", models: ["old-model"] }] });
    });
    const labels = root.root
      .findAllByType("button")
      .flatMap((item) => item.children.filter((part) => typeof part === "string"));
    expect(labels).toContain("new-model");
    expect(labels).not.toContain("old-model");
  } finally {
    if (root) act(() => root.unmount());
  }
});

test("a delayed old catalog cannot attach its effort to a same-named model after switching", async () => {
  const first = {
    configured: true,
    choice: "builtin",
    provider: "first",
    providerName: "First",
    model: "shared",
    protocols: [],
    providers: [],
    localAgents: [],
  };
  const second = { ...first, provider: "second", providerName: "Second" };
  const firstCatalog = {
    ...first,
    saved: [{ provider: "second", name: "Second", models: ["shared"] }],
    modelCapabilities: [{ id: "shared", reasoning: { efforts: [{ id: "high", name: "High" }] } }],
  };
  let resolveOld!: (value: unknown) => void;
  let resolveSave!: (value: unknown) => void;
  let catalogLoads = 0;
  vi.stubGlobal("fetch", async (url: string, init: { body: string }) => {
    const method = url.split("/").at(-1);
    const args = JSON.parse(init.body);
    let value: unknown = {};
    if (method === "askSettings") value = first;
    else if (method === "askList") value = [];
    else if (method === "overview") value = { projects: [], allNext: [], notes: [] };
    else if (method === "automation") value = { asked: true, tasks: {} };
    else if (method === "askConfigure")
      value = await new Promise((resolve) => {
        resolveSave = resolve;
      });
    else if (method === "askSupport" && args[0] === "builtinSettings") {
      catalogLoads++;
      value =
        catalogLoads === 1
          ? firstCatalog
          : catalogLoads === 2
            ? await new Promise((resolve) => {
                resolveOld = resolve;
              })
            : second;
    } else if (method === "askSupport") value = { authenticated: false };
    return { ok: true, json: async () => value };
  });
  vi.stubGlobal("window", { addEventListener: vi.fn(), removeEventListener: vi.fn() });
  vi.stubGlobal("addEventListener", vi.fn());
  vi.stubGlobal("removeEventListener", vi.fn());
  vi.stubGlobal(
    "EventSource",
    class {
      close() {}
    },
  );
  let root!: ReactTestRenderer;
  try {
    await act(async () => {
      root = create(createElement(AskPage, { workspace: "synthetic" }));
    });
    const trigger = () => root.root.findAllByType("button").find((x) => x.props["aria-label"] === "选择模型");
    await act(async () => {
      trigger()?.props.onClick();
    });
    await act(async () => {
      trigger()?.props.onClick();
    });
    await act(async () => {
      trigger()?.props.onClick();
    });
    const model = root.root.findAllByType("button").find((x) => x.children.includes("shared"));
    expect(model).toBeDefined();
    act(() => {
      void model?.props.onClick();
    });
    expect(trigger()?.props.disabled).toBe(true);
    await act(async () => {
      resolveSave(second);
    });
    await act(async () => {
      resolveOld(firstCatalog);
    });
    await act(async () => {
      trigger()?.props.onClick();
    });
    expect(root.root.findAllByType("section").some((x) => x.props["aria-label"] === "推理强度")).toBe(false);
    expect(trigger()?.findAllByType("span")[0]?.children.join("")).toContain("Second");
  } finally {
    if (root) act(() => root.unmount());
  }
});
