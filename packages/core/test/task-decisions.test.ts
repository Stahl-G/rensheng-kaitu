import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import {
  Workspace,
  addRecord,
  phoneReceipts,
  processInbox,
  readHome,
  readHomeSources,
  readRecords,
  schemas,
  updateRecord,
  writePhoneSnapshots,
} from "../src/index.js";
import { applyPhoneActions } from "../src/phone-actions.js";
import { readRecordRevisions } from "../src/records.js";
import {
  type TaskDecisionAction,
  applyTaskDecision,
  taskDecisionContext,
  taskDecisions,
} from "../src/task-decisions.js";
import { ulid } from "../src/ulid.js";
import { clonedWorkspace } from "./helpers.js";

const inboxFile = () => `inbox/agents/ios-1234abcd-${ulid()}.actions.jsonl`;
const deliver = (ws: Workspace, action: TaskDecisionAction) =>
  applyPhoneActions(
    ws,
    inboxFile(),
    JSON.stringify({ ...action, device: "1234abcd", at: new Date().toISOString() }),
  );
async function setup(decision: "adopted" | "dismissed" = "dismissed", client_id = ulid()) {
  const ws = await clonedWorkspace();
  const original = addRecord(ws, "task", {
    title: "给合成项目寄两张小样",
    notes: "保留建议原话",
    source: "me/goals.json#synthetic-only",
  }).record;
  const action: TaskDecisionAction = {
    client_id,
    op: "decide_task",
    args: {
      ...taskDecisionContext(ws),
      file: "me/tasks/2026-11.jsonl",
      id: original.id,
      expected_rev: original.rev ?? 1,
      expected_source: String(original.source),
      decision,
    },
  };
  // Use the actual created month rather than the test runner's clock.
  await writePhoneSnapshots(ws, new Date(), { force: true });
  action.args = {
    ...action.args,
    file: ws
      .readJson<{ mobile: { tasks: { id: string; file: string }[] } }>("phone/today.json")
      .mobile.tasks.find((task) => task.id === original.id)?.file,
  } as typeof action.args;
  return { ws, original, action };
}
const undo = (ws: Workspace, decision_id: string): TaskDecisionAction => ({
  client_id: ulid(),
  op: "undo_task_decision",
  args: { ...taskDecisionContext(ws), decision_id },
});
const receipt = (ws: Workspace, id: string) => phoneReceipts(ws).find((item) => item.ref === id);
const current = (ws: Workspace, id: string) => readRecords(ws, "task").find((row) => row.id === id);

it.each(["adopted", "dismissed"] as const)(
  "%s persists through actual inbox, restart, snapshot, and one undo",
  async (decision) => {
    const { ws, original, action } = await setup(decision);
    const pending = readHome(await readHomeSources(ws)).pending.find((item) => item.id === original.id);
    expect(pending).toMatchObject({
      rev: 1,
      source: original.source,
      file: (action.args as { file: string }).file,
    });
    const path = inboxFile();
    ws.writeText(path, JSON.stringify({ ...action, device: "1234abcd", at: new Date().toISOString() }));
    await processInbox(ws, { stableMs: 0 });
    let reloaded = new Workspace(ws.root, { maintain: false });
    expect(current(reloaded, original.id)?.status).toBe(decision === "adopted" ? "open" : "cancelled");
    expect(readHome(await readHomeSources(reloaded)).pending.some((item) => item.id === original.id)).toBe(
      false,
    );
    expect(receipt(reloaded, action.client_id)).toMatchObject({
      status: "applied",
      decision: { decision_id: action.client_id, status: decision },
    });
    expect(taskDecisions(reloaded)).toEqual([
      expect.objectContaining({
        decision_id: action.client_id,
        id: original.id,
        source: original.source,
        rev: 2,
        status: decision,
        can_undo: true,
      }),
    ]);
    await writePhoneSnapshots(reloaded, new Date(), { force: true });
    const today = reloaded.readJson<{
      mobile: { actions: string[]; results: unknown[]; task_decisions: unknown[] };
    }>("phone/today.json");
    expect(today.mobile.actions).toEqual(expect.arrayContaining(["decide_task", "undo_task_decision"]));
    expect(today.mobile.task_decisions).toEqual(taskDecisions(reloaded));
    expect(today.mobile.results).toEqual([]);
    for (const [schema, value] of [
      ["phone-today.schema.json", today],
      ["phone-receipts.schema.json", reloaded.readJson("phone/receipts.json")],
    ] as const) {
      const validate = schemas().builtin(schema);
      expect(validate(value), JSON.stringify(validate.errors)).toBe(true);
    }
    await deliver(reloaded, action);
    expect(receipt(reloaded, action.client_id)?.status).toBe("duplicate");
    const reversal = undo(reloaded, action.client_id);
    await deliver(reloaded, reversal);
    reloaded = new Workspace(ws.root, { maintain: false });
    expect(current(reloaded, original.id)).toEqual({ ...original, by: "user", rev: 3 });
    expect(readRecordRevisions(reloaded, "task").filter((row) => row.id === original.id)).toHaveLength(3);
    expect(taskDecisions(reloaded)[0]).toMatchObject({ status: "undone", can_undo: false });
    await deliver(reloaded, reversal);
    await deliver(reloaded, action);
    expect(receipt(reloaded, action.client_id)).toMatchObject({
      status: "duplicate",
      decision: { status: "undone" },
    });
    const secondUndo = undo(reloaded, action.client_id);
    await deliver(reloaded, secondUndo);
    expect(receipt(reloaded, secondUndo.client_id)).toMatchObject({
      status: "duplicate",
      target: { rev: 3 },
      decision: { status: "undone" },
    });
    await deliver(reloaded, secondUndo);
    expect(receipt(reloaded, secondUndo.client_id)).toMatchObject({
      status: "duplicate",
      target: { rev: 3 },
      decision: { decision_id: action.client_id, status: "undone" },
    });
    expect(readRecordRevisions(reloaded, "task").filter((row) => row.id === original.id)).toHaveLength(3);
  },
);

