import { basename } from "node:path";
import { expect, it, vi } from "vitest";
import { parseFrontmatter, stringifyFrontmatter } from "../src/frontmatter.js";
import { phoneReceipts, processInbox, readRecords, schemas, writePhoneSnapshots } from "../src/index.js";
import { applyPhoneActions } from "../src/phone-actions.js";
import { ulid } from "../src/ulid.js";
import { freshWorkspace } from "./helpers.js";

const envelope = (op: string, args: object) => ({
  client_id: ulid(),
  at: new Date().toISOString(),
  device: "1234abcd",
  op,
  args,
});
const file = () => `inbox/agents/ios-1234abcd-${ulid()}.actions.jsonl`;

it("手机稳定待办经真实收件箱创建、修改、完成；重投幂等且陈旧修订不覆盖", async () => {
  const ws = await freshWorkspace();
  const id = ulid();
  const actions = [
    envelope("create_task", { id, title: "合成待办", expected_rev: 0 }),
    envelope("update_task", { id, title: "改过的待办", expected_rev: 1 }),
    envelope("complete_task", { id, expected_rev: 2 }),
  ];
  const path = file();
  ws.writeText(path, actions.map((a) => JSON.stringify(a)).join("\n"));
  await processInbox(ws, { stableMs: 0 });
  expect(readRecords(ws, "task").find((r) => r.id === id)).toMatchObject({
    title: "改过的待办",
    status: "done",
    rev: 3,
  });
  expect(phoneReceipts(ws).find((r) => r.ref === actions[2].client_id)?.target).toEqual({ id, rev: 3 });
  ws.writeText(path, actions.map((a) => JSON.stringify(a)).join("\n"));
  await processInbox(ws, { stableMs: 0 });
  expect(phoneReceipts(ws).find((r) => r.ref === actions[0].client_id)?.status).toBe("duplicate");
  const stale = envelope("update_task", { id, title: "过期内容", expected_rev: 1 });
  await applyPhoneActions(ws, file(), JSON.stringify(stale));
  expect(phoneReceipts(ws).find((r) => r.ref === stale.client_id)?.status).toBe("conflict");
  expect(readRecords(ws, "task").find((r) => r.id === id)?.title).toBe("改过的待办");
  await writePhoneSnapshots(ws, new Date(), { force: true });
  const today = ws.readJson<{ mobile: { tasks: object[] } }>("phone/today.json");
  expect(today.mobile.tasks).toContainEqual(expect.objectContaining({ id, status: "done", rev: 3 }));
  const validate = schemas().builtin("phone-today.schema.json");
  expect(validate(today), JSON.stringify(validate.errors)).toBe(true);
});

it("追加成功但账本落盘失败可恢复；下一步精确前提冲突，保留对端内容", async () => {
  const ws = await freshWorkspace();
  const action = envelope("create_task", { id: ulid(), title: "合成恢复待办", expected_rev: 0 });
  const original = ws.writeJson.bind(ws);
  const write = vi.spyOn(ws, "writeJson").mockImplementation((name, value, options) => {
    if (
      name === ".kaitu/phone-actions.json" &&
      (value as Record<string, { status?: string }>)[action.client_id]?.status === "applied"
    )
      throw new Error("synthetic ledger persistence failure");
    return original(name, value, options);
  });
  await expect(applyPhoneActions(ws, file(), JSON.stringify(action))).rejects.toThrow("synthetic ledger");
  write.mockRestore();
  await applyPhoneActions(ws, file(), JSON.stringify(action));
  expect(readRecords(ws, "task").filter((r) => r.id === action.args.id)).toHaveLength(1);
  expect(phoneReceipts(ws).find((r) => r.ref === action.client_id)?.target).toEqual({
    id: action.args.id,
    rev: 1,
  });
  const path = "health/STATUS.md";
  const parsed = parseFrontmatter<{ next: { id: string; title: string; status: string }[] }>(
    ws.readText(path),
  );
  parsed.data.next = [{ id: "next-synthetic", title: "原下一步", status: "todo" }];
  ws.writeText(path, stringifyFrontmatter(parsed.data, parsed.body));
  await writePhoneSnapshots(ws, new Date(), { force: true });
  const projection = ws.readJson<{ next: { id: string; source_precondition: object }[] }>("phone/today.json");
  const expected = projection.next.find((r) => r.id === "next-synthetic")?.source_precondition;
  expect(expected).toBeDefined();
  parsed.data.next = [{ id: "next-synthetic", title: "对端已改", status: "todo" }];
  ws.writeText(path, stringifyFrontmatter(parsed.data, parsed.body));
  const complete = envelope("complete_next", { id: "next-synthetic", file: path, expected_next: expected });
  await applyPhoneActions(ws, file(), JSON.stringify(complete));
  expect(phoneReceipts(ws).find((r) => r.ref === complete.client_id)?.status).toBe("conflict");
  expect(ws.readText(path)).toContain("对端已改");
  const reserved = envelope("create_task", {
    id: ulid(),
    title: "不能伪造保留字段",
    expected_rev: 0,
    by: "user",
    rev: 8,
  });
  const rejected = file();
  await applyPhoneActions(ws, rejected, JSON.stringify(reserved));
  expect(phoneReceipts(ws).find((r) => r.ref === basename(rejected))?.status).toBe("rejected");
});
