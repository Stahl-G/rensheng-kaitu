import { expect, it, vi } from "vitest";
import { KaituError } from "../src/errors.js";
import { parseFrontmatter, stringifyFrontmatter } from "../src/frontmatter.js";
import {
  Workspace,
  addRecord,
  phoneReceipts,
  processInbox,
  readRecords,
  schemas,
  updateRecord,
  writePhoneSnapshots,
} from "../src/index.js";
import { applyPhoneActions } from "../src/phone-actions.js";
import { phoneResults } from "../src/phone-results.js";
import { readRecordRevisions } from "../src/records.js";
import { ulid } from "../src/ulid.js";
import { clonedWorkspace } from "./helpers.js";

const envelope = (op: string, args: object) => ({
  client_id: ulid(),
  device: "1234abcd",
  at: "2000-01-01T00:00:00Z",
  op,
  args,
});
const file = () => `inbox/agents/ios-1234abcd-${ulid()}.actions.jsonl`;
const deliver = (ws: Workspace, action: ReturnType<typeof envelope>) =>
  applyPhoneActions(ws, file(), JSON.stringify(action));
async function setup(kind: "task" | "status", text = "已经打印两张小样") {
  const ws = await clonedWorkspace();
  if (kind === "task") {
    const task = addRecord(
      ws,
      "task",
      {
        title: "打印两张小样",
        status: "open",
        notes: "原始备注",
        source: "me/goals.json#synthetic-direction",
      },
      { by: "user" },
    ).record;
    return {
      ws,
      action: envelope("complete_next_result", {
        file: "task",
        id: task.id,
        expected_rev: task.rev ?? 1,
        result_text: text,
      }),
      targetFile: "task",
      id: task.id,
    };
  }
  const targetFile = "health/STATUS.md";
  const doc = parseFrontmatter<{ next: { id: string; title: string; status: string }[] }>(
    ws.readText(targetFile),
  );
  const item = { id: "sample-step", title: "打印两张小样", status: "todo" };
  doc.data.next = [item, { id: "unrelated", title: "独立事项", status: "todo" }];
  doc.body += "\n原始正文\n";
  ws.writeText(targetFile, stringifyFrontmatter(doc.data, doc.body));
  return {
    ws,
    action: envelope("complete_next_result", {
      file: targetFile,
      id: item.id,
      expected_next: item,
      result_text: text,
    }),
    targetFile,
    id: item.id,
  };
}
const receipt = (ws: Workspace, id: string) => phoneReceipts(ws).find((item) => item.ref === id);

it.each(["task", "status"] as const)(
  "%s completes and undoes through actual inbox, persisted reload and capability snapshots",
  async (kind) => {
    const { ws, action, targetFile, id } = await setup(kind);
    const start = Date.now();
    const path = file();
    ws.writeText(path, JSON.stringify(action));
    await processInbox(ws, { stableMs: 0 });
    expect(receipt(ws, action.client_id)).toMatchObject({
      status: "applied",
      result: { completion_id: action.client_id, status: "completed" },
    });
    let restored = new Workspace(ws.root, { maintain: false });
    const results = phoneResults(restored);
    expect(results).toEqual([
      expect.objectContaining({
        completion_id: action.client_id,
        file: targetFile,
        id,
        title: "打印两张小样",
        text: "已经打印两张小样",
        can_undo: true,
      }),
    ]);
    expect(Date.parse(results[0].completed_at)).toBeGreaterThanOrEqual(start);
    await writePhoneSnapshots(restored, new Date(), { force: true });
    const today = restored.readJson<{
      mobile: { actions: string[]; results: unknown[]; tasks: { id: string; source?: string }[] };
    }>("phone/today.json");
    expect(today.mobile.actions).toEqual(
      expect.arrayContaining(["complete_next_result", "undo_next_result"]),
    );
    expect(today.mobile.results).toEqual(results);
    if (kind === "task")
      expect(today.mobile.tasks.find((item) => item.id === id)?.source).toBe(
        "me/goals.json#synthetic-direction",
      );
    const validate = schemas().builtin("phone-today.schema.json");
    expect(validate(today), JSON.stringify(validate.errors)).toBe(true);
    await deliver(restored, action);
    expect(receipt(restored, action.client_id)).toMatchObject({
      status: "duplicate",
      result: { status: "completed" },
    });
    const undo = envelope("undo_next_result", { completion_id: action.client_id });
    await deliver(restored, undo);
    restored = new Workspace(ws.root, { maintain: false });
    expect(phoneResults(restored)).toEqual([]);
    await deliver(restored, undo);
    expect(receipt(restored, undo.client_id)).toMatchObject({
      status: "duplicate",
      result: { status: "undone" },
    });
    await deliver(restored, action);
    expect(receipt(restored, action.client_id)).toMatchObject({
      status: "duplicate",
      result: { status: "undone" },
    });
    if (kind === "task")
      expect(readRecords(restored, "task").find((item) => item.id === id)).toMatchObject({
        status: "open",
        notes: "原始备注",
        rev: 3,
      });
    else {
      expect(restored.readText(targetFile)).toContain("原始正文");
      expect(restored.readText(targetFile)).not.toContain("已经打印两张小样");
      expect(
        parseFrontmatter<{ next: { id: string; status: string }[] }>(
          restored.readText(targetFile),
        ).data.next.find((item) => item.id === id)?.status,
      ).toBe("todo");
    }
  },
);