it("native UUID and phone ULID share persisted decisions, exact payload binding, and CAS conflicts", async () => {
  const { ws, original, action } = await setup("adopted", randomUUID());
  expect(applyTaskDecision(ws, action)).toMatchObject({ status: "applied", decision: { status: "adopted" } });
  const reloaded = new Workspace(ws.root, { maintain: false });
  expect(applyTaskDecision(reloaded, action).status).toBe("duplicate");
  const changed = { ...action, args: { ...action.args, decision: "dismissed" } } as TaskDecisionAction;
  expect(applyTaskDecision(reloaded, changed).status).toBe("conflict");
  expect(applyTaskDecision(reloaded, { ...action, client_id: ulid() }).status).toBe("conflict");
  updateRecord(reloaded, "task", original.id, { notes: "用户后来编辑，不能被撤销吞掉" }, { by: "user" });
  expect(taskDecisions(reloaded)[0]?.can_undo).toBe(false);
  expect(applyTaskDecision(reloaded, undo(reloaded, action.client_id)).status).toBe("conflict");
  expect(current(reloaded, original.id)?.notes).toBe("用户后来编辑，不能被撤销吞掉");
  expect(applyTaskDecision(reloaded, { ...action, client_id: "../../escape" }).status).toBe("rejected");
});

it("wrong workspace, source, file, stale revision, duplicate ID across files and competing same revision never overwrite", async () => {
  const { ws, original, action } = await setup();
  for (const patch of [
    { consumer_id: randomUUID() },
    { expected_source: "me/goals.json#other" },
    { file: "health/STATUS.md" },
    { expected_rev: 55 },
  ]) {
    const attempt = {
      ...action,
      client_id: ulid(),
      args: { ...action.args, ...patch },
    } as TaskDecisionAction;
    expect(applyTaskDecision(ws, attempt).status).toBe("conflict");
    expect(current(ws, original.id)).toEqual(original);
  }
  const other = await clonedWorkspace();
  expect(applyTaskDecision(other, action).status).toBe("conflict");
  ws.appendLine("me/data/tasks/2000-01.jsonl", JSON.stringify({ ...original, title: "另一文件的同ID" }));
  expect(applyTaskDecision(ws, action).status).toBe("conflict");
  expect(taskDecisions(ws)).toEqual([]);
  const separate = await setup();
  const originalAppend = separate.ws.appendLine.bind(separate.ws);
  const injected = vi.spyOn(separate.ws, "appendLine").mockImplementation((file, text, options) => {
    if (file === (separate.action.args as { file: string }).file) {
      originalAppend(
        file,
        JSON.stringify({ ...separate.original, rev: 2, by: "user", title: "外部并发编辑" }),
        options,
      );
      injected.mockRestore();
    }
    return originalAppend(file, text, options);
  });
  expect(applyTaskDecision(separate.ws, separate.action).status).toBe("conflict");
  expect(taskDecisions(separate.ws)).toEqual([]);
  expect(readRecordRevisions(separate.ws, "task").some((row) => row.title === "外部并发编辑")).toBe(true);
});

