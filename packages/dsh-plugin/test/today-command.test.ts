import { RemoteError, remoteErrorOf } from "@deepseek-ai/dsh-typert-protocol";
import { KaituError } from "@kaitu/core";
import type { HomeState } from "@kaitu/core";
import { createElement } from "react";
import { act, create } from "react-test-renderer";
import { afterEach, expect, test, vi } from "vitest";
import { type CommandLoadResult, CommandPalette } from "../src/client/CommandPalette.js";
import { TodayBoard, createTodayBoardSession } from "../src/client/TodayBoard.js";
import { throwHomeCompletionError } from "../src/home-completion-error.js";

afterEach(() => vi.unstubAllGlobals());
test("Today retains a failed result, prevents double-submit and only shows undo after success", async () => {
  vi.stubGlobal("window", new EventTarget());
  const step = {
    key: "task:one",
    id: "one",
    title: "First step",
    parent: "A goal",
    file: "task",
    due: null,
    precondition: { kind: "task" as const, expectedRev: 1 },
  };
  const data: HomeState = {
    loading: false,
    error: null,
    data: {
      today: "2026-11-10",
      lastAuthored: null,
      threads: [],
      traces: [],
      pending: [],
      atlas: null,
      steps: [step],
      results: [],
    },
  };
  let accept!: (value: { token: string; title: string }) => void;
  const complete = vi
    .fn()
    .mockRejectedValueOnce(new Error("Offline"))
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          accept = resolve;
        }),
    );
  const undo = vi.fn().mockResolvedValue({ undone: true });
  const session = createTodayBoardSession();
  const props = {
    data,
    complete,
    undo,
    session,
    openProject: vi.fn(),
    library: vi.fn(),
    ask: vi.fn(),
    canAsk: false,
    adopt: vi.fn(),
    dismiss: vi.fn(),
    busy: false,
  };
  let app!: ReturnType<typeof create>;
  await act(async () => {
    app = create(createElement(TodayBoard, props));
  });
  try {
    await act(async () =>
      app.root.findByType("input").props.onChange({ target: { value: "Finished the draft" } }),
    );
    const submit = () => app.root.findByType("form").props.onSubmit({ preventDefault: vi.fn() });
    await act(async () => submit());
    expect(app.root.findByType("input").props.value).toBe("Finished the draft");
    expect(app.root.findByProps({ role: "alert" }).findByType("p").children).toContain("Offline");
    // The server saved the result and its subscription removed the step before the response was lost.
    await act(async () =>
      app.update(
        createElement(TodayBoard, {
          ...props,
          data: { ...data, data: { ...(data.data as NonNullable<HomeState["data"]>), steps: [] } },
        }),
      ),
    );
    expect(app.root.findByType("input").props.value).toBe("Finished the draft");
    const operationId = session.operation.current?.id;
    const latest = app.root
      .findAllByType("button")
      .find((button) => button.children.includes("查看最新事项"));
    expect(latest).toBeDefined();
    await act(async () => latest?.props.onClick());
    expect(session.operation.current?.id).toBe(operationId);
    expect(app.root.findAllByType("input")).toHaveLength(0);
    const retry = () => app.root.findByProps({ "aria-label": "上次结果待核实" }).findByType("button");
    await act(async () => {
      retry().props.onClick();
      retry().props.onClick();
    });
    expect(complete).toHaveBeenCalledTimes(2);
    expect(complete.mock.calls[0]?.[2]).toBe(complete.mock.calls[1]?.[2]);
    await act(async () => app.unmount());
    await act(async () => {
      app = create(
        createElement(TodayBoard, {
          ...props,
          data: { ...data, data: { ...(data.data as NonNullable<HomeState["data"]>), steps: [] } },
        }),
      );
    });
    expect(app.root.findByProps({ "aria-label": "上次结果待核实" }).findByType("button").props.disabled).toBe(
      true,
    );
    await act(async () => accept({ token: "receipt", title: step.title }));
    expect(app.root.findAllByType("input")).toHaveLength(0);
    const button = app.root.findAllByType("button").find((item) => item.children.includes("撤销"));
    await act(async () => button?.props.onClick());
    expect(undo).toHaveBeenCalledWith("receipt");
    await act(async () => app.update(createElement(TodayBoard, props)));
    expect(app.root.findByType("input").props.value).toBe("Finished the draft");
  } finally {
    await act(async () => app.unmount());
  }
});

