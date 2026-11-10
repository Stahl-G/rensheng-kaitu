import { createElement } from "react";
import { act, create } from "react-test-renderer";
import { expect, test, vi } from "vitest";
import { AskEvidence } from "../src/client/AskEvidence.js";
import { type AskEvent, askEvidence, toolFailed } from "../src/client/ask-evidence.js";

const call = (id: number, name: string, args: object): AskEvent => ({
  id,
  type: "tool/call",
  data: { callId: id, name, arguments: JSON.stringify(args) },
});
const result = (id: number, value: unknown): AskEvent => ({
  id: id + 100,
  type: "tool/result",
  data: { message: { toolCallId: id, content: [{ type: "text", text: JSON.stringify(value) }] } },
});

test("source and write receipts reflect operation and actual result, including failures and previews", () => {
  const events = [
    call(1, "kaitu_workspace", { operation: "read", path: "notes/source.md" }),
    result(1, { ok: true, result: { content: "Original" } }),
    call(2, "kaitu_records", { operation: "update", type: "workout", id: "x" }),
    result(2, { ok: false, error: "Revision conflict" }),
    call(3, "kaitu_tasks", { operation: "add", task: { title: "Suggestion" } }),
    result(3, { ok: true, result: { record: { id: "t", title: "Suggestion", status: "proposed" } } }),
    call(4, "kaitu_import", { path: "/tmp/export.zip", source: "chatgpt-conversations" }),
    result(4, { ok: true, result: { count: 4 } }),
    call(5, "kaitu_workspace", { operation: "write", files: [{ path: "notes/new.md", content: "New" }] }),
    result(5, { ok: true, result: { paths: ["notes/new.md"] } }),
    call(6, "kaitu_add_record", { type: "workout", fields: {} }),
    result(6, "ambiguous output"),
  ];
  expect(askEvidence(events, false).map(({ lane, state }) => [lane, state])).toEqual([
    ["read", "read"],
    ["write", "failed"],
    ["write", "proposed"],
    ["write", "preview"],
    ["write", "saved"],
    ["write", "unknown"],
  ]);
  expect(toolFailed(events[3])).toBe(true);
  expect(askEvidence(events, false)[2]).toMatchObject({ task: true, recordId: "t", target: "Suggestion" });
  expect(askEvidence([call(8, "shell", { command: "echo saved" })], false)).toEqual([]);
});

test("an interrupted earlier turn does not become active when the next turn starts", () => {
  const earlier = call(1, "kaitu_workspace", { operation: "write" });
  const user: AskEvent = { id: 2, type: "user/message", data: {} };
  const next = call(3, "kaitu_workspace", { operation: "read", path: "notes/source.md" });
  expect(askEvidence([earlier, user, next], true).map((item) => item.state)).toEqual(["stopped", "reading"]);
});

test("checking a task suggestion routes to Today without adopting or writing", async () => {
  const onToday = vi.fn();
  const events = [
    call(1, "kaitu_tasks", { operation: "add", task: { title: "Suggestion" } }),
    result(1, { ok: true, result: { record: { id: "t", title: "Suggestion", status: "proposed" } } }),
  ];
  let app!: ReturnType<typeof create>;
  try {
    await act(async () => {
      app = create(createElement(AskEvidence, { items: askEvidence(events, false), onToday }));
    });
    await act(async () => app.root.findByType("button").props.onClick());
    expect(onToday).toHaveBeenCalledOnce();
    expect(app.root.findByType("button").children).toContain("到今天核对");
  } finally {
    await act(async () => app?.unmount());
  }
});

test("reused tool-call identities in later turns cannot replace an earlier receipt", () => {
  const first = call(1, "kaitu_workspace", { operation: "read", path: "notes/first.md" });
  const second = call(3, "kaitu_workspace", { operation: "read", path: "notes/second.md" });
  second.data.callId = first.data.callId;
  const secondResult = result(3, { ok: false, error: "Second read failed" });
  (secondResult.data.message as { toolCallId: unknown }).toolCallId = first.data.callId;
  const items = askEvidence(
    [
      first,
      result(1, { ok: true, result: { content: "First original" } }),
      { id: 2, type: "user/message", data: {} },
      second,
      secondResult,
    ],
    false,
  );
  expect(items[0]).toMatchObject({ target: "notes/first.md", state: "read" });
  expect(items[0]?.detail).toContain("First original");
  expect(items[1]).toMatchObject({ target: "notes/second.md", state: "failed" });
});