it.each([
  "prepare-before",
  "prepare-after",
  "append-before",
  "append-after",
  "terminal-before",
  "terminal-after",
  "receipt-before",
  "receipt-after",
] as const)(
  "restarts after every %s boundary of decision and undo without duplicate revision",
  async (boundary) => {
    const { ws, original, action } = await setup();
    let active = ws;
    for (const operation of [action, undo(ws, action.client_id)]) {
      let failed = false;
      const saveJson = active.writeJson.bind(active);
      const append = active.appendLine.bind(active);
      const json = vi.spyOn(active, "writeJson").mockImplementation((file, value, options) => {
        const entry = (value as Record<string, { status?: string }>)[operation.client_id];
        if (
          !failed &&
          ((boundary.startsWith("prepare-") &&
            file === ".kaitu/phone-actions.json" &&
            entry &&
            !entry.status) ||
            (boundary.startsWith("terminal-") &&
              file === ".kaitu/phone-actions.json" &&
              entry?.status === "applied") ||
            (boundary.startsWith("receipt-") && file === "phone/receipts.json"))
        ) {
          failed = true;
          if (boundary.endsWith("-after")) saveJson(file, value, options);
          throw new Error(`synthetic ${boundary}`);
        }
        return saveJson(file, value, options);
      });
      const writing = vi.spyOn(active, "appendLine").mockImplementation((file, text, options) => {
        if (
          !failed &&
          (boundary === "append-before" || boundary === "append-after") &&
          file === (action.args as { file: string }).file
        ) {
          failed = true;
          if (boundary === "append-after") append(file, text, options);
          throw new Error(`synthetic ${boundary}`);
        }
        return append(file, text, options);
      });
      expect(() => applyTaskDecision(active, operation)).toThrow(`synthetic ${boundary}`);
      json.mockRestore();
      writing.mockRestore();
      active = new Workspace(ws.root, { maintain: false });
      expect(applyTaskDecision(active, operation).status).toMatch(/applied|duplicate/);
      expect(applyTaskDecision(new Workspace(ws.root, { maintain: false }), operation).status).toBe(
        "duplicate",
      );
    }
    expect(current(active, original.id)).toEqual({ ...original, by: "user", rev: 3 });
    expect(readRecordRevisions(active, "task").filter((row) => row.id === original.id)).toHaveLength(3);
  },
);

it("lost terminal writes recover historical proof without undoing later edits, while legacy adopt stays compatible", async () => {
  const { ws, original, action } = await setup();
  const saveJson = ws.writeJson.bind(ws);
  const fail = vi.spyOn(ws, "writeJson").mockImplementation((file, value, options) => {
    if (
      file === ".kaitu/phone-actions.json" &&
      (value as Record<string, { status?: string }>)[action.client_id]?.status === "applied"
    )
      throw new Error("lost terminal");
    return saveJson(file, value, options);
  });
  expect(() => applyTaskDecision(ws, action)).toThrow("lost terminal");
  fail.mockRestore();
  updateRecord(ws, "task", original.id, { title: "后来编辑仍保留" }, { by: "user" });
  let restarted = new Workspace(ws.root, { maintain: false });
  expect(applyTaskDecision(restarted, action).status).toBe("applied");
  expect(taskDecisions(restarted)[0]?.can_undo).toBe(false);
  expect(current(restarted, original.id)?.title).toBe("后来编辑仍保留");
  const fresh = await setup("adopted");
  applyTaskDecision(fresh.ws, fresh.action);
  const reversal = undo(fresh.ws, fresh.action.client_id);
  const originalWrite = fresh.ws.writeJson.bind(fresh.ws);
  const failUndo = vi.spyOn(fresh.ws, "writeJson").mockImplementation((file, value, options) => {
    if (
      file === ".kaitu/phone-actions.json" &&
      (value as Record<string, { status?: string }>)[reversal.client_id]?.status === "applied"
    )
      throw new Error("lost undo terminal");
    return originalWrite(file, value, options);
  });
  expect(() => applyTaskDecision(fresh.ws, reversal)).toThrow("lost undo terminal");
  failUndo.mockRestore();
  updateRecord(fresh.ws, "task", fresh.original.id, { notes: "撤销后编辑" }, { by: "user" });
  restarted = new Workspace(fresh.ws.root, { maintain: false });
  expect(applyTaskDecision(restarted, reversal).status).toBe("applied");
  expect(current(restarted, fresh.original.id)?.notes).toBe("撤销后编辑");
  expect(taskDecisions(restarted)[0]).toMatchObject({ status: "undone", can_undo: false });
  const legacy = addRecord(restarted, "task", { title: "旧手机建议" }).record;
  await applyPhoneActions(
    restarted,
    inboxFile(),
    JSON.stringify({
      client_id: ulid(),
      device: "1234abcd",
      at: new Date().toISOString(),
      op: "adopt_task",
      args: { id: legacy.id },
    }),
  );
  expect(current(restarted, legacy.id)?.status).toBe("open");
});

