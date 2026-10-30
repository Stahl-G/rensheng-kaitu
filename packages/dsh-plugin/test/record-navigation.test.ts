import { rmSync } from "node:fs";
import {
  adoptOnboardingMatter,
  createProject,
  lifeMap,
  readCalendar,
  readDirectionMap,
  readExploration,
  readHome,
  readHomeSources,
  readLibrary,
  readMe,
  readNews,
  readOverviewPage,
  readProjectPage,
  readProjectsPage,
  saveOnboardingMatter,
  setProject,
  writeExploration,
} from "@kaitu/core";
import { createElement } from "react";
import { type ReactTestRenderer, act, create } from "react-test-renderer";
import { afterEach, expect, test, vi } from "vitest";
import { clonedWorkspace } from "../../core/test/helpers.js";
import { DirectionMap } from "../src/client/DirectionMap.js";
import { DirectionsPage } from "../src/client/DirectionsPage.js";
import { OverviewPage, type OverviewPageProps } from "../src/client/OverviewPage.js";
import { PlansCard } from "../src/client/Plans.js";
import { ProjectsPage } from "../src/client/ProjectsPage.js";
import { LifeHome } from "../src/client/TodayPage.js";

vi.mock("../src/client/PaperMap.js", () => ({ PaperMap: () => null }));
afterEach(() => vi.unstubAllGlobals());

async function setup() {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
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
  const ws = await clonedWorkspace();
  const project = await createProject(ws, {
    title: "合成导航项目",
    slug: "navigation-project",
    kind: "personal",
  });
  await setProject(ws, project.slug, { next: [{ id: "next", title: "查看项目原文", status: "todo" }] });
  const matter = await saveOnboardingMatter(ws, "合成导航目标");
  await adoptOnboardingMatter(ws, matter.source, {
    goal: "合成导航目标",
    current: "已有原文",
    next: "写一段",
  });
  const direction = await writeExploration(ws, {
    operation: "create_direction",
    data: { title: "合成导航方向", motivation: "检验来源跳转", hypothesis: "能找到对应记录" },
  });
  const props = {
    hosted: true,
    loadPreferences: async () => ({ locale: "zh-CN", followSystem: false, exploreEntries: ["directions"] }),
    load: async () => readOverviewPage(ws),
    loadHome: async () => ({ data: readHome(await readHomeSources(ws)), loading: false, error: null }),
    loadCalendar: async () => readCalendar(ws),
    loadLifeMap: async () => lifeMap(ws),
    loadNews: async () => readNews(ws),
    loadMe: async () => readMe(ws),
    loadOnboarding: async () => ({ showGuide: false, hasUserData: true }),
    loadCalendarPush: async () => ({}),
    loadProjects: async () => readProjectsPage(ws),
    loadProject: async (slug: string) => readProjectPage(ws, slug),
    loadLibrary: async (query: Parameters<typeof readLibrary>[1]) => readLibrary(ws, query),
    loadExploration: async () => readExploration(ws),
    loadDirectionMap: async () => readDirectionMap(ws),
    generateDirectionMap: async () => readDirectionMap(ws),
    dismissDirectionLink: async () => readDirectionMap(ws),
    renderAsk: () => null,
  } as unknown as OverviewPageProps;
  let app!: ReactTestRenderer;
  await act(async () => {
    app = create(createElement(OverviewPage, props));
  });
  await vi.waitFor(() => expect(app.root.findByType(LifeHome).props.home?.data).toBeTruthy());
  return { ws, app, project, direction };
}
async function click(app: ReactTestRenderer, text: string) {
  const button = app.root
    .findAllByType("button")
    .find(
      (node) =>
        node.children.filter((child) => typeof child === "string").join("") === text ||
        node.findAllByType("strong").some((child) => child.children.includes(text)) ||
        node.findAllByType("span").some((child) => child.children.includes(text)),
    );
  if (!button) throw new Error(`Missing action: ${text}`);
  await act(async () => {
    button.props.onClick();
  });
}
async function navigate(app: ReactTestRenderer, label: string) {
  const nav = app.root.findByProps({ "aria-label": "主要导航" });
  const button = nav
    .findAllByType("button")
    .find((node) => node.findAllByType("span").some((child) => child.children.includes(label)));
  await act(async () => {
    button?.props.onClick();
  });
}

test("Today opens the chosen project ahead of unrelated plans and returns to Today", async () => {
  const { ws, app, project } = await setup();
  try {
    await act(async () => {
      app.root.findByProps({ "aria-label": "打开合成导航项目" }).props.onClick();
    });
    await vi.waitFor(() =>
      expect(
        app.root
          .findByType(ProjectsPage)
          .findAllByType("h2")
          .some((node) => node.children.includes("合成导航项目")),
      ).toBe(true),
    );
    expect(app.root.findAllByType(PlansCard)).toHaveLength(0);
    expect(app.root.findByType(ProjectsPage).props.initialProject).toBe(project.slug);
    await click(app, "← 今天");
    expect(app.root.findAllByType(LifeHome)).toHaveLength(1);
    expect((await readOverviewPage(ws)).plans.goals[0]?.title).toBe("合成导航目标");
    await navigate(app, "资料");
    await click(app, "在做的事");
    await click(app, "合成导航项目 →");
    await vi.waitFor(() =>
      expect(app.root.findByType(ProjectsPage).findAllByType("h2").length).toBeGreaterThan(0),
    );
    await click(app, "← 全部项目");
    expect(
      app.root
        .findByType(ProjectsPage)
        .findAllByType("button")
        .some(
          (node) => node.children.filter((child) => typeof child === "string").join("") === "合成导航项目 →",
        ),
    ).toBe(true);
  } finally {
    await act(async () => app.unmount());
    rmSync(ws.root, { recursive: true, force: true });
  }
});

test("map record actions open the matching saved goal, project and direction", async () => {
  const { ws, app, project, direction } = await setup();
  try {
    await navigate(app, "开图");
    await click(app, "方向");
    const goal = (await readOverviewPage(ws)).plans.goals[0];
    if (!goal) throw new Error("Goal missing");
    await click(app, "合成导航目标");
    expect(app.root.findByType(PlansCard).findByProps({ id: `plan-${goal.id}` })).toBeTruthy();
    expect(app.root.findByType(PlansCard).props.plans.projects).toBeGreaterThan(0);
    await click(app, "← 方向");
    await vi.waitFor(() => expect(app.root.findAllByType(DirectionMap)).toHaveLength(1));
    await click(app, "合成导航项目");
    await vi.waitFor(() =>
      expect(
        app.root
          .findByType(ProjectsPage)
          .findAllByType("h2")
          .some((node) => node.children.includes("合成导航项目")),
      ).toBe(true),
    );
    expect(app.root.findByType(ProjectsPage).props.initialProject).toBe(project.slug);
    await click(app, "← 方向");
    await click(app, "合成导航方向");
    expect(app.root.findByType(DirectionsPage).props.initialDirection).toBe(direction.id);
    await vi.waitFor(() =>
      expect(
        app.root
          .findByType(DirectionsPage)
          .findAllByType("h2")
          .some((node) => node.children.includes("合成导航方向")),
      ).toBe(true),
    );
    expect(readExploration(ws).directions.find((row) => row.id === direction.id)?.title).toBe("合成导航方向");
    await click(app, "← 方向");
    await click(app, "合成导航方向");
    expect(app.root.findByType(DirectionsPage).props.initialDirection).toBe(direction.id);
  } finally {
    await act(async () => app.unmount());
    rmSync(ws.root, { recursive: true, force: true });
  }
});
