import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Context } from "@deepseek-ai/cordis";
import {
  type HomeNextTarget,
  type HomeState,
  type PhoneReceipt,
  type TaskDecisionAction,
  Workspace,
  addRecord,
  applyTaskDecision,
  completeHomeNext,
  localStateRoot,
  moveWorkspace,
  readCalendar,
  readHome,
  readHomeSources,
  readOverviewPage,
  readRecords,
  undoHomeNext,
  updateRecord,
} from "@kaitu/core";
import { createElement } from "react";
import { act, create } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vitest";
import { productRequest } from "../../cli/src/ui/product.js";
import { setStateBinding, stateBinding } from "../../core/src/state-binding.js";
import { clonedWorkspace } from "../../core/test/helpers.js";
import { TYPERT } from "../lib/typert.host.js";
import { OverviewPage, type OverviewPageProps } from "../src/client/OverviewPage.js";
import { type TaskDecisionServices, TaskSuggestions } from "../src/client/TaskSuggestions.js";
import { TodayBoard } from "../src/client/TodayBoard.js";
import { LifeHome } from "../src/client/TodayPage.js";
import { KaituOverviewService } from "../src/overview-service.js";

function need<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Missing recovered item");
  return value;
}
vi.mock("../src/client/PaperMap.js", () => ({ PaperMap: () => null }));
const contexts: Context[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose();
});
function service(ws: Workspace) {
  const ctx = new Context();
  contexts.push(ctx);
  return new KaituOverviewService(ctx, {}, ws);
}
const contract = TYPERT as {
  invocations: {
    namespace: string;
    method: string;
    result: { create(): { parse(value: unknown): unknown } };
  }[];
};
function wire<T>(method: string, value: T): T {
  const entry = contract.invocations.find((item) => item.namespace === "kaitu" && item.method === method);
  expect(entry).toBeDefined();
  return JSON.parse(JSON.stringify(entry?.result.create().parse(value)));
}
async function setup() {
  const ws = await clonedWorkspace();
  const original = addRecord(ws, "task", {
    title: "Synthetic suggestion",
    source: "me/goals.json#synthetic",
  }).record;
  const pending = readHome(await readHomeSources(ws)).pending.find((item) => item.id === original.id);
  if (!pending?.file) throw new Error("Missing actual task location");
  const host = service(ws);
  const state = wire("taskDecisionState", await host.taskDecisionState(ws.root));
  const action: TaskDecisionAction = {
    client_id: randomUUID(),
    op: "decide_task",
    args: {
      consumer_id: state.scope.consumer_id,
      id: pending.id,
      file: pending.file,
      expected_rev: pending.rev,
      expected_source: pending.source,
      decision: "dismissed",
    },
  };
  return { ws, host, action, scope: state.scope };
}
it("real RPC result codecs and standalone share adopted/dismissed history, preserved source, undo and edit conflict", async () => {
  for (const decision of ["adopted", "dismissed"] as const) {
    const { ws, host, action, scope } = await setup();
    if ("decision" in action.args) action.args.decision = decision;
    const receipt = wire("submitTaskDecision", await host.submitTaskDecision(scope, action));
    expect(receipt).toMatchObject({
      status: "applied",
      decision: { status: decision, decision_id: action.client_id },
    });
    const reopened = service(new Workspace(ws.root));
    const state = wire("taskDecisionState", await reopened.taskDecisionState(ws.root));
    expect(state.decisions).toEqual([
      expect.objectContaining({ source: "me/goals.json#synthetic", status: decision, can_undo: true }),
    ]);
    expect(readHome(await readHomeSources(ws)).results).toEqual([]);
    const undo: TaskDecisionAction = {
      client_id: randomUUID(),
      op: "undo_task_decision",
      args: { consumer_id: scope.consumer_id, decision_id: need(state.decisions[0]).decision_id },
    };
    expect(await productRequest(ws, "submitTaskDecision", [scope, undo])).toMatchObject({
      status: "applied",
      decision: { status: "undone" },
    });
    expect(readRecords(ws, "task")[0]).toMatchObject({ status: "proposed", rev: 3 });
    const next = {
      ...action,
      client_id: randomUUID(),
      args: { ...action.args, expected_rev: 3 },
    } as TaskDecisionAction;
    await reopened.submitTaskDecision(scope, next);
    updateRecord(ws, "task", need(state.decisions[0]).id, { notes: "A later real edit" });
    const rejected = wire(
      "submitTaskDecision",
      await reopened.submitTaskDecision(scope, {
        ...undo,
        client_id: randomUUID(),
        args: { consumer_id: scope.consumer_id, decision_id: next.client_id },
      }),
    );
    expect(rejected.status).toBe("conflict");
    expect(rejected.message).toContain("已修改");
    expect(readRecords(ws, "task")[0]?.notes).toBe("A later real edit");
  }
});
it("lost decide and undo receipts restart by enumeration, reuse original payload and never append duplicate revisions", async () => {
  const { ws, host, action, scope } = await setup();
  const actual = ws.writeJson.bind(ws);
  const drop = () =>
    vi.spyOn(ws, "writeJson").mockImplementation((file, value, options) => {
      actual(file, value, options);
      if (file === "phone/receipts.json") throw new Error("Synthetic lost response after durable receipt");
    });
  drop();
  await expect(host.submitTaskDecision(scope, action)).rejects.toThrow("lost response");
  vi.restoreAllMocks();
  let reopened = service(new Workspace(ws.root));
  let recovered = wire("taskDecisionState", await reopened.taskDecisionState(ws.root));
  const pending = need(recovered.requests.find((item) => !item.receipt));
  expect(pending.action).toEqual(action);
  const before = readRecords(ws, "task");
  expect(
    wire("retryTaskDecision", await reopened.retryTaskDecision(recovered.scope, pending.action.client_id))
      .status,
  ).toBe("duplicate");
  expect(readRecords(ws, "task")).toEqual(before);
  const undo: TaskDecisionAction = {
    client_id: randomUUID(),
    op: "undo_task_decision",
    args: { consumer_id: scope.consumer_id, decision_id: need(recovered.decisions[0]).decision_id },
  };
  // Also interrupt undo after the durable core write, before the local terminal receipt.
  drop();
  await expect(service(ws).submitTaskDecision(scope, undo)).rejects.toThrow("lost response");
  vi.restoreAllMocks();
  reopened = service(new Workspace(ws.root));
  recovered = await reopened.taskDecisionState(ws.root);
  const enumerated = need(recovered.requests.find((item) => item.action.op === "undo_task_decision"));
  expect(enumerated.action).toEqual(undo);
  expect(enumerated.receipt).toBeUndefined();
  expect(
    await productRequest(ws, "retryTaskDecision", [recovered.scope, enumerated.action.client_id]),
  ).toMatchObject({ status: "duplicate", decision: { status: "undone" } });
  expect(readRecords(ws, "task")[0]?.rev).toBe(3);
});
it("journal preparation failure makes zero task/core ledger writes; consumer changes hold original unknown requests", async () => {
  const { ws, host, action, scope } = await setup();
  const dir = join(localStateRoot(), "task-decision-outbox");
  const saved = `${dir}.test-saved`;
  if (existsSync(dir)) renameSync(dir, saved);
  writeFileSync(dir, "Synthetic blocked journal directory");
  const before = readRecords(ws, "task");
  try {
    await expect(host.submitTaskDecision(scope, action)).rejects.toThrow();
  } finally {
    rmSync(dir);
    if (existsSync(saved)) renameSync(saved, dir);
    else mkdirSync(dir);
  }
  expect(readRecords(ws, "task")).toEqual(before);
  expect(ws.exists(".kaitu/phone-actions.json")).toBe(false);
  const actual = ws.writeJson.bind(ws);
  vi.spyOn(ws, "writeJson").mockImplementation((file, value, options) => {
    if (file === ".kaitu/phone-actions.json") throw new Error("Synthetic unknown I/O");
    actual(file, value, options);
  });
  await expect(host.submitTaskDecision(scope, action)).rejects.toThrow("unknown I/O");
  vi.restoreAllMocks();
  const prior = stateBinding(ws.root);
  setStateBinding(ws.root, prior.state, prior.mode, randomUUID());
  const reopened = service(new Workspace(ws.root));
  const held = await reopened.taskDecisionState(ws.root);
  expect(held.requests.find((item) => !item.receipt)?.action).toEqual(action);
  await expect(reopened.retryTaskDecision(held.scope, action.client_id)).rejects.toThrow("身份已变化");
  await expect(
    reopened.submitTaskDecision(held.scope, {
      ...action,
      client_id: randomUUID(),
      args: { ...action.args, consumer_id: held.scope.consumer_id },
    }),
  ).rejects.toThrow("未确认");
  await expect(reopened.taskDecisionState(`${ws.root}-other`)).rejects.toThrow("切换");
  expect(readRecords(ws, "task")).toEqual(before);
});

