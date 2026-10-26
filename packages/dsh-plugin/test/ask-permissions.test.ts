import { createElement } from "react";
import { type ReactTestRenderer, act, create } from "react-test-renderer";
import { afterEach, expect, test, vi } from "vitest";
import { AskPage } from "../src/client/AskPage.js";

afterEach(() => vi.unstubAllGlobals());
test("native modes remain explicit and resolved approvals share collapsed steps", async () => {
  const settings = {
    configured: true,
    choice: "local",
    fullOnly: true,
    provider: "codebuddy",
    providerName: "CodeBuddy",
    model: "默认模型",
    localAgent: { id: "codebuddy", path: "/synthetic/cli" },
  };
  const requests: { method: string; args: unknown[] }[] = [];
  vi.stubGlobal("fetch", async (url: string, init: { body: string }) => {
    const method = url.split("/").at(-1) as string;
    const args = JSON.parse(init.body);
    requests.push({ method, args });
    const values: Record<string, unknown> = {
      askSettings: settings,
      askList: [{ id: "s1", title: "synthetic", created: "2026-10-26", updated: "2026-10-26" }],
      overview: { projects: [], allNext: [], notes: [] },
      automation: { asked: true, tasks: {} },
      askModels: [],
      askSupport: {
        modes: [
          { id: "default", name: "Ask" },
          { id: "auto", name: "Auto" },
        ],
      },
      askConfigure: { ...settings, ...args[0] },
    };
    return { ok: true, json: async () => values[method] ?? {} };
  });
  vi.stubGlobal("window", { addEventListener: vi.fn(), removeEventListener: vi.fn() });
  vi.stubGlobal("addEventListener", vi.fn());
  vi.stubGlobal("removeEventListener", vi.fn());
  let stream!: { onmessage: (message: { data: string }) => void };
  vi.stubGlobal(
    "EventSource",
    class {
      onmessage!: typeof stream.onmessage;
      close() {}
      constructor() {
        stream = this;
      }
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
        .find((x) => x.props["aria-haspopup"] === "dialog")
        ?.props.onClick();
    });
    expect(root.root.findAllByType("button").some((x) => x.children.includes("Auto · 自动审查"))).toBe(true);
    expect(JSON.stringify(root.toJSON())).not.toContain("bypassPermissions");
    await act(async () => {
      root.root
        .findAllByType("button")
        .find((x) => x.children.includes("Auto · 自动审查"))
        ?.props.onClick();
    });
    expect(requests.find((x) => x.method === "askConfigure")?.args[0]).toMatchObject({
      permissionMode: "auto",
      agent: "codebuddy",
    });
    await act(async () => {
      root.root
        .findAllByType("button")
        .find((x) => x.children.includes("synthetic"))
        ?.props.onClick();
    });
    const emit = (id: number, type: string, data: unknown) =>
      stream.onmessage({ data: JSON.stringify({ id, type, data }) });
    act(() => {
      emit(1, "user/message", { content: [{ type: "text", text: "synthetic" }] });
      emit(2, "tool/call", { callId: "t", name: "date", arguments: '{"command":"date"}' });
      emit(3, "approval/asked", {
        requestId: "a",
        reason: "Permission",
        detail: '{"command":"date"}',
        options: [{ kind: "allow_once", optionId: "once", name: "Allow once" }],
      });
      emit(4, "approval/resolved", { requestId: "a", status: "approved" });
    });
    const progress = root.root
      .findAllByType("details")
      .filter((x) => String(x.props.className).includes("progress"));
    expect(progress).toHaveLength(1);
    expect(progress[0].props.open).not.toBe(true);
    expect(progress[0].findAllByType("pre").some((x) => x.children.includes('{"command":"date"}'))).toBe(
      true,
    );
    expect(root.root.findAllByType("button").some((x) => x.children.includes("批准这一次"))).toBe(false);
    act(() =>
      emit(5, "approval/asked", {
        requestId: "pending",
        reason: "Risky operation",
        detail: "synthetic",
        options: [],
      }),
    );
    const reject = root.root.findAllByType("button").find((x) => x.children.includes("拒绝这一次"));
    expect(reject).toBeDefined();
    await act(async () => {
      await reject?.props.onClick();
    });
    expect(requests.filter((x) => x.method === "askPermission")).toEqual([
      { method: "askPermission", args: ["s1", "pending", null] },
    ]);
    act(() => {
      emit(6, "user/message", { content: [{ type: "text", text: "next synthetic turn" }] });
      emit(7, "tool/call", { callId: "widget", name: "openmaic_widget", arguments: "{}" });
      emit(8, "tool/result", {
        message: { toolCallId: "widget", content: [] },
        meta: { kind: "openmaic-widget", html: "<p>Synthetic</p>", title: "Widget", widgetType: "code" },
      });
      emit(9, "approval/asked", { requestId: "second", reason: "Second turn", detail: "{}", options: [] });
      emit(10, "approval/resolved", { requestId: "second", status: "rejected" });
    });
    const turns = root.root
      .findAllByType("details")
      .filter((x) => String(x.props.className).includes("progress"));
    expect(turns).toHaveLength(2);
    expect(turns[0].findAllByType("pre").some((x) => x.children.includes('{"command":"date"}'))).toBe(true);
    expect(turns[1].findAllByType("pre").some((x) => x.children.includes('{"command":"date"}'))).toBe(false);
    expect(turns[1].findAllByType("iframe")).toHaveLength(0);
    expect(root.root.findAllByType("iframe")).toHaveLength(1);
  } finally {
    if (root) act(() => root.unmount());
  }
});