test("command panel filters real records, uses keyboard selection and leaves actions untouched on Escape", async () => {
  vi.stubGlobal("document", { activeElement: null });
  const close = vi.fn();
  const capture = vi.fn();
  const openNote = vi.fn();
  let app!: ReturnType<typeof create>;
  await act(async () => {
    app = create(
      createElement(CommandPalette, {
        actions: [{ id: "capture", label: "记一条", run: capture }],
        load: async () => ({
          items: [{ id: "note:one", label: "Actual note", detail: "笔记", run: openNote }],
          failedSources: [],
        }),
        close,
      }),
    );
  });
  try {
    const key = (key: string) =>
      app.root
        .findByType("dialog")
        .props.onKeyDown({ key, nativeEvent: {}, preventDefault: vi.fn(), stopPropagation: vi.fn() });
    await act(async () => app.root.findByType("input").props.onChange({ target: { value: "Actual" } }));
    expect(app.root.findAllByProps({ role: "option" })).toHaveLength(1);
    await act(async () => key("Enter"));
    expect(openNote).toHaveBeenCalledOnce();
    expect(capture).not.toHaveBeenCalled();
    await act(async () => key("Escape"));
    expect(close).toHaveBeenCalledTimes(2);
    expect(openNote).toHaveBeenCalledOnce();
  } finally {
    await act(async () => app.unmount());
  }
});

test("command load throws and rejections are retryable, retain the query and use the latest loader only once", async () => {
  vi.stubGlobal("document", { activeElement: null });
  const capture = vi.fn();
  const openNote = vi.fn();
  const close = vi.fn();
  const load = vi
    .fn()
    .mockImplementationOnce(() => {
      throw new Error("/synthetic/private/unreadable.md");
    })
    .mockRejectedValueOnce(new Error("Synthetic transport failure"));
  const props = { actions: [{ id: "capture", label: "Capture", run: capture }], load, close };
  let app!: ReturnType<typeof create>;
  await act(async () => {
    app = create(createElement(CommandPalette, props));
  });
  try {
    const retry = () => app.root.findByProps({ role: "alert" }).findByType("button");
    expect(JSON.stringify(app.toJSON())).not.toContain("/synthetic/private/unreadable.md");
    await act(async () =>
      app.root.findByType("dialog").props.onKeyDown({
        key: "Enter",
        nativeEvent: {},
        target: { closest: () => ({}) },
        preventDefault: vi.fn(),
      }),
    );
    expect(capture).not.toHaveBeenCalled();
    await act(async () => {
      const click = retry().props.onClick;
      click();
      click();
    });
    expect(load).toHaveBeenCalledTimes(2);
    expect(app.root.findAllByProps({ role: "alert" })).toHaveLength(1);
    await act(async () => app.root.findByType("input").props.onChange({ target: { value: "Synthetic" } }));
    let resolve!: (result: CommandLoadResult) => void;
    const latest = vi.fn(
      () =>
        new Promise<CommandLoadResult>((done) => {
          resolve = done;
        }),
    );
    await act(async () => app.update(createElement(CommandPalette, { ...props, load: latest })));
    await act(async () => {
      const click = retry().props.onClick;
      click();
      click();
    });
    expect(latest).toHaveBeenCalledOnce();
    expect(retry().props.disabled).toBe(true);
    expect(app.root.findByType("input").props.value).toBe("Synthetic");
    await act(async () =>
      resolve({
        items: [{ id: "note:synthetic", label: "Synthetic note", run: openNote }],
        failedSources: [],
      }),
    );
    expect(app.root.findAllByProps({ role: "alert" })).toHaveLength(0);
    expect(app.root.findByType("input").props.value).toBe("Synthetic");
    await act(async () => app.root.findByProps({ role: "option" }).props.onClick());
    expect(openNote).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  } finally {
    await act(async () => app.unmount());
  }
});