it.each(["task", "status"] as const)(
  "%s recovers written completion and undo when terminal journal persistence fails, without duplicate writes",
  async (kind) => {
    const { ws, action, id, targetFile } = await setup(kind);
    const failTerminal = (actionId: string) => {
      const original = ws.writeJson.bind(ws);
      return vi.spyOn(ws, "writeJson").mockImplementation((name, value, options) => {
        if (
          name === ".kaitu/phone-actions.json" &&
          (value as Record<string, { status?: string }>)[actionId]?.status === "applied"
        )
          throw new Error("synthetic terminal journal failure");
        return original(name, value, options);
      });
    };
    let fail = failTerminal(action.client_id);
    await expect(deliver(ws, action)).rejects.toThrow("synthetic terminal");
    fail.mockRestore();
    let reloaded = new Workspace(ws.root, { maintain: false });
    await deliver(reloaded, action);
    expect(phoneResults(reloaded)).toHaveLength(1);
    if (kind === "task")
      expect(readRecordRevisions(reloaded, "task").filter((row) => row.id === id)).toHaveLength(2);
    else expect(reloaded.readText(targetFile).split(`操作：${action.client_id}`).length - 1).toBe(1);
    const undo = envelope("undo_next_result", { completion_id: action.client_id });
    const original = reloaded.writeJson.bind(reloaded);
    fail = vi.spyOn(reloaded, "writeJson").mockImplementation((name, value, options) => {
      if (
        name === ".kaitu/phone-actions.json" &&
        (value as Record<string, { status?: string }>)[undo.client_id]?.status === "applied"
      )
        throw new Error("synthetic undo journal failure");
      return original(name, value, options);
    });
    await expect(deliver(reloaded, undo)).rejects.toThrow("synthetic undo");
    fail.mockRestore();
    reloaded = new Workspace(ws.root, { maintain: false });
    await deliver(reloaded, undo);
    expect(phoneResults(reloaded)).toEqual([]);
    expect(receipt(reloaded, undo.client_id)?.result?.status).toBe("undone");
    if (kind === "task")
      expect(readRecordRevisions(reloaded, "task").filter((row) => row.id === id)).toHaveLength(3);
    else expect(reloaded.readText(targetFile)).not.toContain(`操作：${action.client_id}`);
  },
);

