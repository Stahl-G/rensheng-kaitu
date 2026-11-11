import { rmSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
import { normalizeStatus } from "../src/doc-input.js";
import { parseFrontmatter, stringifyFrontmatter } from "../src/frontmatter.js";
import {
  Workspace,
  addRecord,
  buildPhoneToday,
  readOverviewPage,
  readRecordRevisions,
  readRecords,
  schemas,
  updateRecord,
} from "../src/index.js";
import { applyPhoneActions } from "../src/phone-actions.js";
import { phoneReceipts } from "../src/phone-receipts.js";
import {
  type ResultRequest,
  applyResultAction,
  collectResults,
  completionNotes,
  resultActivityDays,
  taskResult,
} from "../src/results.js";
import { ulid } from "../src/ulid.js";
import { clonedWorkspace } from "./helpers.js";

const roots: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
async function workspace() {
  const ws = await clonedWorkspace("Asia/Shanghai");
  roots.push(ws.root);
  return ws;
}
const request = (op: ResultRequest["op"], args: ResultRequest["args"]): ResultRequest => ({
  client_id: ulid(),
  op,
  args,
});
function task(ws: Workspace, by: "user" | "agent" = "user") {
  return addRecord(
    ws,
    "task",
    { title: "Synthetic next", status: "open", source: "me/goals.json#synthetic", notes: "原有来源\n" },
    { by },
  ).record;
}
const statusFile = "me/STATUS.md";
function status(ws: Workspace) {
  const entry = { id: "one", title: "Synthetic project step", status: "todo", custom: { keep: 3 } };
  ws.writeText(
    statusFile,
    stringifyFrontmatter(
      { updated: null, custom: "keep", next: [entry, { id: "two", title: "Independent", status: "todo" }] },
      "\r\n# Old body\r\n\n  untouched\t\r\n",
    ),
  );
  return entry;
}

it("shares task and STATUS results, counts local activity dates, preserves completion provenance after ordinary edits", async () => {
  const ws = await workspace();
  const first = task(ws);
  await applyResultAction(
    ws,
    request("complete_next_result", {
      file: "task",
      id: first.id,
      expected_rev: 1,
      result_text: "Finished task",
    }),
    new Date("2026-11-10T15:59:00Z"),
  );
  const before = status(ws);
  await applyResultAction(
    ws,
    request("complete_next_result", {
      file: statusFile,
      id: "one",
      expected_next: before,
      result_text: "Finished project",
    }),
    new Date("2026-11-10T15:59:30Z"),
  );
  updateRecord(ws, "task", first.id, { title: "New title", due: "2026-11-12" }, { by: "agent" });
  let rows = collectResults(ws);
  expect(rows).toHaveLength(2);
  expect(rows.find((row) => row.file === "task")).toMatchObject({
    by: "user",
    source: first.source,
    title: "New title",
  });
  expect(resultActivityDays(rows, ws.timeZone(), new Date("2026-11-11T01:00:00Z"))).toBe(1);
  const second = task(ws);
  await applyResultAction(
    ws,
    request("complete_next_result", {
      file: "task",
      id: second.id,
      expected_rev: 1,
      result_text: "After midnight",
    }),
    new Date("2026-11-10T16:01:00Z"),
  );
  rows = collectResults(ws);
  expect(resultActivityDays(rows, ws.timeZone(), new Date("2026-11-11T01:00:00Z"))).toBe(2);
  expect(resultActivityDays(rows, "UTC", new Date("2026-11-11T01:00:00Z"))).toBe(1);
  expect(resultActivityDays(rows, ws.timeZone(), new Date("2026-11-18T01:00:00Z"))).toBe(0);
  const ai = task(ws);
  updateRecord(
    ws,
    "task",
    ai.id,
    { status: "done", notes: completionNotes("", "AI result", "2026-11-11T01:00:00Z") },
    { by: "agent" },
  );
  updateRecord(ws, "task", ai.id, { title: "User title only" }, { by: "user" });
  expect(collectResults(ws).find((row) => row.id === ai.id)?.by).toBe("agent");
  const undated = task(ws);
  updateRecord(
    ws,
    "task",
    undated.id,
    { status: "done", notes: "完成结果：Old undated result" },
    { by: "user" },
  );
  const overview = await readOverviewPage(ws, new Date("2026-11-11T01:00:00Z"));
  const phone = buildPhoneToday(overview, "2026-11-11T01:00:00Z", ws);
  expect(phone.mobile.results.some((row) => row.id === undated.id)).toBe(false);
  expect(schemas().builtin("phone-today.schema.json")(phone)).toBe(true);
});

it("restores stored revisions by CAS, preserves history, and never replays an original completion after undo", async () => {
  const ws = await workspace();
  const original = task(ws);
  const action = request("complete_next_result", {
    file: "task",
    id: original.id,
    expected_rev: 1,
    result_text: "Done",
  });
  await applyResultAction(ws, action);
  await applyResultAction(
    ws,
    request("restore_task_revision", { id: original.id, expected_rev: 2, prior_rev: 1 }),
  );
  expect(collectResults(ws)).toHaveLength(0);
  expect((await applyResultAction(new Workspace(ws.root), action)).status).toBe("duplicate");
  expect(readRecordRevisions(ws, "task").filter((row) => row.id === original.id)).toHaveLength(3);
  expect(readRecords(ws, "task")[0]).toMatchObject({
    status: "open",
    rev: 3,
    notes: original.notes,
    source: original.source,
  });
  await expect(
    applyResultAction(ws, { ...action, args: { ...action.args, result_text: "Changed payload" } }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  updateRecord(ws, "task", original.id, { title: "Independent edit" }, { by: "user" });
  await expect(
    applyResultAction(
      ws,
      request("restore_task_revision", { id: original.id, expected_rev: 3, prior_rev: 1 }),
    ),
  ).rejects.toMatchObject({ code: "CONFLICT" });
});

it("STATUS undo preserves body bytes and independent edits, including unknown write recovery followed by undo", async () => {
  const ws = await workspace();
  const before = status(ws);
  const body = parseFrontmatter(ws.readText(statusFile)).body;
  const action = request("complete_next_result", {
    file: statusFile,
    id: "one",
    expected_next: before,
    result_text: "Completed",
  });
  const write = ws.writeText.bind(ws);
  const failure = vi.spyOn(ws, "writeText").mockImplementation((file, value, options) => {
    write(file, value, options);
    if (file === statusFile) throw new Error("Synthetic lost write outcome");
  });
  await expect(applyResultAction(ws, action)).rejects.toThrow("Synthetic lost write outcome");
  failure.mockRestore();
  await applyResultAction(new Workspace(ws.root), action);
  const changed = parseFrontmatter<{ next: Record<string, unknown>[]; updated: string }>(
    ws.readText(statusFile),
  );
  const expected = changed.data.next[0] as Record<string, unknown>;
  changed.data.next[1] = { ...changed.data.next[1], title: "Independent change" };
  ws.writeText(statusFile, stringifyFrontmatter(changed.data, changed.body));
  await applyResultAction(
    new Workspace(ws.root),
    request("restore_next", { file: statusFile, id: "one", expected_next: expected, prior_next: before }),
  );
  expect((await applyResultAction(new Workspace(ws.root), action)).status).toBe("duplicate");
  const restored = parseFrontmatter<{ next: Record<string, unknown>[]; custom: string }>(
    ws.readText(statusFile),
  );
  expect(restored.body).toBe(body);
  expect(restored.data.next[0]).toEqual(before);
  expect(restored.data.next[1]?.title).toBe("Independent change");
  expect(restored.data.custom).toBe("keep");
  const shorthand = { next: ["Handwritten step", { title: "Unchanged sibling", custom: 7 }] };
  ws.writeText(statusFile, stringifyFrontmatter(shorthand, body));
  const normalized = (normalizeStatus(shorthand).next as Record<string, unknown>[])[0] as Record<
    string,
    unknown
  >;
  await applyResultAction(
    ws,
    request("complete_next_result", {
      file: statusFile,
      id: String(normalized.id),
      expected_next: normalized,
      result_text: "Done",
    }),
  );
  const normalizedWrite = parseFrontmatter<{ next: Record<string, unknown>[] }>(ws.readText(statusFile));
  expect(normalizedWrite.data.next[1]).toEqual(shorthand.next[1]);
  expect(normalizedWrite.body).toBe(body);

  await expect(
    applyResultAction(
      ws,
      request("restore_next", { file: statusFile, id: "one", expected_next: expected, prior_next: before }),
    ),
  ).rejects.toMatchObject({ code: "CONFLICT" });
});

it("rejects new multiline without losing content, accepts blank completion, and reads stored multiline literally", async () => {
  const ws = await workspace();
  const original = task(ws);
  const lines = "First line\nSecond line";
  expect(
    taskResult(completionNotes("完成结果：Old undated result", "New result", "2026-11-11T01:00:00Z")),
  ).toEqual({ text: "New result", at: "2026-11-11T01:00:00Z" });

  const notes =
    "source stays\n完成结果：\n\n    First line\n    Second line\n\n完成时间：2026-11-11T00:00:00Z\n";
  expect(taskResult(notes)?.text).toBe(lines);
  const action = request("complete_next_result", {
    file: "task",
    id: original.id,
    expected_rev: 1,
    result_text: lines,
  });
  await applyPhoneActions(
    ws,
    "synthetic.actions.jsonl",
    JSON.stringify({ ...action, device: "3fa9c1d2", at: new Date().toISOString() }),
  );
  expect(phoneReceipts(ws).find((row) => row.ref === action.client_id)?.status).toBe("rejected");
  expect(readRecords(ws, "task")[0]).toEqual(original);
  await applyResultAction(
    ws,
    request("complete_next_result", { file: "task", id: original.id, expected_rev: 1, result_text: "  " }),
  );
  expect(collectResults(ws)).toHaveLength(0);
  const legacy = task(ws);
  updateRecord(ws, "task", legacy.id, { status: "done", notes }, { by: "user" });
  expect(collectResults(ws)[0]?.text).toBe(lines);
  expect(readRecords(ws, "task").find((row) => row.id === legacy.id)?.notes).toBe(notes);
});

it("recovers task writes and lost receipts with the original ID; adopts/cancels proposals only at the expected revision", async () => {
  const ws = await workspace();
  const original = task(ws);
  const action = request("complete_next_result", {
    file: "task",
    id: original.id,
    expected_rev: 1,
    result_text: "Done",
  });
  const payload = JSON.stringify({ ...action, device: "3fa9c1d2", at: new Date().toISOString() });
  const write = ws.writeJson.bind(ws);
  const failure = vi.spyOn(ws, "writeJson").mockImplementation((file, value, options) => {
    if (file.endsWith(`${action.client_id}.json`) && (value as { status?: string }).status === "applied")
      throw new Error("Synthetic lost receipt");
    write(file, value, options);
  });
  await expect(applyPhoneActions(ws, "synthetic.actions.jsonl", payload)).rejects.toThrow(
    "Synthetic lost receipt",
  );
  failure.mockRestore();
  await applyPhoneActions(new Workspace(ws.root), "synthetic.actions.jsonl", payload);
  await applyPhoneActions(new Workspace(ws.root), "synthetic.actions.jsonl", payload);
  expect(readRecordRevisions(ws, "task").filter((row) => row.id === original.id)).toHaveLength(2);
  expect(phoneReceipts(ws).find((row) => row.ref === action.client_id)).toMatchObject({
    status: "duplicate",
    effect: { rev: 2, prior_rev: 1 },
  });
  const proposal = task(ws, "agent");
  await expect(
    applyResultAction(ws, request("adopt_task", { id: proposal.id, expected_rev: 2 })),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  const adopt = request("adopt_task", { id: proposal.id, expected_rev: 1 });
  await applyResultAction(ws, adopt);
  expect((await applyResultAction(ws, adopt)).status).toBe("duplicate");
  await expect(
    applyResultAction(ws, request("adopt_task", { id: proposal.id, expected_rev: 2 })),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  const declined = task(ws, "agent");
  await applyResultAction(ws, request("cancel_task", { id: declined.id, expected_rev: 1 }));
  expect(readRecords(ws, "task").find((row) => row.id === declined.id)?.status).toBe("cancelled");
  const conflicted = addRecord(ws, "task", { title: "First writer", status: "open" }, { by: "user" });
  updateRecord(ws, "task", conflicted.record.id, { title: "Revision two" }, { by: "user" });
  ws.appendLine(conflicted.file, JSON.stringify({ ...conflicted.record, title: "Other first revision" }));
  await expect(
    applyResultAction(
      ws,
      request("restore_task_revision", { id: conflicted.record.id, expected_rev: 2, prior_rev: 1 }),
    ),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(readRecordRevisions(ws, "task").filter((row) => row.id === conflicted.record.id)).toHaveLength(3);
});