it("supported local workspace move preserves unknown request discovery without supplying the original ID", async () => {
  const { ws, host, action, scope } = await setup();
  const original = ws.writeJson.bind(ws);
  vi.spyOn(ws, "writeJson").mockImplementation((file, value, options) => {
    original(file, value, options);
    if (file === "phone/receipts.json") throw new Error("Synthetic lost receipt");
  });
  await expect(host.submitTaskDecision(scope, action)).rejects.toThrow("lost receipt");
  vi.restoreAllMocks();
  // Model standalone's pre-relocation watcher pause with real service disposal.
  // The legacy DSH moveStorage entry does not provide this lifecycle; Windows holds watched roots open.
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose();
  await moveWorkspace(ws, `${ws.root}-moved`, false);
  const reopened = service(new Workspace(ws.root));
  const recovered = await reopened.taskDecisionState(ws.root);
  const pending = need(recovered.requests.find((item) => !item.receipt));
  expect(pending.action).toEqual(action);
  expect(recovered.scope.consumer_id).toBe(scope.consumer_id);
  expect(await reopened.retryTaskDecision(recovered.scope, pending.action.client_id)).toMatchObject({
    status: "duplicate",
  });
  expect(readRecords(ws, "task")[0]?.rev).toBe(2);
});

function services(ws: Workspace, host: KaituOverviewService): TaskDecisionServices {
  return {
    root: ws.root,
    load: (root) => host.taskDecisionState(root),
    submit: (scope, action) => host.submitTaskDecision(scope, action),
    retry: (scope, id) => host.retryTaskDecision(scope, id),
    changed: vi.fn(),
    activity: vi.fn(),
    historyRequest: 0,
    historyRevealed: vi.fn(),
  };
}
const button = (app: ReturnType<typeof create>, text: string) => {
  const found = app.root.findAllByType("button").find((item) => item.children.join("") === text);
  if (!found) throw new Error(`Missing button ${text}`);
  return found;
};
it("Today double click writes once; leaving the page and remounting reads persistent adopted/dismissed history and undo", async () => {
  for (const decision of ["adopted", "dismissed"] as const) {
    const { ws, host } = await setup();
    const api = services(ws, host);
    const submit = vi.spyOn(api, "submit");
    let app: ReturnType<typeof create> | undefined;
    try {
      await act(async () => {
        app = create(
          createElement(TaskSuggestions, {
            services: api,
            pending: readHome(await readHomeSources(ws)).pending,
          }),
        );
      });
      const target = decision === "adopted" ? "采纳" : "×";
      await act(async () => {
        const click = button(need(app), target).props.onClick;
        click();
        click();
      });
      expect(submit).toHaveBeenCalledTimes(1);
      await act(async () => need(app).unmount());
      await act(async () => {
        app = create(
          createElement(TaskSuggestions, {
            services: api,
            pending: readHome(await readHomeSources(ws)).pending,
          }),
        );
      });
      await act(async () => button(need(app), "已处理建议").props.onClick());
      expect(JSON.stringify(need(app).toJSON())).toContain(decision === "adopted" ? "已采纳" : "已拒绝");
      await act(async () => button(need(app), "撤销").props.onClick());
      expect(readRecords(ws, "task")[0]).toMatchObject({ status: "proposed", rev: 3 });
    } finally {
      if (app) await act(async () => app?.unmount());
    }
  }
});
it("restarted UI discovers an unknown durable request itself and retries its original ID; an old workspace response cannot update a new page", async () => {
  const { ws, host, action, scope } = await setup();
  const write = ws.writeJson.bind(ws);
  vi.spyOn(ws, "writeJson").mockImplementation((file, value, options) => {
    write(file, value, options);
    if (file === "phone/receipts.json") throw new Error("Synthetic lost receipt");
  });
  await expect(host.submitTaskDecision(scope, action)).rejects.toThrow();
  vi.restoreAllMocks();
  const api = services(ws, service(new Workspace(ws.root)));
  const retry = vi.spyOn(api, "retry");
  let app: ReturnType<typeof create> | undefined;
  try {
    await act(async () => {
      app = create(
        createElement(TaskSuggestions, {
          services: api,
          pending: readHome(await readHomeSources(ws)).pending,
        }),
      );
    });
    await act(async () => button(need(app), "核对原请求").props.onClick());
    expect(retry).toHaveBeenCalledWith(expect.anything(), action.client_id);
    expect(readRecords(ws, "task")[0]?.rev).toBe(2);
    await act(async () => need(app).unmount());
    const other = await setup();
    let resolve: (receipt: PhoneReceipt) => void = () => {};
    const oldApi = {
      ...services(other.ws, other.host),
      submit: () =>
        new Promise<PhoneReceipt>((accept) => {
          resolve = accept;
        }),
    };
    await act(async () => {
      app = create(
        createElement(TaskSuggestions, {
          services: oldApi,
          pending: readHome(await readHomeSources(other.ws)).pending,
        }),
      );
    });
    await act(async () => button(need(app), "采纳").props.onClick());
    await act(async () => need(app).unmount());
    await act(async () => {
      app = create(createElement(TaskSuggestions, { services: api, pending: [] }));
    });
    await act(async () =>
      resolve({
        ref: other.action.client_id,
        kind: "action",
        status: "applied",
        at: new Date().toISOString(),
      }),
    );
    expect(oldApi.changed).not.toHaveBeenCalled();
    expect(need(app).root.findByType(TaskSuggestions).props.services.root).toBe(ws.root);
  } finally {
    if (app) await act(async () => app?.unmount());
  }
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
it("CmdZ uses local submission order, opens decision history across pages, preserves old completion and editor/IME modifiers", async () => {
  browserGlobals();
  const { ws, host } = await setup();
  const oldTask = addRecord(ws, "task", { title: "Old", status: "open" }, { by: "user" }).record;
  const lateTask = addRecord(ws, "task", { title: "Late", status: "open" }, { by: "user" }).record;
  const stepFor = (task: typeof oldTask) => ({
    key: `task:${task.id}`,
    id: task.id,
    file: "task",
    title: String(task.title),
    parent: "Goal",
    due: null,
    precondition: { kind: "task" as const, expectedRev: task.rev ?? 1 },
  });
  const step = stepFor(oldTask);
  const oldCompletion = completeHomeNext(ws, step, "Old result", randomUUID());
  let updateHome: ((state: HomeState) => void) | undefined;
  const loadHome = async (): Promise<HomeState> => ({
    data: readHome(await readHomeSources(ws)),
    loading: false,
    error: null,
  });
  const publishHome = async () => updateHome?.(await loadHome());
  let accept: () => Promise<void> = async () => {};
  const complete = vi
    .fn()
    .mockImplementationOnce(
      (target: HomeNextTarget, text: string, id: string) =>
        new Promise((resolve) => {
          accept = async () => {
            const receipt = completeHomeNext(ws, target, text, id);
            await publishHome();
            resolve(receipt);
          };
        }),
    )
    .mockImplementation(async (target: HomeNextTarget, text: string, id: string) => {
      const receipt = completeHomeNext(ws, target, text, id);
      await publishHome();
      return receipt;
    });
  const undo = vi.fn(async (token: string) => {
    const receipt = undoHomeNext(ws, token);
    await publishHome();
    return receipt;
  });
  const initialHome = await loadHome();
  const suggestionId = need(initialHome.data?.pending[0]).id;
  const overview = await readOverviewPage(ws);
  const historyScroll = vi.fn();
  const historyFocus = vi.fn();
  const props = {
    hosted: true,
    loadPreferences: async () => ({ locale: "zh-CN", followSystem: false }),
    load: async () => overview,
    loadCalendar: () => readCalendar(ws),
    loadMe: async () => ({}),
    loadOnboarding: async () => ({ showGuide: false }),
    loadCalendarPush: async () => ({}),
    loadProjects: async () => [],
    renderAsk: () => null,
    loadHome: async () => initialHome,
    subscribeHome: (listener) => {
      updateHome = listener;
      return () => {
        updateHome = undefined;
      };
    },
    completeHomeNext: complete,
    undoHomeNext: undo,
    loadTaskDecisions: (root: string) => host.taskDecisionState(root),
    submitTaskDecision: async (scope, action) => {
      const receipt = await host.submitTaskDecision(scope, action);
      await publishHome();
      return receipt;
    },
    retryTaskDecision: (scope, id) => host.retryTaskDecision(scope, id),
  } as OverviewPageProps;
  let app: ReturnType<typeof create> | undefined;
  const key = (value: string, extra = {}) => {
    const event = new Event("keydown", { cancelable: true });
    Object.defineProperties(
      event,
      Object.fromEntries(
        Object.entries({ key: value, metaKey: true, target: { closest: () => null }, ...extra }).map(
          ([name, value]) => [name, { value }],
        ),
      ),
    );
    window.dispatchEvent(event);
    return event;
  };
  try {
    await act(async () => {
      app = create(createElement(OverviewPage, props), {
        createNodeMock: (element) =>
          element.type === "button" && element.props.children === "已处理建议"
            ? { scrollIntoView: historyScroll, focus: historyFocus }
            : null,
      });
    });
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    const owner = () => need(app).root.findByType(LifeHome);
    const completionUndo = () =>
      need(owner().findByType(TodayBoard).findByProps({ "aria-live": "polite" }).findAllByType("button")[0]);
    const untilReceiptClears = (action: () => void) =>
      new Promise<void>((resolve) => {
        const board = owner().props.session;
        const stop = board.subscribe(() => {
          if (!board.read().receipt) {
            stop();
            resolve();
          }
        });
        action();
      });
    await act(async () =>
      owner().props.session.set("receipt", { value: oldCompletion, step, text: "Old result" }),
    );
    let waiting: Promise<unknown> | undefined;
    await act(async () => {
      waiting = owner().props.complete(stepFor(lateTask), "Late result", randomUUID());
    });
    await act(async () => button(need(app), "采纳").props.onClick());
    expect(readRecords(ws, "task").find((item) => item.id === suggestionId)?.status).toBe("open");
    expect(completionUndo().children.join("")).toBe("撤销");
    await act(async () => {
      await accept();
      await waiting;
    });
    await act(async () => {
      key("j");
    });
    await act(async () => {
      expect(key("z").defaultPrevented).toBe(true);
    });
    expect(undo).not.toHaveBeenCalled();
    expect(owner().props.decisions.historyRequest).toBe(0);
    expect(historyScroll).toHaveBeenCalledTimes(1);
    expect(historyFocus).toHaveBeenCalledWith({ preventScroll: true });
    expect(owner().props.session.read().receipt.value.token).toBe(oldCompletion.token);
    expect(readRecords(ws, "task").find((item) => item.id === oldTask.id)?.status).toBe("done");
    await act(async () => {
      key("j");
    });
    const navigation = need(app).root.findByProps({ "aria-label": "主要导航" });
    const today = need(
      navigation
        .findAllByType("button")
        .find((item) => item.findAllByType("span").some((span) => span.children.join("") === "今天")),
    );
    await act(async () => today.props.onClick());
    expect(historyScroll).toHaveBeenCalledTimes(1);
    expect(historyFocus).toHaveBeenCalledTimes(1);
    await act(async () => {
      key("z");
    });
    expect(historyScroll).toHaveBeenCalledTimes(2);
    expect(owner().props.decisions.historyRequest).toBe(0);
    for (const protection of [
      { isComposing: true },
      { repeat: true },
      { shiftKey: true },
      { altKey: true },
      { target: { closest: () => ({}) } },
    ]) {
      expect(key("z", protection).defaultPrevented).toBe(false);
    }
    await act(async () => untilReceiptClears(() => completionUndo().props.onClick()));
    expect(undo).toHaveBeenCalledWith(oldCompletion.token);
    const restored = need(readRecords(ws, "task").find((item) => item.id === oldTask.id));
    expect(restored.status).toBe("open");
    expect(readRecords(ws, "task").find((item) => item.id === suggestionId)?.status).toBe("open");
    expect(readRecords(ws, "task").find((item) => item.id === lateTask.id)?.status).toBe("done");
    expect(owner().props.session.read()).toMatchObject({
      selected: step.key,
      drafts: { [step.key]: "Old result" },
      receipt: undefined,
    });
    expect(owner().findByType(TodayBoard).findByType("input").props.value).toBe("Old result");
    let latest: { token: string; title: string } | undefined;
    await act(async () => {
      latest = await owner().props.complete(stepFor(restored), "Latest completion", randomUUID());
    });
    await act(async () =>
      owner().props.session.set("receipt", {
        value: need(latest),
        step,
        text: "Latest completion",
      }),
    );
    await act(async () =>
      untilReceiptClears(() => {
        key("z");
      }),
    );
    expect(undo).toHaveBeenCalledWith(need(latest).token);
    expect(historyScroll).toHaveBeenCalledTimes(2);
  } finally {
    if (app) await act(async () => app?.unmount());
  }
});

it("a phone-origin decision's unknown Mac undo blocks a new same-task decision at the service boundary", async () => {
  const { ws, host, action, scope } = await setup();
  expect(applyTaskDecision(ws, action).status).toBe("applied");
  expect((await host.taskDecisionState(ws.root)).requests).toEqual([]);
  const write = ws.writeJson.bind(ws);
  vi.spyOn(ws, "writeJson").mockImplementation((file, value, options) => {
    write(file, value, options);
    if (file === "phone/receipts.json") throw new Error("Synthetic unknown undo");
  });
  const undo: TaskDecisionAction = {
    client_id: randomUUID(),
    op: "undo_task_decision",
    args: { consumer_id: scope.consumer_id, decision_id: action.client_id },
  };
  await expect(host.submitTaskDecision(scope, undo)).rejects.toThrow("unknown undo");
  vi.restoreAllMocks();
  const next = {
    ...action,
    client_id: randomUUID(),
    args: { ...action.args, expected_rev: 3 },
  } as TaskDecisionAction;
  await expect(host.submitTaskDecision(scope, next)).rejects.toThrow("未确认");
  expect(readRecords(ws, "task")[0]?.rev).toBe(3);
  expect((await host.taskDecisionState(ws.root)).requests.map((item) => item.action)).toEqual([undo]);
  expect(await host.retryTaskDecision(scope, undo.client_id)).toMatchObject({ status: "duplicate" });
  expect(await host.submitTaskDecision(scope, next)).toMatchObject({ status: "applied" });
  expect(readRecords(ws, "task")[0]?.rev).toBe(4);
});
it("same-root loader replacement resets only its owner and late callbacks cannot clear a newer in-flight operation", async () => {
  const { ws, host } = await setup();
  addRecord(ws, "task", { title: "Second synthetic suggestion" });
  const api = services(ws, host);
  const releases: (() => void)[] = [];
  const submit = vi.fn(async (scope, action) => {
    const receipt = await host.submitTaskDecision(scope, action);
    await new Promise<void>((resolve) => releases.push(resolve));
    return receipt;
  });
  const first = { ...api, submit };
  let app: ReturnType<typeof create> | undefined;
  const pending = async () => readHome(await readHomeSources(ws)).pending;
  try {
    await act(async () => {
      app = create(createElement(TaskSuggestions, { services: first, pending: await pending() }));
    });
    await act(async () => button(need(app), "采纳").props.onClick());
    expect(submit).toHaveBeenCalledTimes(1);
    const next = { ...first, load: (root: string) => host.taskDecisionState(root) };
    await act(async () => {
      need(app).update(createElement(TaskSuggestions, { services: next, pending: await pending() }));
    });
    expect(button(need(app), "采纳").props.disabled).toBe(false);
    await act(async () => button(need(app), "采纳").props.onClick());
    expect(submit).toHaveBeenCalledTimes(2);
    await act(async () => need(releases[0])());
    // Old finally may not clear the second owner's busy flag or its double-submit guard.
    expect(button(need(app), "采纳").props.disabled).toBe(true);
    await act(async () => button(need(app), "采纳").props.onClick());
    expect(submit).toHaveBeenCalledTimes(2);
    await act(async () => need(releases[1])());
    expect(next.changed).toHaveBeenCalledTimes(1);
    await act(async () => button(need(app), "已处理建议").props.onClick());
    expect(button(need(app), "撤销").props.disabled).toBe(false);
  } finally {
    for (const release of releases) release();
    if (app) await act(async () => app?.unmount());
  }
});

it("decision history initially renders a bounded recent batch and More reveals real core decisions incrementally", async () => {
  const { ws, host, scope } = await setup();
  for (let index = 0; index < 45; index++)
    addRecord(ws, "task", {
      title: `History item ${index + 1}`,
      source: "https://example.test/synthetic/long-source/",
    });
  const proposals = (await readOverviewPage(ws)).proposedTasks.filter((item) =>
    item.title.startsWith("History item"),
  );
  for (const item of proposals) {
    if (!item.file) throw new Error("Missing actual source file");
    expect(
      applyTaskDecision(ws, {
        client_id: randomUUID(),
        op: "decide_task",
        args: {
          consumer_id: scope.consumer_id,
          file: item.file,
          id: item.id,
          expected_rev: item.rev,
          expected_source: item.source,
          decision: "dismissed",
        },
      }).status,
    ).toBe("applied");
  }
  let app: ReturnType<typeof create> | undefined;
  try {
    await act(async () => {
      app = create(
        createElement(TaskSuggestions, {
          services: services(ws, host),
          pending: readHome(await readHomeSources(ws)).pending,
        }),
      );
    });
    expect(need(app).root.findAllByType("article")).toHaveLength(0);
    await act(async () => button(need(app), "已处理建议").props.onClick());
    expect(need(app).root.findAllByType("article")).toHaveLength(20);
    expect(need(app).root.findAllByType("article")[0]?.findByType("strong").children.join("")).toBe(
      "History item 45",
    );
    await act(async () => button(need(app), "更多").props.onClick());
    expect(need(app).root.findAllByType("article")).toHaveLength(40);
    await act(async () => button(need(app), "更多").props.onClick());
    expect(need(app).root.findAllByType("article")).toHaveLength(45);
    expect(
      need(app)
        .root.findAllByType("button")
        .filter((item) => item.children.join("") === "更多"),
    ).toHaveLength(0);
  } finally {
    if (app) await act(async () => app?.unmount());
  }
});