it("legacy async task writes cannot erase a native decision or an undo of an existing ledger key", async () => {
  const { ws, action, original } = await setup("adopted");
  applyTaskDecision(ws, action);
  const native = await setup();
  // Another proposal in this same workspace, not the independent setup workspace.
  const proposal = addRecord(ws, "task", { title: "同步落盘的第二条合成建议" }).record;
  const second: TaskDecisionAction = {
    ...native.action,
    args: { ...action.args, id: proposal.id, expected_rev: 1, expected_source: null, decision: "dismissed" },
  } as TaskDecisionAction;
  const legacyId = ulid();
  const create = {
    client_id: ulid(),
    device: "1234abcd",
    at: new Date().toISOString(),
    op: "create_task",
    args: { id: legacyId, expected_rev: 0, title: "旧操作真实等待版本存储" },
  };
  let finished = false;
  const pending = applyPhoneActions(ws, inboxFile(), JSON.stringify(create)).then(() => {
    finished = true;
  });
  expect(finished).toBe(false);
  expect(current(ws, legacyId)?.title).toBe(create.args.title);
  expect(applyTaskDecision(ws, second).status).toBe("applied");
  const reversal = undo(ws, action.client_id);
  expect(applyTaskDecision(ws, reversal).status).toBe("applied");
  await pending;
  const reloaded = new Workspace(ws.root, { maintain: false });
  expect(applyTaskDecision(reloaded, action)).toMatchObject({
    status: "duplicate",
    decision: { status: "undone" },
  });
  expect(current(reloaded, original.id)?.status).toBe("proposed");
  expect(taskDecisions(reloaded)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ decision_id: action.client_id, status: "undone" }),
      expect.objectContaining({ decision_id: second.client_id, status: "dismissed", can_undo: true }),
    ]),
  );
  expect(receipt(reloaded, create.client_id)?.status).toBe("applied");
});

it("a different consumer leaves the inbox and existing successful/prepared receipt untouched", async () => {
  const { ws, action } = await setup();
  applyTaskDecision(ws, action);
  const priorLedger = ws.readText(".kaitu/phone-actions.json");
  const priorReceipts = ws.readText("phone/receipts.json");
  const foreign = { ...action, args: { ...action.args, consumer_id: randomUUID() } } as TaskDecisionAction;
  expect(applyTaskDecision(ws, foreign).status).toBe("conflict");
  const path = inboxFile();
  ws.writeText(path, JSON.stringify({ ...foreign, device: "1234abcd", at: new Date().toISOString() }));
  const result = await processInbox(ws, { stableMs: 0 });
  expect(result.pending).toContain(path);
  expect(ws.exists(path)).toBe(true);
  expect(ws.readText(".kaitu/phone-actions.json")).toBe(priorLedger);
  expect(ws.readText("phone/receipts.json")).toBe(priorReceipts);
  const fresh = await setup();
  const write = fresh.ws.writeJson.bind(fresh.ws);
  const stop = vi.spyOn(fresh.ws, "writeJson").mockImplementation((file, value, options) => {
    if (
      file === ".kaitu/phone-actions.json" &&
      (value as Record<string, { status?: string }>)[fresh.action.client_id]?.status
    )
      throw new Error("prepared only");
    return write(file, value, options);
  });
  expect(() => applyTaskDecision(fresh.ws, fresh.action)).toThrow("prepared only");
  stop.mockRestore();
  const prepared = fresh.ws.readText(".kaitu/phone-actions.json");
  const mismatch = {
    ...fresh.action,
    args: { ...fresh.action.args, consumer_id: randomUUID() },
  } as TaskDecisionAction;
  await deliver(fresh.ws, mismatch);
  expect(fresh.ws.readText(".kaitu/phone-actions.json")).toBe(prepared);
  expect(applyTaskDecision(new Workspace(fresh.ws.root, { maintain: false }), fresh.action).status).toBe(
    "applied",
  );
  const mixed = await setup();
  const mixedFile = inboxFile();
  const foreignLine = { ...mixed.action, args: { ...mixed.action.args, consumer_id: randomUUID() } };
  const encode = (value: unknown) =>
    JSON.stringify({ ...(value as object), device: "1234abcd", at: new Date().toISOString() });
  mixed.ws.writeText(mixedFile, [encode(foreignLine), encode(mixed.action)].join("\n"));
  const mixedResult = await processInbox(mixed.ws, { stableMs: 0 });
  expect(mixedResult.pending).toContain(mixedFile);
  expect(mixed.ws.exists(mixedFile)).toBe(true);
  expect(receipt(mixed.ws, mixed.action.client_id)).toMatchObject({
    status: "applied",
    decision: { status: "dismissed" },
  });
  expect(current(mixed.ws, mixed.original.id)?.status).toBe("cancelled");
});
