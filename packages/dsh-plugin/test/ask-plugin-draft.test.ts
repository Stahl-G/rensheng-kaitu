import { createElement } from "react";
import { type ReactTestRenderer, act, create } from "react-test-renderer";
import { afterEach, expect, test, vi } from "vitest";
import { AskPage } from "../src/client/AskPage.js";

afterEach(() => vi.unstubAllGlobals());

test("plugin draft leaves the old session and sends only to a newly created session", async () => {
  const requests: { method: string; args: unknown[] }[] = [];
  vi.stubGlobal("fetch", async (url: string, init: { body: string }) => {
    const method = url.split("/").at(-1) ?? "";
    const args = JSON.parse(init.body) as unknown[];
    requests.push({ method, args });
    const values: Record<string, unknown> = {
      askSettings: {
        configured: true,
        choice: "builtin",
        provider: "synthetic",
        providerName: "Synthetic",
        model: "fixture",
        protocols: [],
        providers: [],
      },
      askList: [{ id: "old-session", title: "旧会话", created: "2026-10-26", updated: "2026-10-26" }],
      askCreate: { id: "new-session", title: "新对话", created: "2026-10-28", updated: "2026-10-28" },
      overview: { projects: [], allNext: [], notes: [] },
      automation: { asked: true, tasks: {} },
    };
    return { ok: true, json: async () => values[method] ?? {} };
  });
  vi.stubGlobal("window", { addEventListener: vi.fn(), removeEventListener: vi.fn() });
  vi.stubGlobal("addEventListener", vi.fn());
  vi.stubGlobal("removeEventListener", vi.fn());
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.stubGlobal(
    "EventSource",
    class {
      close() {}
    },
  );
  let root: ReactTestRenderer | undefined;
  try {
    await act(async () => {
      root = create(createElement(AskPage, { workspace: "synthetic" }));
    });
    const page = root?.root;
    if (!page) throw new Error("Ask did not render");
    const old = page.findAllByType("button").find((button) => button.children.includes("旧会话"));
    if (!old) throw new Error("Old session missing");
    await act(async () => {
      old.props.onClick();
    });
    expect(old.props["aria-current"]).toBe("true");
    await act(async () => {
      root?.update(
        createElement(AskPage, {
          workspace: "synthetic",
          initialPrompt: "合成资料草稿",
          initialPromptRequest: 1,
          initialPromptNewConversation: true,
        }),
      );
    });
    expect(old.props["aria-current"]).toBeUndefined();
    expect(requests.some((item) => item.method === "askCreate" || item.method === "askSend")).toBe(false);
    const send = page.findAllByType("button").find((button) => button.props["aria-label"] === "发送");
    if (!send) throw new Error("Send button missing");
    const form = page.findAllByType("form").find((item) => item.props.onSubmit);
    if (!form) throw new Error("Composer form missing");
    await act(async () => {
      form.props.onSubmit({ preventDefault() {} });
    });
    expect(requests.find((item) => item.method === "askSend")?.args).toEqual([
      "new-session",
      "合成资料草稿",
      [],
    ]);
    expect(requests.filter((item) => item.method === "askCreate")).toHaveLength(1);
  } finally {
    if (root) act(() => root?.unmount());
  }
});
