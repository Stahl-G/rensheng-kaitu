import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { afterEach, expect, it } from "vitest";
import { observePhoneConsumer, phoneConsumerStatus, selectPhoneConsumer } from "../src/organizer.js";
import { readOverviewPage } from "../src/overview-page.js";
import { applyPhoneActions } from "../src/phone-actions.js";
import { buildPhoneToday } from "../src/phone-projections.js";
import { Workspace } from "../src/workspace.js";
import { clonedWorkspace } from "./helpers.js";
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
it("detects another pseudonymous consumer and pauses until a local choice without terminal receipts", async () => {
  const ws = await clonedWorkspace();
  roots.push(ws.root);
  const local = phoneConsumerStatus(ws);
  expect(phoneConsumerStatus(new Workspace(ws.root)).deviceId).toBe(local.deviceId);
  const snapshot = buildPhoneToday(await readOverviewPage(ws), new Date().toISOString(), ws);
  const other = randomUUID();
  ws.writeJson("phone/today.json", { ...snapshot, generator: { kind: "computer", device_id: other } });
  await expect(applyPhoneActions(ws, "synthetic.actions.jsonl", "")).rejects.toMatchObject({
    code: "CONSUMER_PAUSED",
  });
  expect(phoneConsumerStatus(ws)).toMatchObject({ paused: true, otherDeviceId: other });
  expect(ws.exists("phone/receipts.json")).toBe(false);
  expect(selectPhoneConsumer(ws, other).paused).toBe(true);
  expect(selectPhoneConsumer(new Workspace(ws.root), local.deviceId).paused).toBe(false);
  expect(phoneConsumerStatus(ws).paused).toBe(false);
  await applyPhoneActions(ws, "synthetic.actions.jsonl", "");
  observePhoneConsumer(
    ws,
    JSON.stringify({ ...snapshot, generator: { kind: "computer", device_id: randomUUID() } }),
  );
  expect(phoneConsumerStatus(ws).paused).toBe(true);
});
it("accepts old snapshots without claiming it can identify their computer", async () => {
  const ws = await clonedWorkspace();
  roots.push(ws.root);
  const snapshot = buildPhoneToday(await readOverviewPage(ws), new Date().toISOString(), ws);
  observePhoneConsumer(ws, JSON.stringify({ ...snapshot, generator: { kind: "computer" } }));
  expect(phoneConsumerStatus(ws)).toMatchObject({ paused: false });
  expect(phoneConsumerStatus(ws).otherDeviceId).toBeUndefined();
});
