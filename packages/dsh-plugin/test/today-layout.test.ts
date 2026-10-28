import { createElement } from "react";
import { type ReactTestRenderer, act, create } from "react-test-renderer";
import { expect, test, vi } from "vitest";
import { LifeHome } from "../src/client/TodayPage.js";

test.each([false, true])(
  "Today retains real empty/map states and capture actions (saved map: %s)",
  async (saved) => {
    const save = vi.fn();
    const ask = vi.fn();
    const openAtlas = vi.fn();
    const props = {
      home: { data: { threads: [], traces: [], pending: [] }, loading: false, error: null },
      data: {
        today: "2026-10-28",
        cutoff: "2026-10-28T12:00:00Z",
        timeZone: "UTC",
        metrics: [],
        proposedTasks: [],
        notes: [],
      },
      firstVisit: true,
      writing: false,
      capture: null,
      start: vi.fn(),
      library: vi.fn(),
      handover: vi.fn(),
      memory: vi.fn(),
      busy: false,
      save,
      ask,
      canAsk: true,
      askError: "",
      askText: "synthetic capture",
      setAskText: vi.fn(),
      insertSpeech: vi.fn(),
      loadAtlas: async () => ({
        resource: saved
          ? {
              svg: '<svg width="800" height="500"></svg>',
              width: 800,
              height: 500,
              regions: { provinces: [] },
            }
          : null,
        domains: [],
      }),
      openAtlas,
      adopt: vi.fn(),
      dismiss: vi.fn(),
      loadProjects: async () => [],
      openProject: vi.fn(),
      loadLibrary: async () => ({ inbox: [] }),
    } as unknown as Parameters<typeof LifeHome>[0];
    let app!: ReactTestRenderer;
    await act(async () => {
      app = create(createElement(LifeHome, props));
    });
    try {
      expect(app.root.findAllByType("svg")).toHaveLength(saved ? 1 : 0);
      if (saved) expect(app.root.findByType("svg").props.viewBox).toBe("0 0 800 500");
      const buttons = app.root.findAllByType("button");
      await act(async () => buttons.find((button) => button.children.includes("人生地图"))?.props.onClick());
      expect(openAtlas).toHaveBeenCalledOnce();
      await act(async () => buttons.find((button) => button.children.includes("记下"))?.props.onClick());
      expect(save).toHaveBeenCalledWith("synthetic capture");
      await act(async () => app.root.findByType("form").props.onSubmit({ preventDefault() {} }));
      expect(ask).toHaveBeenCalledWith("synthetic capture");
      expect(app.root.findAllByType("article")).toHaveLength(0);
    } finally {
      await act(async () => app.unmount());
    }
  },
);
