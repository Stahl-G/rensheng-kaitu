import type { HomeState } from "@kaitu/core";
import { createElement } from "react";
import { act, create } from "react-test-renderer";
import { afterEach, expect, test, vi } from "vitest";
import { CommandPalette } from "../src/client/CommandPalette.js";
import { TodayBoard, createTodayBoardSession } from "../src/client/TodayBoard.js";

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
    expect(app.root.findByProps({ role: "alert" }).children).toContain("Offline");
    await act(async () => {
      submit();
      submit();
    });
    expect(complete).toHaveBeenCalledTimes(2);
    expect(complete.mock.calls[0]?.[2]).toBe(complete.mock.calls[1]?.[2]);
    await act(async () => app.unmount());
    await act(async () => {
      app = create(createElement(TodayBoard, props));
    });
    expect(app.root.findByType("input").props.disabled).toBe(true);
    await act(async () => accept({ token: "receipt", title: step.title }));
    expect(app.root.findAllByType("input")).toHaveLength(0);
    const button = app.root.findAllByType("button").find((item) => item.children.includes("撤销"));
    await act(async () => button?.props.onClick());
    expect(undo).toHaveBeenCalledWith("receipt");
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
        load: async () => [{ id: "note:one", label: "Actual note", detail: "笔记", run: openNote }],
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
