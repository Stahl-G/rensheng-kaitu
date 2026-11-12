import { rmSync } from "node:fs";
import { afterEach, expect, it } from "vitest";
import { stringifyFrontmatter } from "../src/frontmatter.js";
import { addRecord, readRecords } from "../src/index.js";
import { applyPhoneActions } from "../src/phone-actions.js";
import { phoneReceipts, writePhoneReceipts } from "../src/phone-receipts.js";
import { type ResultEffect, type ResultRequest, acknowledgeResultAction } from "../src/results.js";
import { ulid } from "../src/ulid.js";
import { clonedWorkspace } from "./helpers.js";
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
it.each(["target", "text", "task"])(
  "does not bind an unverifiable %s receipt or resume its pending write",
  async (kind) => {
    const ws = await clonedWorkspace();
    roots.push(ws.root);
    const before = { id: "one", title: "Synthetic binding", status: "todo" };
    const file = "me/STATUS.md";
    ws.writeText(file, stringifyFrontmatter({ updated: null, next: [before] }, "# Synthetic\n"));
    const request: ResultRequest = {
      client_id: ulid(),
      op: "complete_next_result",
      args: { file, id: "one", expected_next: before, result_text: "Local result" },
    };
    let effect: ResultEffect = {
      file,
      id: kind === "target" ? "two" : "one",
      prior_next: before,
      expected_next: {
        ...before,
        status: "done",
        result: kind === "target" ? "Local result" : "Other result",
        completed: new Date().toISOString(),
      },
    };
    if (kind === "task") {
      const record = addRecord(
        ws,
        "task",
        { title: "Synthetic task", status: "open" },
        { by: "user" },
      ).record;
      request.args = { file: "task", id: record.id, expected_rev: 1, result_text: "Local result" };
      effect = { file: "task", id: record.id, prior_rev: 1, rev: 2 };
    }
    const path = `.kaitu/result-actions/${request.client_id}.json`;
    ws.writeJson(path, { request, at: new Date().toISOString() }, { internal: true });
    writePhoneReceipts(ws, [
      { ref: request.client_id, kind: "action", status: "applied", effect, at: new Date().toISOString() },
    ]);
    const original = ws.readText(file);
    const originalTasks = readRecords(ws, "task");
    const send = () =>
      applyPhoneActions(
        ws,
        "synthetic.actions.jsonl",
        JSON.stringify({ ...request, device: "12345678", at: new Date().toISOString() }),
      );
    await send();
    expect(phoneReceipts(ws).find((r) => r.ref === request.client_id)?.status).toBe("conflict");
    expect(ws.readJson(path)).toMatchObject({ request, status: "conflict" });
    expect(ws.readJson<Record<string, unknown>>(path).effect).toBeUndefined();
    ws.writeJson("phone/receipts.json", {
      format: "kaitu.phone.receipts",
      version: 1,
      generated_at: new Date().toISOString(),
      items: [],
    });
    await send();
    expect(phoneReceipts(ws).find((r) => r.ref === request.client_id)?.status).toBe("conflict");
    expect(ws.readText(file)).toBe(original);
    if (kind === "task") expect(readRecords(ws, "task")).toEqual(originalTasks);
  },
);

it.each([true, false])("checks restore_next full transition: matching=%s", async (matching) => {
  const ws = await clonedWorkspace();
  roots.push(ws.root);
  const before = { id: "one", status: "done", result: "Finished" };
  const after = { id: "one", status: "todo", title: "Original" };
  const request: ResultRequest = {
    client_id: ulid(),
    op: "restore_next",
    args: { file: "me/STATUS.md", id: "one", expected_next: before, prior_next: after },
  };
  const path = `.kaitu/result-actions/${request.client_id}.json`;
  ws.writeJson(path, { request, at: new Date().toISOString() }, { internal: true });
  const effect: ResultEffect = {
    file: "me/STATUS.md",
    id: "one",
    prior_next: before,
    expected_next: matching ? after : { ...after, title: "Different" },
  };
  expect(acknowledgeResultAction(ws, request, effect)).toBe(matching);
  expect(ws.readJson(path)).toMatchObject({ request, status: matching ? "applied" : "conflict" });
  expect(ws.readJson<Record<string, unknown>>(path).effect).toEqual(matching ? effect : undefined);
});
it("preserves an already applied local binding when a different remote effect arrives", async () => {
  const ws = await clonedWorkspace();
  roots.push(ws.root);
  const before = { id: "one", status: "todo" };
  const request: ResultRequest = {
    client_id: ulid(),
    op: "complete_next_result",
    args: { file: "me/STATUS.md", id: "one", expected_next: before, result_text: "Local" },
  };
  const effect: ResultEffect = {
    file: "me/STATUS.md",
    id: "one",
    prior_next: before,
    expected_next: { ...before, status: "done", result: "Local", completed: new Date().toISOString() },
  };
  const path = `.kaitu/result-actions/${request.client_id}.json`;
  ws.writeJson(
    path,
    { request, effect, status: "applied", at: new Date().toISOString() },
    { internal: true },
  );
  const bytes = ws.readText(path);
  const other = { ...effect, expected_next: { ...effect.expected_next, result: "Other" } };
  expect(acknowledgeResultAction(ws, request, other)).toBe(false);
  expect(ws.readText(path)).toBe(bytes);
  expect(acknowledgeResultAction(ws, request, effect)).toBe(true);
  expect(ws.readText(path)).toBe(bytes);
});
