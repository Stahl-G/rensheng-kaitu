import { expect, it, vi } from "vitest";
import {
  Workspace,
  listMemories,
  memoryExpectation,
  phoneReceipts,
  processInbox,
  readRecords,
  schemas,
  validateWorkspace,
  writePhoneSnapshots,
} from "../src/index.js";
import { applyPhoneActions } from "../src/phone-actions.js";
import { ulid } from "../src/ulid.js";
import { clonedWorkspace } from "./helpers.js";

function observation() {
  return {
    client_id: ulid(),
    at: new Date().toISOString(),
    device: "3fa9c1d2",
    origin: "assistant",
    op: "capture_memory",
    args: {
      idempotency_key: ulid(),
      type: "preference",
      name: "合成地图偏好",
      text: "我喜欢纸质地图",
      source: "synthetic-ios/message-1",
      origin: "user-stated",
      observed_at: "2026-10-26T10:00:00+08:00",
      evidence: "我喜欢纸质地图",
      scope: "personal",
    },
  };
}
const filename = () => `inbox/agents/ios-3fa9c1d2-${ulid()}.actions.jsonl`;
const apply = (ws: Workspace, action: unknown) => applyPhoneActions(ws, filename(), JSON.stringify(action));
const receipt = (ws: Workspace, id: string) => phoneReceipts(ws).find((item) => item.ref === id);

it.each([true, false])("手机按已发布能力撤销自动记忆并恢复原条（有待办类型：%s）", async (hasTasks) => {
  const ws = await clonedWorkspace();
  if (!hasTasks) {
    const module = ws.readJson<{ records: Record<string, unknown> }>("me/module.json");
    module.records.task = undefined;
    ws.writeJson("me/module.json", module);
  }
  const deliver = async (action: { client_id: string; device: string; op: string }) => {
    await writePhoneSnapshots(ws, new Date(), { force: true });
    const today = ws.readJson<{ mobile: { actions: string[] } }>("phone/today.json");
    if (!today.mobile.actions.includes(action.op)) throw new Error(`手机不能投递未声明的 ${action.op}`);
    const file = `inbox/agents/ios-${action.device}-${action.client_id}.actions.jsonl`;
    ws.writeText(file, JSON.stringify(action));
    expect((await processInbox(ws, { stableMs: 0 })).processed).toContain(file);
    return receipt(ws, action.client_id);
  };
  await deliver(observation());
  const original = listMemories(ws)[0];
  const correction = observation();
  const corrected = {
    ...correction,
    args: {
      ...correction.args,
      text: "更正为电子地图",
      evidence: "更正为电子地图",
      replaces: original.file,
      expected: memoryExpectation(original),
    },
  };
  await deliver(corrected);
  const replacement = listMemories(ws)[0];
  const undo = {
    ...observation(),
    op: "replace_memory",
    args: { file: replacement.file, candidate: null, expected: memoryExpectation(replacement) },
  };
  expect(await deliver(undo)).toMatchObject({ status: "applied" });
  expect(listMemories(new Workspace(ws.root)).map((entry) => entry.file)).toEqual([original.file]);
  expect(await deliver(corrected)).toMatchObject({
    status: "duplicate",
    memory: { file: replacement.file, status: "undone" },
  });
});

it("手机能力声明后经真实收件箱落盘，保留写者与事实来源，重复和重开可回读同一文件", async () => {
  const ws = await clonedWorkspace();
  await writePhoneSnapshots(ws, new Date(), { force: true });
  expect(ws.readJson<{ mobile: { actions: string[] } }>("phone/today.json").mobile.actions).toContain(
    "capture_memory",
  );
  const action = observation();
  const file = filename();
  ws.writeText(file, JSON.stringify(action));
  expect((await processInbox(ws, { settleMs: 0 })).processed).toContain(file);
  const stored = listMemories(new Workspace(ws.root))[0];
  expect(stored).toMatchObject({
    text: action.args.text,
    source: action.args.source,
    origin: action.args.origin,
    evidence: action.args.evidence,
    observed_at: action.args.observed_at,
  });
  expect(receipt(ws, action.client_id)).toMatchObject({
    status: "applied",
    memory: { file: stored.file, status: "saved" },
  });
  expect(receipt(ws, action.client_id)?.target).toBeUndefined();
  await apply(new Workspace(ws.root), action);
  expect(receipt(ws, action.client_id)).toMatchObject({
    status: "duplicate",
    memory: { file: stored.file, status: "duplicate" },
  });
  expect(listMemories(ws)).toHaveLength(1);
  expect(schemas().builtin("phone-receipts.schema.json")(ws.readJson("phone/receipts.json"))).toBe(true);
  expect(validateWorkspace(ws)).toEqual([]);
});

