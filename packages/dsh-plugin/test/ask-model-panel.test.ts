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
