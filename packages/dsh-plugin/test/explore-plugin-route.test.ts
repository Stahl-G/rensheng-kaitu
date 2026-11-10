import type { Context } from "@deepseek-ai/cordis";
import { afterEach, expect, test, vi } from "vitest";
import { registerExplorePluginRoute } from "../src/client/ExplorePluginRoute.js";

afterEach(() => vi.unstubAllGlobals());

test("return switches only the panel, keeps the conversation and ignores untrusted messages", () => {
  const parent = { postMessage: vi.fn() };
  const listeners = new Set<(event: MessageEvent) => void>();
  const updates = new Set<() => void>();
  const registry = new Set<() => void>();
  let activePanelId: string | null = null;
  let cleanup: (() => void) | undefined;
  const selectPanel = vi.fn((id: string | null) => {
    activePanelId = id;
    for (const update of updates) update();
  });
  vi.stubGlobal("window", {
    parent,
    location: { hash: "#kaitu-embed=1&kaitu-page=synthetic&kaitu-parent=http%3A%2F%2F127.0.0.1%3A4870" },
    addEventListener: (_: string, fn: (event: MessageEvent) => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: (event: MessageEvent) => void) => listeners.delete(fn),
  });
  vi.stubGlobal("document", { documentElement: { classList: { add: vi.fn(), remove: vi.fn() } } });
  registerExplorePluginRoute({
    effect: (effect: () => () => void) => {
      cleanup = effect();
    },
    layout: {
      selectPanel,
      panelInfo: {
        getSnapshot: () => ({ activePanelId }),
        subscribe: (fn: () => void) => {
          updates.add(fn);
          return () => updates.delete(fn);
        },
      },
    },
    slots: {
      entries: () => [{ options: { key: "synthetic" } }],
      subscribe: (_: string, fn: () => void) => {
        registry.add(fn);
        return () => registry.delete(fn);
      },
    },
  } as unknown as Context);
  const deliver = (type: string, source = parent, origin = "http://127.0.0.1:4870") => {
    for (const receive of listeners) receive({ source, origin, data: { type } } as MessageEvent);
  };
  expect(activePanelId).toBe("synthetic");
  deliver("kaitu:explore-conversation");
  expect(activePanelId).toBe("synthetic");
  selectPanel(null); // uiWorkspace.openSession has selected a native session.
  for (const changed of registry) changed();
  expect(activePanelId).toBeNull(); // Unrelated plugin registration must not steal navigation.
  deliver("kaitu:explore-return", { postMessage: vi.fn() });
  deliver("kaitu:explore-return", parent, "http://127.0.0.1:9999");
  expect(activePanelId).toBeNull();
  deliver("kaitu:explore-return");
  expect(activePanelId).toBe("synthetic");
  deliver("kaitu:explore-conversation");
  expect(activePanelId).toBeNull();
  expect(parent.postMessage).toHaveBeenLastCalledWith(
    { type: "kaitu:explore-navigation", conversation: true, hasConversation: true },
    "http://127.0.0.1:4870",
  );
  cleanup?.();
  expect(listeners.size).toBe(0);
  expect(updates.size).toBe(0);
});
