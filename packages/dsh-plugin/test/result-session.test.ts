import { rmSync, statSync } from "node:fs";
import { createElement } from "react";
import { act, create } from "react-test-renderer";
import { afterEach, expect, test, vi } from "vitest";
import {
  type HomeState,
  type ResultRequest,
  Workspace,
  addRecord,
  readRecordRevisions,
  readRecords,
  updateRecord,
} from "../../core/src/index.js";
import { clonedWorkspace } from "../../core/test/helpers.js";
import { TodayBoard } from "../src/client/TodayBoard.js";
import {
  type DraftTransport,
  RESULT_UNDO_MS,
  type ResultTransport,
  type Step,
  createTodayBoardSession,
  resultId,
} from "../src/client/result-session.js";
import { KaituOverviewService } from "../src/overview-service.js";

function storage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}
function service(ws: Workspace): ResultTransport {
  const owner = {
    workspace: ws,
    write: (run: () => Promise<unknown>) => run(),
  } as unknown as KaituOverviewService;
  return (root, request) =>
    KaituOverviewService.prototype.resultAction.call(owner, root, JSON.parse(JSON.stringify(request)));
}
function drafts(ws: Workspace): DraftTransport {
  const owner = { workspace: ws } as unknown as KaituOverviewService;
  return (root, value, expected) =>
    KaituOverviewService.prototype.resultDraft.call(owner, root, value, expected);
}
const step = (id: string): Step => ({
  key: `task:${id}`,
  id,
  file: "task",
  title: "Synthetic task",
  parent: "Goal",
  due: null,
  precondition: { kind: "task", expectedRev: 1 },
});
const action = (target: Step, text = "Result") => ({
  step: target,
  text,
  request: {
    client_id: resultId(),
    op: "complete_next_result" as const,
    args: { file: "task", id: target.id, expected_rev: 1, result_text: text },
  },
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test("real service write with lost reply survives owner and service reconstruction with original ID and draft", async () => {
  const ws = await clonedWorkspace();
  try {
    const task = addRecord(
      ws,
      "task",
      { title: "Synthetic task", status: "open", source: "me/goals.json#goal" },
      { by: "user" },
    ).record;
    const owner = createTodayBoardSession(ws.root, undefined, drafts(ws));
    await owner.ready;
    const original = action(step(task.id));
    owner.set("drafts", { [original.step.key]: original.text });
    const first = service(ws);
    const lost: ResultTransport = async (root, request) => {
      expect(
        ws.readJson<{ operation: { request: ResultRequest } }>(".kaitu/result-draft.json").operation.request,
      ).toEqual(request);
      await first(root, request);
      throw new Error("Lost reply after real write");
    };
    await owner.send(lost, original);
    expect(owner.operation.current?.request).toEqual(original.request);
    const reopened = createTodayBoardSession(ws.root, undefined, drafts(new Workspace(ws.root)));
    await reopened.ready;
    expect(reopened.read().drafts[original.step.key]).toBe("Result");
    const retry = vi.fn(service(new Workspace(ws.root)));
    await reopened.send(retry);
    expect(retry.mock.calls[0]?.[1]).toEqual(original.request);
    expect(readRecordRevisions(ws, "task").filter((row) => row.id === task.id)).toHaveLength(2);
    expect(reopened.operation.current).toBeUndefined();
    expect(reopened.read().receipt).toBeUndefined(); // Duplicate never says the old effect is still current.
    expect(readRecords(ws, "task").find((row) => row.id === task.id)?.source).toBe(task.source);
    expect(statSync(ws.resolve(".kaitu/result-draft.json", { internal: true })).mode & 0o777).toBe(0o600);
    const other = createTodayBoardSession(`${ws.root}-other`, storage());
    expect(other.operation.current).toBeUndefined();
    await expect(service(ws)(`${ws.root}-other`, original.request)).rejects.toMatchObject({
      code: "kaitu/completion-rejected",
      details: { code: "CONFLICT" },
    });
  } finally {
    rmSync(ws.root, { recursive: true, force: true });
  }
});

test("blank completion, decision undo and later-edit conflicts use real generic revisions and retain sources", async () => {
  const ws = await clonedWorkspace();
  try {
    const task = addRecord(ws, "task", { title: "Blank", status: "open" }, { by: "user" }).record;
    const owner = createTodayBoardSession(ws.root, storage());
    const original = action(step(task.id), "");
    owner.set("drafts", { [original.step.key]: original.text });
    await owner.send(service(ws), original);
    expect(owner.read().drafts).not.toHaveProperty(original.step.key);
    await owner.undo(service(new Workspace(ws.root)));
    expect(readRecords(ws, "task").find((row) => row.id === task.id)?.status).toBe("open");
    expect(owner.read().drafts[original.step.key]).toBe("");
    await service(new Workspace(ws.root))(ws.root, original.request);
    expect(readRecordRevisions(ws, "task").filter((row) => row.id === task.id)).toHaveLength(3);
    const proposal = addRecord(
      ws,
      "task",
      { title: "Suggestion", source: "memory/synthetic.md", status: "open" },
      { by: "agent" },
    ).record;
    const request: ResultRequest = {
      client_id: resultId(),
      op: "adopt_task",
      args: { id: proposal.id, expected_rev: 1 },
    };
    await owner.send(service(ws), { step: step(proposal.id), text: "Adopted", request });
    await owner.undo(service(ws));
    expect(owner.read().drafts).not.toHaveProperty(`task:${proposal.id}`);
    expect(readRecords(ws, "task").find((row) => row.id === proposal.id)).toMatchObject({
      status: "proposed",
      source: proposal.source,
    });
    await owner.send(service(ws), {
      step: step(proposal.id),
      text: "Dismissed",
      request: { client_id: resultId(), op: "cancel_task", args: { id: proposal.id, expected_rev: 3 } },
    });
    updateRecord(ws, "task", proposal.id, { title: "Later independent edit" }, { by: "user" });
    await owner.undo(service(ws));
    expect(owner.read().error).toMatch(/changed|更新/i);
    expect(readRecords(ws, "task").find((row) => row.id === proposal.id)?.title).toBe(
      "Later independent edit",
    );
  } finally {
    rmSync(ws.root, { recursive: true, force: true });
  }
});

test("owner blocks repeats and same-target follow-ups, expires undo across navigation, never persists successful history", async () => {
  const store = storage();
  const owner = createTodayBoardSession("A", store);
  const original = action(step("one"));
  let resolve!: (value: Awaited<ReturnType<ResultTransport>>) => void;
  const remote = vi.fn<ResultTransport>(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const first = owner.send(remote, original);
  await owner.send(remote, original);
  await owner.send(remote, action(step("one"), "Other"));
  await vi.waitFor(() => expect(remote).toHaveBeenCalledTimes(1));
  // A -> B -> A uses the same A owner; late A responses cannot replace B state.
  const other = createTodayBoardSession("B", store);
  resolve({ status: "applied", effect: { file: "task", id: "one", rev: 2, prior_rev: 1 } });
  await first;
  expect(other.read().receipt).toBeUndefined();
  expect(owner.read().receipt).toBeDefined();
  expect(createTodayBoardSession("A", store).read().receipt).toBeUndefined();
  expect(JSON.parse(store.getItem("kaitu:result-draft:A") ?? "{}")).not.toHaveProperty("receipt");
  vi.useFakeTimers();
  vi.setSystemTime(Date.now() + RESULT_UNDO_MS + 1);
  await owner.undo(remote);
  expect(remote).toHaveBeenCalledTimes(1);
  expect(owner.read().receipt).toBeUndefined();
});

test("Today preserves multiline paste and legacy display, permits blank submit, leaves text undo and IME alone", async () => {
  vi.stubGlobal("window", new EventTarget());
  const owner = createTodayBoardSession("A", storage());
  const target = step("one");
  const data: HomeState = {
    loading: false,
    error: null,
    data: {
      today: "2026-11-11",
      threads: [],
      traces: [],
      pending: [],
      atlas: null,
      lastAuthored: null,
      steps: [target],
      results: [
        {
          id: "old",
          file: "task",
          title: "Old",
          text: "First\nSecond",
          completed_at: "2026-11-10T00:00:00Z",
          at: "2026-11-10T00:00:00Z",
          date: "2026-11-10",
          by: "user",
        },
      ],
      resultActivityDays: 1,
    },
  };
  data.data?.results?.push({
    id: "unknown",
    file: "task",
    title: "Unknown provenance",
    text: "Stored result",
    completed_at: "2026-11-11T00:00:00Z",
    at: "2026-11-11T00:00:00Z",
    date: "2026-11-11",
    by: "unknown",
  });
  const remote = vi
    .fn<ResultTransport>()
    .mockResolvedValue({ status: "applied", effect: { file: "task", id: "one", rev: 2, prior_rev: 1 } });
  let app!: ReturnType<typeof create>;
  await act(async () => {
    app = create(
      createElement(TodayBoard, {
        data,
        session: owner,
        resultAction: remote,
        openProject: vi.fn(),
        library: vi.fn(),
        ask: vi.fn(),
        canAsk: false,
        busy: false,
      }),
    );
  });
  try {
    expect(app.root.findByProps({ title: "2026-11-11" }).props["data-result"]).toBe(false);
    expect(app.root.findByType("b").children).toEqual(["1"]);
    const field = () => app.root.findByType("input");
    await act(async () => field().props.onCompositionStart());
    await act(async () => app.root.findByType("form").props.onSubmit({ preventDefault: vi.fn() }));
    expect(remote).not.toHaveBeenCalled();
    await act(async () => field().props.onCompositionEnd());
    const prevent = vi.fn();
    field().props.onKeyDown({ key: "z", metaKey: true, nativeEvent: {}, preventDefault: prevent });
    expect(prevent).not.toHaveBeenCalled();
    await act(async () =>
      field().props.onPaste({
        clipboardData: { getData: () => "A\nB" },
        preventDefault: vi.fn(),
        currentTarget: { selectionStart: 0, selectionEnd: 0 },
      }),
    );
    expect(app.root.findByType("textarea").props.value).toBe("A\nB");
    await act(async () => app.root.findByType("form").props.onSubmit({ preventDefault: vi.fn() }));
    expect(remote).not.toHaveBeenCalled();
    await act(async () => app.root.findByType("textarea").props.onChange({ target: { value: "" } }));
    await act(async () => app.root.findByType("form").props.onSubmit({ preventDefault: vi.fn() }));
    expect(remote.mock.calls[0]?.[1].args.result_text).toBe("");
    await act(async () => app.root.findByProps({ "aria-expanded": false }).props.onClick());
    expect(
      app.root
        .findAllByType("p")
        .some((p) => p.children.includes("First\nSecond") && p.props.style.whiteSpace === "pre-wrap"),
    ).toBe(true);
  } finally {
    owner.expire();
    await act(async () => app.unmount());
  }
});

test("unreadable local pending state blocks first send and preserves its bytes; stale owners cannot overwrite drafts", async () => {
  const ws = await clonedWorkspace();
  try {
    const first = createTodayBoardSession(ws.root, undefined, drafts(ws));
    const second = createTodayBoardSession(ws.root, undefined, drafts(new Workspace(ws.root)));
    await Promise.all([first.ready, second.ready]);
    first.set("drafts", { one: "Original unfinished draft" });
    await vi.waitFor(() =>
      expect(ws.readJson<{ drafts: Record<string, string> }>(".kaitu/result-draft.json").drafts.one).toBe(
        "Original unfinished draft",
      ),
    );
    second.set("drafts", { one: "Stale window" });
    await vi.waitFor(() => expect(second.read().error).toMatch(/Draft changed|草稿已变化/));
    expect(ws.readJson<{ drafts: Record<string, string> }>(".kaitu/result-draft.json").drafts.one).toBe(
      "Original unfinished draft",
    );
    ws.writeText(".kaitu/result-draft.json", "broken original bytes", { internal: true });
    const broken = createTodayBoardSession(ws.root, undefined, drafts(new Workspace(ws.root)));
    await broken.ready;
    const remote = vi.fn<ResultTransport>();
    await broken.send(remote, action(step("one")));
    expect(remote).not.toHaveBeenCalled();
    expect(broken.read().error).toMatch(/Cannot keep draft|无法保留草稿/);
    expect(ws.readText(".kaitu/result-draft.json")).toBe("broken original bytes");
  } finally {
    rmSync(ws.root, { recursive: true, force: true });
  }
});

test("lost pending-state response never sends early, and a fresh owner confirms the original request", async () => {
  const ws = await clonedWorkspace();
  try {
    const task = addRecord(ws, "task", { title: "Synthetic", status: "open" }, { by: "user" }).record;
    let lost = false;
    const stateService = drafts(ws);
    const owner = createTodayBoardSession(ws.root, undefined, async (root, value, expected) => {
      const saved = await stateService(root, value, expected);
      if (value?.operation && !lost) {
        lost = true;
        throw new Error("Lost state-save response");
      }
      return saved;
    });
    await owner.ready;
    const transport = vi.fn(service(ws));
    const original = action(step(task.id));
    await owner.send(transport, original);
    expect(transport).not.toHaveBeenCalled();
    const fresh = createTodayBoardSession(ws.root, undefined, drafts(new Workspace(ws.root)));
    await fresh.ready;
    expect(transport).not.toHaveBeenCalled(); // Reading state never replays an action.
    expect(fresh.operation.current?.request).toEqual(original.request);
    await fresh.send(transport);
    expect(transport.mock.calls[0]?.[1]).toEqual(original.request);
    expect(readRecordRevisions(ws, "task").filter((row) => row.id === task.id)).toHaveLength(2);
    fresh.expire();
  } finally {
    rmSync(ws.root, { recursive: true, force: true });
  }
});