it("keeps durable recovery on receipt failure and cloud I/O failure; payload reuse never reinterprets an ID", async () => {
  const { ws, action } = await setup("task");
  const original = ws.writeJson.bind(ws);
  const write = vi.spyOn(ws, "writeJson").mockImplementation((name, value, options) => {
    if (name === "phone/receipts.json") throw new Error("synthetic receipt failure");
    return original(name, value, options);
  });
  await expect(deliver(ws, action)).rejects.toThrow("synthetic receipt");
  write.mockRestore();
  const reloaded = new Workspace(ws.root, { maintain: false });
  await deliver(reloaded, action);
  expect(receipt(reloaded, action.client_id)).toMatchObject({
    status: "duplicate",
    result: { status: "completed" },
  });
  const changed = { ...action, args: { ...action.args, result_text: "不能替换原结果" } };
  await deliver(reloaded, changed);
  expect(receipt(reloaded, action.client_id)?.status).toBe("conflict");
  expect(phoneResults(reloaded)[0].text).toBe("已经打印两张小样");
  const other = await setup("status");
  const read = other.ws.readText.bind(other.ws);
  const fault = vi.spyOn(other.ws, "readText").mockImplementation((path) => {
    if (path === other.targetFile) throw new KaituError("synthetic cloud read failure", "CLOUD_UNAVAILABLE");
    return read(path);
  });
  await expect(deliver(other.ws, other.action)).rejects.toThrow("synthetic cloud");
  fault.mockRestore();
  await deliver(new Workspace(other.ws.root, { maintain: false }), other.action);
  expect(phoneResults(other.ws)).toHaveLength(1);
});

it("protects later task edits and STATUS target edits while preserving independent STATUS changes", async () => {
  const task = await setup("task");
  await deliver(task.ws, task.action);
  updateRecord(task.ws, "task", task.id, { title: "对端改过标题" }, { by: "agent" });
  expect(phoneResults(task.ws)[0]).toMatchObject({ text: "已经打印两张小样", can_undo: false });
  const undo = envelope("undo_next_result", { completion_id: task.action.client_id });
  await deliver(task.ws, undo);
  expect(receipt(task.ws, undo.client_id)?.status).toBe("conflict");
  expect(readRecords(task.ws, "task").find((row) => row.id === task.id)?.title).toBe("对端改过标题");
  const status = await setup("status");
  await deliver(status.ws, status.action);
  const doc = parseFrontmatter<{ next: { id: string; title: string; status: string }[] }>(
    status.ws.readText(status.targetFile),
  );
  doc.data.next[1].title = "别的事项被修改";
  doc.body += "\n对端新正文\n";
  status.ws.writeText(status.targetFile, stringifyFrontmatter(doc.data, doc.body));
  await deliver(status.ws, envelope("undo_next_result", { completion_id: status.action.client_id }));
  expect(status.ws.readText(status.targetFile)).toContain("别的事项被修改");
  expect(status.ws.readText(status.targetFile)).toContain("对端新正文");
  expect(phoneResults(status.ws)).toEqual([]);
  const stale = {
    ...status.action,
    client_id: ulid(),
    args: { ...status.action.args, expected_next: { id: status.id, title: "旧标题", status: "todo" } },
  };
  await deliver(status.ws, stale);
  expect(receipt(status.ws, stale.client_id)?.status).toBe("conflict");
});

it("blank result remains undoable and schema rejects missing preconditions and reserved fields", async () => {
  const { ws, action } = await setup("status", "   ");
  await deliver(ws, action);
  expect(phoneResults(ws)).toEqual([expect.objectContaining({ text: "   ", can_undo: true })]);
  const validate = schemas().builtin("phone-action.schema.json");
  expect(validate(action)).toBe(true);
  for (const args of [
    { file: "task", id: ulid(), result_text: "x" },
    { file: "health/STATUS.md", id: "x", result_text: "x" },
    { ...action.args, by: "user" },
  ])
    expect(validate({ ...action, args })).toBe(false);
  await deliver(ws, envelope("undo_next_result", { completion_id: action.client_id }));
  expect(phoneResults(ws)).toEqual([]);
});

it.each(["task", "status"] as const)(
  "%s recovers completed evidence after a later title edit without rewriting that edit",
  async (kind) => {
    const { ws, action, id, targetFile } = await setup(kind);
    const original = ws.writeJson.bind(ws);
    const fail = vi.spyOn(ws, "writeJson").mockImplementation((path, value, options) => {
      if (
        path === ".kaitu/phone-actions.json" &&
        (value as Record<string, { status?: string }>)[action.client_id]?.status === "applied"
      )
        throw new Error("synthetic final save failure");
      return original(path, value, options);
    });
    await expect(deliver(ws, action)).rejects.toThrow("synthetic final save");
    fail.mockRestore();
    if (kind === "task") updateRecord(ws, "task", id, { title: "后来改的标题" }, { by: "agent" });
    else {
      const doc = parseFrontmatter<{ next: { id: string; title: string }[] }>(ws.readText(targetFile));
      const item = doc.data.next.find((item) => item.id === id);
      if (!item) throw new Error("missing test target");
      item.title = "后来改的标题";
      ws.writeText(targetFile, stringifyFrontmatter(doc.data, doc.body));
    }
    const reloaded = new Workspace(ws.root, { maintain: false });
    await deliver(reloaded, action);
    expect(receipt(reloaded, action.client_id)).toMatchObject({
      status: "applied",
      result: { status: "completed" },
    });
    expect(phoneResults(reloaded)).toEqual([
      expect.objectContaining({ text: "已经打印两张小样", can_undo: false }),
    ]);
    if (kind === "task")
      expect(readRecords(reloaded, "task").find((row) => row.id === id)?.title).toBe("后来改的标题");
    else expect(reloaded.readText(targetFile)).toContain("后来改的标题");
  },
);

