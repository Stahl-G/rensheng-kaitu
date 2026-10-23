import type { Context } from "@deepseek-ai/cordis";
import { afterEach, expect, it, vi } from "vitest";
import { registerExplorePluginRoute } from "../src/client/ExplorePluginRoute.js";

afterEach(() => vi.unstubAllGlobals());
it("notifies the parent after panel removal even when authentication cleared referrer", () => {
  const postMessage = vi.fn();
  let present = true;
  let changed = () => {};
  vi.stubGlobal("window", {
    parent: { postMessage },
    location: { hash: "#kaitu-page=synthetic-page&kaitu-embed=1" },
  });
  vi.stubGlobal("document", {
    referrer: "",
    documentElement: { classList: { add: vi.fn(), remove: vi.fn() } },
  });
  const ctx = {
    effect: (run: () => unknown) => run(),
    layout: { selectPanel: vi.fn() },
    slots: {
      entries: () => (present ? [{ options: { key: "synthetic-page" } }] : []),
      subscribe: (_name: string, callback: () => void) => {
        changed = callback;
        return () => {};
      },
    },
  } as unknown as Context;
  registerExplorePluginRoute(ctx);
  expect(postMessage).not.toHaveBeenCalled();
  expect(ctx.layout.selectPanel).toHaveBeenCalledWith("synthetic-page");
  present = false;
  changed();
  expect(postMessage).toHaveBeenCalledWith({ type: "kaitu:explore-removed" }, "*");
});