test.each(["close", "unmount"])("%s invalidates a pending command load before reopening", async (end) => {
  vi.stubGlobal("document", { activeElement: null });
  let stale!: (result: CommandLoadResult) => void;
  const close = vi.fn();
  let app!: ReturnType<typeof create>;
  await act(async () => {
    app = create(
      createElement(CommandPalette, {
        actions: [],
        load: () =>
          new Promise<CommandLoadResult>((resolve) => {
            stale = resolve;
          }),
        close,
      }),
    );
  });
  if (end === "close") {
    await act(async () => app.root.findByType("dialog").props.onCancel({ preventDefault: vi.fn() }));
    await act(async () =>
      stale({ items: [{ id: "stale", label: "Stale", run: vi.fn() }], failedSources: ["Old source"] }),
    );
    expect(app.root.findAllByProps({ role: "option" })).toHaveLength(0);
    expect(app.root.findAllByProps({ role: "alert" })).toHaveLength(0);
    expect(close).toHaveBeenCalledOnce();
  }
  await act(async () => app.unmount());
  let fresh!: (result: CommandLoadResult) => void;
  await act(async () => {
    app = create(
      createElement(CommandPalette, {
        actions: [],
        load: () =>
          new Promise<CommandLoadResult>((resolve) => {
            fresh = resolve;
          }),
        close,
      }),
    );
  });
  try {
    await act(async () =>
      stale({ items: [{ id: "stale", label: "Stale", run: vi.fn() }], failedSources: ["Old source"] }),
    );
    expect(app.root.findByProps({ role: "listbox" }).props["aria-busy"]).toBe(true);
    expect(app.root.findAllByProps({ role: "option" })).toHaveLength(0);
    expect(app.root.findAllByProps({ role: "alert" })).toHaveLength(0);
    await act(async () =>
      fresh({ items: [{ id: "fresh", label: "Fresh", run: vi.fn() }], failedSources: [] }),
    );
    expect(app.root.findByProps({ role: "option" }).findAllByType("span")[1]?.children).toContain("Fresh");
    expect(app.root.findByProps({ role: "listbox" }).props["aria-busy"]).toBe(false);
  } finally {
    await act(async () => app.unmount());
  }
});

test.each(["CONFLICT", "kaitu/completion-rejected", undefined])(
  "a rejected completion can release the old target without discarding its draft (%s)",
  async (code) => {
    vi.stubGlobal("window", new EventTarget());
    const step = {
      key: "task:a",
      id: "a",
      title: "First",
      parent: "",
      file: "task",
      due: null,
      precondition: { kind: "task" as const, expectedRev: 1 },
    };
    const next = { ...step, key: "task:b", id: "b", title: "Second" };
    const data: HomeState = {
      loading: false,
      error: null,
      data: {
        today: "2026-11-10",
        lastAuthored: null,
        threads: [],
        traces: [],
        pending: [],
        atlas: null,
        steps: [step, next],
        results: [],
      },
    };
    const session = createTodayBoardSession();
    const props = {
      data,
      session,
      complete: vi
        .fn()
        .mockRejectedValue(
          code === "kaitu/completion-rejected"
            ? new RemoteError("kaitu/completion-rejected", "Changed", { code: "CONFLICT" })
            : Object.assign(new Error("Changed"), { code }),
        ),
      undo: vi.fn(),
      openProject: vi.fn(),
      library: vi.fn(),
      ask: vi.fn(),
      canAsk: false,
      adopt: vi.fn(),
      dismiss: vi.fn(),
      busy: false,
    };
    let app!: ReturnType<typeof create>;
    try {
      await act(async () => {
        app = create(createElement(TodayBoard, props));
      });
      await act(async () =>
        app.root.findByType("input").props.onChange({ target: { value: "Keep my draft" } }),
      );
      await act(async () => app.root.findByType("form").props.onSubmit({ preventDefault: vi.fn() }));
      if (!code) {
        expect(app.root.findByType("input").props.disabled).toBe(true);
        await act(async () =>
          app.root
            .findAllByType("button")
            .find((button) => button.children.includes("查看最新事项"))
            ?.props.onClick(),
        );
      }
      expect(app.root.findByType("input").props.disabled).toBe(!code);
      if (!code) expect(session.operation.current?.id).toBeTruthy();
      expect(session.read().drafts[step.key]).toBe("Keep my draft");
      await act(async () =>
        app.update(
          createElement(TodayBoard, {
            ...props,
            data: { ...data, data: { ...(data.data as NonNullable<HomeState["data"]>), steps: [next] } },
          }),
        ),
      );
      expect(app.root.findByType("h2").findByType("mark").children).toContain("Second");
      expect(app.root.findByType("input").props.disabled).toBe(!code);
    } finally {
      await act(async () => app?.unmount());
    }
  },
);

test("completion business rejection survives the supported RemoteError carrier while transport failures stay unknown", () => {
  let failure: unknown;
  try {
    throwHomeCompletionError(new KaituError("Changed", "CONFLICT"));
  } catch (error) {
    failure = error;
  }
  const encoded = remoteErrorOf(failure);
  expect(encoded).toMatchObject({ code: "kaitu/completion-rejected", details: { code: "CONFLICT" } });
  const wire = JSON.parse(JSON.stringify(encoded));
  const decoded = new RemoteError(wire.code, wire.message, wire.details);
  expect(decoded).toMatchObject({ code: "kaitu/completion-rejected", details: { code: "CONFLICT" } });
  const lost = new Error("Reply lost");
  expect(() => throwHomeCompletionError(lost)).toThrow(lost);
});