it.each(["task", "status"] as const)(
  "%s confirms a written undo after a later edit without reverting that edit",
  async (kind) => {
    const { ws, action, id, targetFile } = await setup(kind);
    await deliver(ws, action);
    const undo = envelope("undo_next_result", { completion_id: action.client_id });
    const original = ws.writeJson.bind(ws);
    const failure = vi.spyOn(ws, "writeJson").mockImplementation((path, value, options) => {
      if (
        path === ".kaitu/phone-actions.json" &&
        (value as Record<string, { status?: string }>)[undo.client_id]?.status === "applied"
      )
        throw new Error("synthetic undo final persistence failure");
      return original(path, value, options);
    });
    await expect(deliver(ws, undo)).rejects.toThrow("synthetic undo final");
    failure.mockRestore();
    if (kind === "task") updateRecord(ws, "task", id, { title: "撤销之后的新标题" }, { by: "agent" });
    else {
      const doc = parseFrontmatter<{ next: { id: string; title: string }[] }>(ws.readText(targetFile));
      const item = doc.data.next.find((row) => row.id === id);
      if (!item) throw new Error("missing target");
      item.title = "撤销之后的新标题";
      ws.writeText(targetFile, stringifyFrontmatter(doc.data, doc.body));
    }
    const reloaded = new Workspace(ws.root, { maintain: false });
    await deliver(reloaded, undo);
    expect(receipt(reloaded, undo.client_id)).toMatchObject({
      status: "applied",
      result: { status: "undone" },
    });
    expect(phoneResults(reloaded)).toEqual([]);
    if (kind === "task")
      expect(readRecords(reloaded, "task").find((row) => row.id === id)?.title).toBe("撤销之后的新标题");
    else expect(reloaded.readText(targetFile)).toContain("撤销之后的新标题");
  },
);

it.each(["array", "scalar"] as const)(
  "normalizes %s preconditions consistently and restores raw shorthand without changing other items",
  async (shape) => {
    const ws = await clonedWorkspace();
    const path = "health/STATUS.md";
    const doc = parseFrontmatter<Record<string, unknown>>(ws.readText(path));
    const first = { id: "  raw-id  ", title: "  原始标题  " };
    doc.data.next = shape === "array" ? [first, "  独立简写  "] : "  原始标题  ";
    const original = doc.data.next;
    ws.writeText(path, stringifyFrontmatter(doc.data, doc.body));
    await writePhoneSnapshots(ws, new Date(), { force: true });
    const today = ws.readJson<{ next: { id: string; file: string; source_precondition: object }[] }>(
      "phone/today.json",
    );
    const next = today.next.find((item) => item.file === path);
    expect(next).toBeDefined();
    if (!next) throw new Error("missing projected target");
    const complete = envelope("complete_next_result", {
      file: path,
      id: next.id,
      expected_next: next.source_precondition,
      result_text: "真实结果",
    });
    await deliver(ws, complete);
    expect(receipt(ws, complete.client_id)?.status).toBe("applied");
    if (shape === "array")
      expect(parseFrontmatter<{ next: unknown[] }>(ws.readText(path)).data.next[1]).toBe("  独立简写  ");
    await deliver(ws, envelope("undo_next_result", { completion_id: complete.client_id }));
    expect(parseFrontmatter<Record<string, unknown>>(ws.readText(path)).data.next).toEqual(original);
    // The old action remains compatible with both canonical snapshots and raw legacy arrays.
    await deliver(
      ws,
      envelope("complete_next", { file: path, id: next.id, expected_next: next.source_precondition }),
    );
    expect(parseFrontmatter<{ next: { status: string }[] }>(ws.readText(path)).data.next[0].status).toBe(
      "done",
    );
  },
);

