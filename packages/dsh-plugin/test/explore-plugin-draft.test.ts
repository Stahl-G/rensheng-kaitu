import { createElement } from "react";
import { type ReactTestRenderer, act, create } from "react-test-renderer";
import { afterEach, expect, test, vi } from "vitest";
import { ExplorePluginFrame } from "../src/client/ExplorePluginFrame.js";

afterEach(() => vi.unstubAllGlobals());
test("a delayed plugin draft cannot navigate from another page and can be retried", async () => {
  const listeners = new Set<(event: MessageEvent) => void>();
  const child = { postMessage: vi.fn() };
  const onDraft = vi.fn(() => true);
  const plugins = vi.fn(async () => "http://127.0.0.1:34567/#kaitu-embed=1");
  const onRemoved = vi.fn();
  vi.stubGlobal("window", {
    addEventListener: (_type: string, fn: (event: MessageEvent) => void) => listeners.add(fn),
    removeEventListener: (_type: string, fn: (event: MessageEvent) => void) => listeners.delete(fn),
  });
  const props = { id: "plugin:synthetic", title: "合成插件", plugins, onRemoved, onDraft };
  let root: ReactTestRenderer | undefined;
  try {
    await act(async () => {
      root = create(createElement(ExplorePluginFrame, { ...props, active: true }), {
        createNodeMock: (element) => (element.type === "iframe" ? { contentWindow: child } : null),
      });
    });
    let finishMaterials: () => void = () => {};
    const materials = new Promise<void>((resolve) => {
      finishMaterials = resolve;
    });
    // The user switched pages before the delayed material request completed.
    await act(async () => {
      root?.update(createElement(ExplorePluginFrame, { ...props, active: false }));
    });
    const data = {
      type: "kaitu:open-ask-draft",
      id: "11111111-1111-4111-8111-111111111111",
      draft: "合成草稿",
    };
    const deliver = () => {
      for (const listener of [...listeners])
        listener({ origin: "http://127.0.0.1:34567", source: child, data } as unknown as MessageEvent);
    };
    await act(async () => {
      finishMaterials();
      await materials;
      deliver();
    });
    expect(onDraft).not.toHaveBeenCalled();
    expect(child.postMessage).toHaveBeenLastCalledWith(
      { type: "kaitu:open-ask-draft-result", id: data.id, accepted: false, reason: "inactive" },
      "http://127.0.0.1:34567",
    );
    await act(async () => {
      root?.update(createElement(ExplorePluginFrame, { ...props, active: true }));
    });
    act(deliver);
    act(deliver);
    expect(onDraft).toHaveBeenCalledTimes(1);
    expect(onDraft).toHaveBeenCalledWith("合成草稿");
    expect(child.postMessage).toHaveBeenLastCalledWith(
      { type: "kaitu:open-ask-draft-result", id: data.id, accepted: true },
      "http://127.0.0.1:34567",
    );
  } finally {
    if (root) act(() => root?.unmount());
  }
});

test("embedded conversation can return to its plugin and resume without reloading", async () => {
  const listeners = new Set<(event: MessageEvent) => void>();
  const child = { postMessage: vi.fn() };
  vi.stubGlobal("window", {
    addEventListener: (_type: string, fn: (event: MessageEvent) => void) => listeners.add(fn),
    removeEventListener: (_type: string, fn: (event: MessageEvent) => void) => listeners.delete(fn),
  });
  const props = {
    id: "plugin:synthetic",
    title: "合成插件",
    active: true,
    plugins: vi.fn(async () => "http://127.0.0.1:34567/#kaitu-embed=1"),
    onRemoved: vi.fn(),
    onDraft: vi.fn(() => true),
  };
  let root!: ReactTestRenderer;
  await act(async () => {
    root = create(createElement(ExplorePluginFrame, props), {
      createNodeMock: (element) => (element.type === "iframe" ? { contentWindow: child } : null),
    });
  });
  const frame = root.root.findByType("iframe");
  const deliver = (source: object, conversation: boolean) => {
    for (const listener of [...listeners])
      listener({
        origin: "http://127.0.0.1:34567",
        source,
        data: { type: "kaitu:explore-navigation", conversation, hasConversation: true },
      } as MessageEvent);
  };
  try {
    act(() => deliver({}, true));
    expect(root.root.findAllByType("nav")).toHaveLength(0);
    act(() => deliver(child, true));
    act(() => root.root.findByType("button").props.onClick());
    expect(child.postMessage).toHaveBeenLastCalledWith(
      { type: "kaitu:explore-return" },
      "http://127.0.0.1:34567",
    );
    act(() => deliver(child, false));
    act(() => root.root.findByType("button").props.onClick());
    expect(child.postMessage).toHaveBeenLastCalledWith(
      { type: "kaitu:explore-conversation" },
      "http://127.0.0.1:34567",
    );
    expect(root.root.findByType("iframe")).toBe(frame);
    expect(props.plugins).toHaveBeenCalledTimes(1);
  } finally {
    act(() => root.unmount());
  }
});
