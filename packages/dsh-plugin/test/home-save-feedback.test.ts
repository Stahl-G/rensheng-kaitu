import { rmSync } from "node:fs";
import { readCalendar, readHome, readHomeSources, readOverviewPage } from "@kaitu/core";
import { createElement } from "react";
import { act, create } from "react-test-renderer";
import { afterEach, expect, test, vi } from "vitest";
import { freshWorkspace } from "../../core/test/helpers.js";
import { AskPage } from "../src/client/AskPage.js";
import { OverviewPage, type OverviewPageProps } from "../src/client/OverviewPage.js";
import { LifeHome } from "../src/client/TodayPage.js";

vi.mock("../src/client/PaperMap.js", () => ({ PaperMap: () => null }));

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function browserGlobals() {
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("document", {
    body: { hasAttribute: () => false },
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    getElementById: () => null,
  });
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  vi.stubGlobal(
    "MutationObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
}

test("returning home confirms the previous save and keeps text edited while it was pending", async () => {
  browserGlobals();
  const ws = await freshWorkspace();
  const overview = await readOverviewPage(ws);
  const home = readHome(await readHomeSources(ws));
  let resolve!: (value: { status: string; path: string }) => void;
  const captureOnce = vi.fn(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const props = {
    hosted: true,
    loadPreferences: async () => ({ locale: "zh-CN", followSystem: false }),
    load: async () => overview,
    loadHome: async () => ({ data: home, presentation: overview, loading: false, error: null }),
    loadCalendar: async () => readCalendar(ws),
    loadMe: async () => ({}),
    loadOnboarding: async () => ({ showGuide: false }),
    loadCalendarPush: async () => ({}),
    loadProjects: async () => [],
    loadLibrary: async () => ({ inbox: [] }),
    renderAsk: () => null,
    captureOnce,
  } as unknown as OverviewPageProps;
  let app!: ReturnType<typeof create>;
  try {
    await act(async () => {
      app = create(createElement(OverviewPage, props));
    });
    vi.useFakeTimers();
    const current = () => app.root.findByType(LifeHome);
    await act(async () => current().props.setAskText("first entry"));
    await act(async () => current().props.save("first entry"));
    expect(current().props.askText).toBe("first entry");
    expect(current().props.saveStatus).toBe("正在记下…");
    await act(async () => current().props.setAskText("next unsaved entry"));
    const navigate = (name: string) => {
      const button = app.root
        .findAllByType("button")
        .find((button) => button.findAllByType("span").some((span) => span.children.includes(name)));
      if (!button) throw new Error("Navigation button missing");
      button.props.onClick();
    };
    await act(async () => navigate("问问"));
    expect(app.root.findAllByType(LifeHome)).toHaveLength(0);
    await act(async () => resolve({ status: "saved", path: "inbox/notes/2026-10-29/synthetic.md" }));
    await act(async () => vi.advanceTimersByTime(5000));
    await act(async () => navigate("今天"));
    expect(current().props.askText).toBe("next unsaved entry");
    expect(current().props.saveStatus).toBe("上一条已记下");
    expect(captureOnce).toHaveBeenCalledOnce();
    await act(async () => vi.advanceTimersByTime(3000));
    expect(current().props.saveStatus).toBe("");
  } finally {
    if (app) await act(async () => app.unmount());
    rmSync(ws.root, { recursive: true, force: true });
  }
});

test("the subscribed home projection renders while unrelated page reads are still pending", async () => {
  browserGlobals();
  const ws = await freshWorkspace();
  const sources = await readHomeSources(ws);
  const home = readHome(sources);
  const pending = () => new Promise<never>(() => {});
  let update: ((state: import("@kaitu/core").HomeState) => void) | undefined;
  const unsubscribe = vi.fn();
  const props = {
    hosted: true,
    loadPreferences: async () => ({ locale: "zh-CN", followSystem: false }),
    load: pending,
    loadCalendar: pending,
    loadMe: pending,
    loadOnboarding: pending,
    loadHome: async () => ({ data: home, presentation: sources.overview, loading: false, error: null }),
    subscribeHome: (listener: typeof update) => {
      update = listener;
      return unsubscribe;
    },
    renderAsk: () => null,
  } as unknown as OverviewPageProps;
  let app: ReturnType<typeof create> | undefined;
  try {
    await act(async () => {
      app = create(createElement(OverviewPage, props));
    });
    expect(app?.root.findByType(LifeHome).props.home.data).toEqual(home);
    const next = { ...home, pending: [{ id: "proposal", title: "New proposal" }] };
    await act(async () =>
      update?.({ data: next, presentation: sources.overview, loading: false, error: null }),
    );
    expect(app?.root.findByType(LifeHome).props.home.data.pending).toEqual(next.pending);
  } finally {
    if (app) await act(async () => app?.unmount());
    expect(unsubscribe).toHaveBeenCalledOnce();
    rmSync(ws.root, { recursive: true, force: true });
  }
});

test("home shows actual traces, hides empty traces and keeps genuine pending decisions", async () => {
  browserGlobals();
  const ws = await freshWorkspace();
  const sources = await readHomeSources(ws);
  const home = readHome(sources);
  const project = {
    key: "project:synthetic:words",
    date: home.today,
    kind: "project-metric" as const,
    label: "Synthetic project progress",
    value: 600,
    unit: "words",
    estimated: false,
    sourceFiles: ["projects/data/project_metric/2026-10.jsonl"],
  };
  const weight = {
    ...project,
    key: "metric:weight",
    kind: "metric" as const,
    label: "Synthetic body measurement",
    value: 71,
    unit: "kg",
    sourceFiles: ["health/data/metric/2026-10.jsonl"],
  };
  const pending = [{ id: "proposal", title: "Synthetic user decision" }];
  let update!: (state: import("@kaitu/core").HomeState) => void;
  const state = (traces: import("@kaitu/core").HomeTrace[], decisions = pending) => ({
    data: { ...home, traces, pending: decisions },
    presentation: sources.overview,
    loading: false,
    error: null,
  });
  const props = {
    hosted: true,
    loadPreferences: async () => ({ locale: "zh-CN", followSystem: false }),
    load: async () => sources.overview,
    loadHome: async () => state([project, weight]),
    subscribeHome: (listener: typeof update) => {
      update = listener;
      return () => {};
    },
    loadCalendar: async () => readCalendar(ws),
    loadMe: async () => ({}),
    loadOnboarding: async () => ({ showGuide: false }),
    loadCalendarPush: async () => ({}),
    loadProjects: async () => [],
    loadLibrary: async () => ({ inbox: [] }),
    renderAsk: () => null,
  } as unknown as OverviewPageProps;
  let app: ReturnType<typeof create> | undefined;
  try {
    await act(async () => {
      app = create(createElement(OverviewPage, props));
    });
    const content = () => JSON.stringify(app?.toJSON());
    expect(content()).toContain(project.label);
    expect(content()).toContain(weight.label);
    expect(content()).toContain(pending[0]?.title);
    await act(async () => update(state([])));
    expect(app?.root.findAllByType("ol")).toHaveLength(0);
    expect(content()).toContain(pending[0]?.title);
    await act(async () => update(state([], [])));
    expect(app?.root.findAllByType("aside")).toHaveLength(0);
    expect(app?.root.findAllByProps({ "data-has-side": false })).toHaveLength(1);
  } finally {
    if (app) await act(async () => app?.unmount());
    rmSync(ws.root, { recursive: true, force: true });
  }
});

test("contextual Ask keeps Today and the same conversation mounted across close and expand", async () => {
  browserGlobals();
  const ws = await freshWorkspace();
  const sources = await readHomeSources(ws);
  const requests: string[] = [];
  vi.stubGlobal("fetch", async (url: string) => {
    const method = url.split("/").at(-1) ?? "";
    requests.push(method);
    const values: Record<string, unknown> = {
      askSettings: {
        configured: true,
        provider: "synthetic",
        providerName: "Synthetic",
        model: "fixture",
        protocols: [],
        providers: [],
      },
      askList: [
        { id: "existing", title: "Existing conversation", created: "2026-11-10", updated: "2026-11-10" },
      ],
      overview: { projects: [], allNext: [], notes: [] },
      automation: { asked: true, tasks: {} },
    };
    return { ok: true, json: async () => values[method] ?? {} };
  });
  const streams = vi.fn();
  const closeStream = vi.fn();
  vi.stubGlobal(
    "EventSource",
    class {
      constructor() {
        streams();
      }
      close = closeStream;
    },
  );
  vi.stubGlobal("addEventListener", vi.fn());
  vi.stubGlobal("removeEventListener", vi.fn());
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  const renderAsk = vi.fn<NonNullable<OverviewPageProps["renderAsk"]>>(
    (prompt, _configureRequest, _configureBuiltin, _connections, promptRequest, active) =>
      createElement(AskPage, {
        workspace: ws.root,
        initialPrompt: prompt,
        initialPromptRequest: promptRequest,
        active,
      }),
  );
  const captureOnce = vi.fn();
  const props = {
    hosted: true,
    loadPreferences: async () => ({ locale: "zh-CN", followSystem: false }),
    load: async () => sources.overview,
    loadHome: async () => ({
      data: readHome(sources),
      presentation: sources.overview,
      loading: false,
      error: null,
    }),
    loadCalendar: async () => readCalendar(ws),
    loadMe: async () => ({}),
    loadOnboarding: async () => ({ showGuide: false }),
    loadCalendarPush: async () => ({}),
    loadProjects: async () => [],
    loadLibrary: async () => ({ inbox: [] }),
    renderAsk,
    captureOnce,
  } as unknown as OverviewPageProps;
  let app!: ReturnType<typeof create>;
  try {
    await act(async () => {
      app = create(createElement(OverviewPage, props));
    });
    await act(async () => app.root.findByType(LifeHome).props.ask("Context from Today"));
    const panel = () => app.root.findByProps({ role: "complementary" });
    const composer = () => app.root.findByProps({ "aria-label": "给开图发消息" });
    expect(panel().props.hidden).toBe(false);
    expect(app.root.findAllByType(LifeHome)).toHaveLength(1);
    expect(renderAsk.mock.calls.at(-1)?.[0]).toBe("Context from Today");
    expect(renderAsk.mock.calls.at(-1)?.[9]).toBeUndefined();
    expect(captureOnce).not.toHaveBeenCalled();
    expect(composer().props.value).toBe("Context from Today");
    await act(async () =>
      app.root
        .findAllByType("button")
        .find((button) => button.children.includes("Existing conversation"))
        ?.props.onClick(),
    );
    await act(async () => composer().props.onChange({ target: { value: "unsent draft" } }));
    await act(async () => app.root.findByProps({ "aria-label": "关闭问问" }).props.onClick());
    await act(async () => app.root.findByProps({ "aria-label": "就地问问" }).props.onClick());
    expect(composer().props.value).toBe("unsent draft");
    await act(async () =>
      panel()
        .findAllByType("button")
        .find((button) => button.children.includes("展开"))
        ?.props.onClick(),
    );
    expect(app.root.findAllByType(LifeHome)).toHaveLength(0);
    expect(composer().props.value).toBe("unsent draft");
    expect(streams).toHaveBeenCalledOnce();
    expect(closeStream).not.toHaveBeenCalled();
    const nav = app.root.findByProps({ "aria-label": "主要导航" });
    await act(async () => nav.findAllByType("button")[0]?.props.onClick());
    await act(async () => app.root.findByProps({ "aria-label": "就地问问" }).props.onClick());
    expect(composer().props.value).toBe("unsent draft");
    expect(streams).toHaveBeenCalledOnce();
    expect(closeStream).not.toHaveBeenCalled();
    expect(requests).not.toContain("askCreate");
    expect(requests).not.toContain("askSend");
  } finally {
    if (app) await act(async () => app.unmount());
    rmSync(ws.root, { recursive: true, force: true });
  }
});