it.each([false, true])(
  "new STATUS completion owns undo even when its final journal save fails=%s",
  async (loseReply) => {
    const { ws, action, targetFile, id } = await setup("status");
    const fixed = new Date().toISOString();
    const clock = vi.spyOn(Date.prototype, "toISOString").mockReturnValue(fixed);
    try {
      await deliver(ws, action);
      const reopen = () => {
        const doc = parseFrontmatter<{ next: { id: string; status: string }[] }>(ws.readText(targetFile));
        const item = doc.data.next.find((row) => row.id === id);
        if (!item) throw new Error("missing target");
        item.status = "todo";
        ws.writeText(targetFile, stringifyFrontmatter(doc.data, doc.body));
        return item;
      };
      const expected = reopen();
      const b = envelope("complete_next_result", {
        file: targetFile,
        id,
        expected_next: expected,
        result_text: "后一次真实结果",
      });
      const original = ws.writeJson.bind(ws);
      const failure = loseReply
        ? vi.spyOn(ws, "writeJson").mockImplementation((path, value, options) => {
            if (
              path === ".kaitu/phone-actions.json" &&
              (value as Record<string, { status?: string }>)[b.client_id]?.status === "applied"
            )
              throw new Error("synthetic B final failure");
            return original(path, value, options);
          })
        : undefined;
      if (loseReply) await expect(deliver(ws, b)).rejects.toThrow("synthetic B");
      else await deliver(ws, b);
      failure?.mockRestore();
      const oldUndo = envelope("undo_next_result", { completion_id: action.client_id });
      await deliver(new Workspace(ws.root, { maintain: false }), oldUndo);
      expect(receipt(ws, oldUndo.client_id)?.status).toBe("conflict");
      expect(
        parseFrontmatter<{ next: { id: string; status: string }[] }>(ws.readText(targetFile)).data.next.find(
          (row) => row.id === id,
        )?.status,
      ).toBe("done");
      await deliver(new Workspace(ws.root, { maintain: false }), b);
      expect(phoneResults(ws)).toEqual([
        expect.objectContaining({ completion_id: b.client_id, text: "后一次真实结果" }),
      ]);
      await deliver(ws, envelope("undo_next_result", { completion_id: b.client_id }));
      expect(phoneResults(ws)).toEqual([]);
      const doc = parseFrontmatter<{ next: { id: string; status: string }[] }>(ws.readText(targetFile));
      const item = doc.data.next.find((row) => row.id === id);
      if (!item) throw new Error("missing target");
      item.status = "done";
      ws.writeText(targetFile, stringifyFrontmatter(doc.data, doc.body));
      expect(phoneResults(ws)).toEqual([]); // Undo B must not resurrect old A evidence.
    } finally {
      clock.mockRestore();
    }
  },
);

it("escapes arbitrary STATUS identities in Markdown ownership markers", async () => {
  const { ws, targetFile } = await setup("status");
  const doc = parseFrontmatter<{ next: { id: string; title: string; status: string }[] }>(
    ws.readText(targetFile),
  );
  const item = { id: "odd-->中\u2028identity", title: "合成标题", status: "todo" };
  doc.data.next = [item];
  ws.writeText(targetFile, stringifyFrontmatter(doc.data, doc.body));
  const complete = envelope("complete_next_result", {
    file: targetFile,
    id: item.id,
    expected_next: item,
    result_text: "真实结果",
  });
  await deliver(ws, complete);
  expect(phoneResults(ws)).toEqual([expect.objectContaining({ id: item.id, can_undo: true })]);
  await deliver(ws, envelope("undo_next_result", { completion_id: complete.client_id }));
  expect(phoneResults(ws)).toEqual([]);
});

it("uses the same Unicode code-point result limit as the JSON schema", async () => {
  const { ws, action } = await setup("task", "😀".repeat(1001));
  const validate = schemas().builtin("phone-action.schema.json");
  expect(validate(action)).toBe(true);
  await deliver(ws, action);
  expect(receipt(ws, action.client_id)?.status).toBe("applied");
  expect(phoneResults(ws)[0].text).toBe("😀".repeat(1001));
  expect(validate({ ...action, args: { ...action.args, result_text: "😀".repeat(2001) } })).toBe(false);
});

