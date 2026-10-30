import { rmSync } from "node:fs";
import {
  adoptOnboardingMatter,
  changeOnboardingNext,
  onboardingStatus,
  readHome,
  readHomeSources,
  readOnboardingMatter,
  readOverviewPage,
  saveOnboardingChoices,
  saveOnboardingMatter,
} from "@kaitu/core";
import { type ComponentProps, createElement, useState } from "react";
import { act, create } from "react-test-renderer";
import { expect, test, vi } from "vitest";
import { freshWorkspace } from "../../core/test/helpers.js";
import { OnboardingMatter } from "../src/client/OnboardingMatter.js";
import { OnboardingPage, STORAGE_STEP } from "../src/client/OnboardingPage.js";
import { PlansCard } from "../src/client/Plans.js";
import { StorageChoice } from "../src/client/StorageChoice.js";
import { LifeHome, TodayStart } from "../src/client/TodayPage.js";

test("首次已确认的目标经过存放选择后带入手动采纳，并可完成及回读结果", async () => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  const ws = await freshWorkspace();
  const goal = "完成一篇合成短文";
  const next = "写下第一段";
  const done = vi.fn();
  const organize = vi.fn(async (source: string) => readOnboardingMatter(ws, source));
  const refresh = async () => {};
  const services = {
    saveOnboardingMatter: (text: string) => saveOnboardingMatter(ws, text),
    organizeOnboardingMatter: organize,
    adoptOnboardingMatter: (source: string, draft: Parameters<typeof adoptOnboardingMatter>[2]) =>
      adoptOnboardingMatter(ws, source, draft),
    changeOnboardingNext: (id: string, rev: number, action: string, value: string) =>
      changeOnboardingNext(ws, id, rev, action, value),
  };
  const Flow = () => {
    const [step, setStep] = useState(0);
    const [status, setStatus] = useState(onboardingStatus(ws));
    return createElement(OnboardingPage, {
      ...services,
      status,
      step,
      setStep,
      onStatus: setStatus,
      builtin: true,
      chooseOnboarding: (input) => saveOnboardingChoices(ws, input),
      loadSettings: async () => ({ storage: { root: ws.root, provider: "local" }, backup: {} }),
      refresh,
      onComplete: done,
      onPrompt: vi.fn(),
      openSource: vi.fn(),
    } as ComponentProps<typeof OnboardingPage>);
  };
  let app!: ReturnType<typeof create>;
  try {
    await act(async () => {
      app = create(createElement(Flow));
    });
    await act(async () => app.root.findByType(TodayStart).props.start(goal));
    await vi.waitFor(() => expect(app.root.findByType(OnboardingPage).props.step).toBe(STORAGE_STEP));
    await act(async () => app.root.findByType(StorageChoice).props.onDone(false, false));
    expect(app.root.findByType(OnboardingPage).props.step).toBe(1);
    const click = async (label: string) => {
      await act(async () =>
        app.root
          .findAllByType("button")
          .find((button) => button.children.includes(label))
          ?.props.onClick(),
      );
    };
    await click("保存并整理");
    await vi.waitFor(() => expect(organize).toHaveBeenCalledOnce());
    await vi.waitFor(() =>
      expect(app.root.findAllByType("textarea").some((area) => area.props.value === goal)).toBe(true),
    );
    const fields = app.root.findByType(OnboardingMatter).findAllByType("textarea");
    expect(fields[0]?.props.value).toBe(goal);
    await act(async () => fields[2]?.props.onChange({ target: { value: next } }));
    await click("采纳这个下一步");
    await vi.waitFor(() => expect(done).toHaveBeenCalled());
    const overview = await readOverviewPage(ws);
    expect(overview.plans.goals).toHaveLength(1);
    expect(overview.plans.goals[0]).toMatchObject({ title: goal, next: { title: next } });
    await act(async () => app.unmount());
    await act(async () => {
      app = create(
        createElement(PlansCard, {
          plans: overview.plans,
          ...services,
          changeNext: services.changeOnboardingNext,
          addGoalNext: vi.fn(),
          refresh,
          open: vi.fn(),
        }),
      );
    });
    await click("完成");
    await act(async () => app.root.findByType("input").props.onChange({ target: { value: "第一段已写好" } }));
    await act(async () => app.root.findByType("form").props.onSubmit({ preventDefault() {} }));
    await vi.waitFor(async () =>
      expect((await readOverviewPage(ws)).plans.goals[0]?.lastResult).toBe("第一段已写好"),
    );
    expect((await readOverviewPage(ws)).plans.goals[0]?.next).toBeNull();
  } finally {
    if (app) await act(async () => app.unmount());
    rmSync(ws.root, { recursive: true, force: true });
    vi.unstubAllGlobals();
  }
});

test("空首页可主动开始，已有目标直达其ID，老用户不出现新手开始操作", async () => {
  const ws = await freshWorkspace();
  let app!: ReturnType<typeof create>;
  try {
    const data = await readOverviewPage(ws);
    const home = { data: readHome(await readHomeSources(ws)), loading: false, error: null };
    const begin = vi.fn();
    const openGoal = vi.fn();
    const props = {
      data,
      home,
      firstVisit: true,
      begin,
      openGoal,
      askText: "",
      setAskText: vi.fn(),
      loadProjects: async () => [],
      library: vi.fn(),
      loadLibrary: vi.fn(),
      openProject: vi.fn(),
    } as unknown as ComponentProps<typeof LifeHome>;
    await act(async () => {
      app = create(createElement(LifeHome, props));
    });
    const start = app.root.findAllByType("button").find((button) => button.children.includes("开始"));
    expect(start).toBeDefined();
    await act(async () => start?.props.onClick());
    expect(begin).toHaveBeenCalledOnce();
    await act(async () => app.update(createElement(LifeHome, { ...props, firstVisit: false })));
    expect(app.root.findAllByType("button").some((button) => button.children.includes("开始"))).toBe(false);
    const saved = await saveOnboardingMatter(ws, "合成目标");
    await adoptOnboardingMatter(ws, saved.source, { goal: "合成目标", current: "", next: "合成下一步" });
    const updated = { ...home, data: readHome(await readHomeSources(ws)) };
    const target = updated.data.threads.find((thread) => thread.kind === "goal");
    expect(target).toBeDefined();
    await act(async () =>
      app.update(createElement(LifeHome, { ...props, home: updated, firstVisit: false })),
    );
    await act(async () => app.root.findByProps({ "aria-label": "打开合成目标" }).props.onClick());
    expect(openGoal).toHaveBeenCalledWith(target?.id);
    expect(props.library).not.toHaveBeenCalled();
  } finally {
    if (app) await act(async () => app.unmount());
    rmSync(ws.root, { recursive: true, force: true });
  }
});
