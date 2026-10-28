import { createElement } from "react";
import { act, create } from "react-test-renderer";
import { afterEach, expect, test, vi } from "vitest";
import { AskPage } from "../src/client/AskPage.js";

afterEach(() => vi.unstubAllGlobals());

test("keeps separate unsent drafts for the new conversation and an existing conversation", async () => {
  const settings = {
    configured: true,
    choice: "builtin",
    provider: "example",
    providerName: "Example",
    model: "model",
    protocols: [],
    providers: [],
    localAgents: [],
  };
  const row = {
    id: "session-example",
    title: "Existing",
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
  };
  vi.stubGlobal("fetch", async (url: string) => {
    const method = url.split("/").at(-1);
    const values: Record<string, unknown> = {
      askSettings: settings,
      askList: [row],
      overview: { projects: [], allNext: [], notes: [] },
      automation: { asked: true, tasks: {} },
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
  let app!: ReturnType<typeof create>;
  await act(async () => {
    app = create(createElement(AskPage, { workspace: "synthetic" }));
  });
  const input = () => app.root.findByType("textarea");
  const type = async (value: string) =>
    act(async () => input().props.onChange({ target: { value, selectionStart: value.length } }));
  const click = async (label: string) =>
    act(async () => {
      const button = app.root.findAllByType("button").find((item) => item.children.includes(label));
      expect(button).toBeDefined();
      button?.props.onClick();
    });
  await type("new draft");
  await click("Existing");
  expect(input().props.value).toBe("");
  await type("existing draft");
  await click("＋ 新对话");
  expect(input().props.value).toBe("new draft");
  await click("Existing");
  expect(input().props.value).toBe("existing draft");
  await act(async () => app.unmount());
});

test("a saved handoff sends once without replacing a pre-existing new-conversation draft", async () => {
  const requests: { method: string; args: unknown[] }[] = [];
  const settings = {
    configured: true,
    choice: "builtin",
    provider: "example",
    providerName: "Example",
    model: "model",
    protocols: [],
    providers: [],
    localAgents: [],
  };
  const row = {
    id: "session-handoff",
    title: "Handoff",
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
    handoff: { requestId: "capture-operation-1", phase: "ready" },
  };
  vi.stubGlobal("fetch", async (url: string, init: { body: string }) => {
    const method = url.split("/").at(-1) ?? "";
    const args = JSON.parse(init.body) as unknown[];
    requests.push({ method, args });
    const values: Record<string, unknown> = {
      askSettings: settings,
      askList: [row],
      askCreate: row,
      askSend: {},
      overview: { projects: [], allNext: [], notes: [] },
      automation: { asked: true, tasks: {} },
    };
    return { ok: true, json: async () => values[method] ?? {} };
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
  let app!: ReturnType<typeof create>;
  await act(async () => {
    app = create(createElement(AskPage, { workspace: "synthetic" }));
  });
  await act(async () =>
    app.root.findByType("textarea").props.onChange({ target: { value: "unsent", selectionStart: 6 } }),
  );
  const handoff = {
    requestId: "capture-operation-1",
    text: "synthetic question",
    references: ["projects/demo/STATUS.md"],
    capturedPath: "inbox/synthetic.md",
  };
  await act(async () => {
    app.update(createElement(AskPage, { workspace: "synthetic", autoSubmit: handoff }));
  });
  expect(requests.filter((item) => item.method === "askSend")).toHaveLength(1);
  expect(requests.find((item) => item.method === "askSend")?.args[3]).toBe(handoff.requestId);
  await act(async () => {
    app.update(createElement(AskPage, { workspace: "synthetic", autoSubmit: { ...handoff } }));
  });
  expect(requests.filter((item) => item.method === "askSend")).toHaveLength(1);
  await act(async () =>
    app.root
      .findAllByType("button")
      .find((item) => item.children.includes("＋ 新对话"))
      ?.props.onClick(),
  );
  expect(app.root.findByType("textarea").props.value).toBe("unsent");
  await act(async () => app.unmount());
});
