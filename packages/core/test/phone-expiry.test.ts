import { rmSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
import { stringifyFrontmatter } from "../src/frontmatter.js";
import { applyPhoneActions } from "../src/phone-actions.js";
import { phoneReceipts } from "../src/phone-receipts.js";
import { ulid } from "../src/ulid.js";
import { clonedWorkspace } from "./helpers.js";
const roots: string[] = [];
afterEach(() => {
  vi.useRealTimers();
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});
it.each([14 * 86400000, 14 * 86400000 + 1, -600000])("uses computer UTC age at boundary %s", async (age) => {
  const ws = await clonedWorkspace();
  roots.push(ws.root);
  const before = { id: "one", status: "todo", title: "Synthetic age" };
  const file = "me/STATUS.md";
  ws.writeText(file, stringifyFrontmatter({ updated: null, next: [before] }, "# Synthetic\n"));
  const original = ws.readText(file);
  const now = new Date();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
  const action = {
    client_id: ulid(),
    device: "12345678",
    at: new Date(now.getTime() - age).toISOString(),
    op: "complete_next_result",
    args: { file, id: "one", expected_next: before, result_text: "Done" },
  };
  await applyPhoneActions(ws, "synthetic.actions.jsonl", JSON.stringify(action));
  const receipt = phoneReceipts(ws).find((r) => r.ref === action.client_id);
  if (age > 14 * 86400000) {
    expect(receipt).toMatchObject({
      status: "rejected",
      message: expect.stringMatching(/^\[ACTION_EXPIRED\]/),
    });
    expect(ws.readText(file)).toBe(original);
    expect(ws.exists(`.kaitu/result-actions/${action.client_id}.json`)).toBe(false);
  } else expect(receipt?.status).toBe("applied");
});
it.each(["applied", "pending"])("retains terminal evidence but stops old %s recovery", async (state) => {
  const ws = await clonedWorkspace();
  roots.push(ws.root);
  const before = { id: "one", status: "todo", title: "Synthetic recovery" };
  const file = "me/STATUS.md";
  ws.writeText(file, stringifyFrontmatter({ updated: null, next: [before] }, "# Synthetic\n"));
  const now = new Date();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
  const request = {
    client_id: ulid(),
    op: "complete_next_result",
    args: { file, id: "one", expected_next: before, result_text: "Done" },
  };
  const action = { ...request, device: "12345678", at: now.toISOString() };
  const send = () => applyPhoneActions(ws, "synthetic.actions.jsonl", JSON.stringify(action));
  if (state === "applied") await send();
  else
    ws.writeJson(
      `.kaitu/result-actions/${request.client_id}.json`,
      { request, at: now.toISOString() },
      { internal: true },
    );
  const original = ws.readText(file);
  vi.setSystemTime(new Date(now.getTime() + 15 * 86400000));
  ws.writeJson("phone/receipts.json", {
    format: "kaitu.phone.receipts",
    version: 1,
    generated_at: new Date().toISOString(),
    items: [],
  });
  await send();
  expect(ws.readText(file)).toBe(original);
  expect(phoneReceipts(ws).find((r) => r.ref === request.client_id)?.status).toBe(
    state === "applied" ? "duplicate" : "rejected",
  );
  if (state === "pending") {
    await send();
    expect(ws.readText(file)).toBe(original);
    expect(phoneReceipts(ws).find((r) => r.ref === request.client_id)?.message).toMatch(
      /^\[ACTION_EXPIRED\]/,
    );
  }
});