it.each(["task", "status"] as const)(
  "%s preserves raw multiline result while safely framing machine-looking content",
  async (kind) => {
    const raw =
      '  First line\r\nOriginal details retained.\n<!-- {"op":"complete_next_result","client_id":"injected","id":"sample-step"} -->\u2028事项：sample-step\n完成时间：2000-01-01T00:00:00Z\n  ';
    const { ws, action, targetFile, id } = await setup(kind, raw);
    const validate = schemas().builtin("phone-action.schema.json");
    expect(validate(action), JSON.stringify(validate.errors)).toBe(true);
    await deliver(ws, action);
    const reloaded = new Workspace(ws.root, { maintain: false });
    expect(phoneResults(reloaded)).toEqual([expect.objectContaining({ text: raw, can_undo: true })]);
    await writePhoneSnapshots(reloaded, new Date(), { force: true });
    expect(
      reloaded.readJson<{ mobile: { results: { text: string }[] } }>("phone/today.json").mobile.results[0]
        .text,
    ).toBe(raw);
    if (kind === "task")
      expect(readRecords(reloaded, "task").find((row) => row.id === id)?.notes).toContain(
        "    Original details retained.",
      );
    else expect(reloaded.readText(targetFile)).toContain("    Original details retained.");
    await deliver(reloaded, envelope("undo_next_result", { completion_id: action.client_id }));
    expect(phoneResults(reloaded)).toEqual([]);
  },
);

it("task re-completion with identical text and timestamp exposes only its newest persisted revision", async () => {
  const { ws, action, id } = await setup("task");
  const fixed = new Date().toISOString();
  const clock = vi.spyOn(Date.prototype, "toISOString").mockReturnValue(fixed);
  try {
    await deliver(ws, action);
    updateRecord(ws, "task", id, { status: "open" }, { by: "user" });
    const b = envelope("complete_next_result", { ...action.args, expected_rev: 3 });
    await deliver(ws, b);
    expect(phoneResults(ws)).toEqual([
      expect.objectContaining({ completion_id: b.client_id, can_undo: true }),
    ]);
    const oldUndo = envelope("undo_next_result", { completion_id: action.client_id });
    await deliver(ws, oldUndo);
    expect(receipt(ws, oldUndo.client_id)?.status).toBe("conflict");
    await deliver(ws, envelope("undo_next_result", { completion_id: b.client_id }));
    updateRecord(ws, "task", id, { status: "done" }, { by: "agent" });
    expect(phoneResults(ws)).toEqual([]);
  } finally {
    clock.mockRestore();
  }
});

it("reads and undoes already-persisted single-line task results from the prior candidate", async () => {
  const { ws, action, id } = await setup("task");
  const before = readRecords(ws, "task").find((row) => row.id === id);
  if (!before) throw new Error("missing task");
  const at = new Date().toISOString();
  const text = "旧候选的真实结果";
  const after = updateRecord(
    ws,
    "task",
    id,
    { status: "done", notes: `原始备注\n完成结果：${text}\n完成时间：${at}\n` },
    { by: "user" },
  ).record;
  ws.writeJson(
    ".kaitu/phone-actions.json",
    {
      [action.client_id]: {
        status: "applied",
        resultAction: { op: action.op, args: { ...action.args, result_text: text } },
        result: { completion_id: action.client_id, status: "completed" },
        nextResult: {
          completion_id: action.client_id,
          id,
          file: "task",
          title: String(before.title),
          text,
          completed_at: at,
          change: { kind: "task", before, after },
        },
      },
    },
    { internal: true },
  );
  const reloaded = new Workspace(ws.root, { maintain: false });
  expect(phoneResults(reloaded)).toEqual([expect.objectContaining({ text, can_undo: true })]);
  await deliver(reloaded, envelope("undo_next_result", { completion_id: action.client_id }));
  expect(phoneResults(reloaded)).toEqual([]);
  expect(readRecords(reloaded, "task").find((row) => row.id === id)?.status).toBe("open");
});