it("手机纠正追加原话、拒绝陈旧前提，撤销只归档该条；旧操作重试不复活或改动后来资料", async () => {
  const ws = await clonedWorkspace();
  const first = observation();
  await apply(ws, { ...first, args: { ...first.args, sensitive: true } });
  const old = listMemories(ws)[0];
  const original = ws.readText(`memory/${old.file}`);
  const next = observation();
  const correction = {
    ...next,
    args: { ...next.args, text: "更正为电子地图", replaces: old.file, expected: memoryExpectation(old) },
  };
  await apply(ws, correction);
  const current = listMemories(ws)[0];
  expect(current).toMatchObject({ text: "更正为电子地图", sensitive: true, replaces: old.file });
  expect(ws.readText(`memory/${old.file}`)).toBe(original);
  await apply(ws, { ...first, args: { ...first.args, sensitive: true } });
  expect(receipt(ws, first.client_id)?.memory?.status).toBe("superseded");
  const stale = observation();
  await apply(ws, { ...stale, args: { ...correction.args, idempotency_key: stale.args.idempotency_key } });
  expect(receipt(ws, stale.client_id)?.status).toBe("conflict");
  const later = observation();
  await apply(ws, later);
  await apply(ws, {
    ...observation(),
    op: "replace_memory",
    args: { file: current.file, candidate: null, expected: memoryExpectation(current) },
  });
  await apply(new Workspace(ws.root), correction);
  expect(receipt(ws, correction.client_id)?.memory).toEqual({ file: current.file, status: "undone" });
  expect(
    listMemories(ws)
      .map((entry) => entry.file)
      .sort(),
  ).toEqual([old.file, receipt(ws, later.client_id)?.memory?.file].sort());
  // A different consumer has receipts but no local ledger: the persisted file still decides its state.
  ws.writeJson(".kaitu/phone-actions.json", {}, { internal: true });
  await apply(new Workspace(ws.root), correction);
  expect(receipt(ws, correction.client_id)?.memory?.status).toBe("undone");
});

it("文件成功而操作账本失败后重开恢复，不重复写；首次client_id不能换载荷或操作类型", async () => {
  const ws = await clonedWorkspace();
  const action = observation();
  const original = ws.writeJson.bind(ws);
  const interrupted = vi.spyOn(ws, "writeJson").mockImplementation((path, value, options) => {
    const row = (value as Record<string, { status?: string }>)[action.client_id];
    if (path === ".kaitu/phone-actions.json" && row?.status) throw new Error("synthetic receipt failure");
    return original(path, value, options);
  });
  await expect(apply(ws, action)).rejects.toThrow("synthetic receipt failure");
  interrupted.mockRestore();
  const reopened = new Workspace(ws.root);
  const file = listMemories(reopened)[0].file;
  await apply(reopened, { ...action, args: { ...action.args, idempotency_key: "changed", text: "异文" } });
  expect(receipt(reopened, action.client_id)?.status).toBe("conflict");
  await apply(reopened, { ...action, op: "complete_task", args: { id: ulid() } });
  expect(receipt(reopened, action.client_id)?.status).toBe("conflict");
  await apply(new Workspace(ws.root), action);
  expect(receipt(reopened, action.client_id)).toMatchObject({
    status: "duplicate",
    memory: { file, status: "duplicate" },
  });
  expect(listMemories(new Workspace(ws.root))).toHaveLength(1);
});

it("AI建议保留不确定性且不变承诺；跳过/冲突/非法写者均不伪报应用成功", async () => {
  const ws = await clonedWorkspace();
  const suggestion = observation();
  await apply(ws, {
    ...suggestion,
    args: { ...suggestion.args, origin: "ai-suggestion", type: "decision", uncertainty: "尚未采纳" },
  });
  expect(listMemories(ws)[0]).toMatchObject({ type: "context", origin: "ai-suggestion" });
  for (const scope of ["temporary", "quoted", "hypothetical"]) {
    const action = observation();
    await apply(ws, { ...action, args: { ...action.args, scope } });
    expect(receipt(ws, action.client_id)?.status).toBe("rejected");
  }
  const conflict = observation();
  await apply(ws, { ...conflict, args: { ...conflict.args, conflict: "同一时刻两个重量" } });
  expect(receipt(ws, conflict.client_id)?.status).toBe("conflict");
  const missing = observation();
  const missingUncertainty = { ...missing, args: { ...missing.args, origin: "ai-estimate" } };
  await apply(ws, missingUncertainty);
  await apply(new Workspace(ws.root), missingUncertainty);
  expect(receipt(ws, missing.client_id)?.status).toBe("conflict");
  expect(Object.keys(receipt(ws, missing.client_id) ?? {}).sort()).toEqual(
    ["ref", "kind", "status", "at", "message"].sort(),
  );
  const validate = schemas().builtin("phone-action.schema.json");
  expect(validate({ ...observation(), origin: "user" })).toBe(false);
  const unsafe = observation();
  expect(validate({ ...unsafe, args: { ...unsafe.args, ended: "2026-10-26" } })).toBe(false);
  expect(listMemories(ws)).toHaveLength(1);
  expect(readRecords(ws, "task")).toHaveLength(0);
  expect(readRecords(ws, "event")).toHaveLength(0);
});
