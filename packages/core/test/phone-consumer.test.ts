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

it("non-consumer organizer writes preserve another Workspace's latest pause and selection", async () => {
  const ws = await clonedWorkspace();
  roots.push(ws.root);
  const { organizerStatus, markOrganizerSeen, rememberComputerSnapshot, rememberOrganizer } = await import(
    "../src/organizer.js"
  );
  const local = phoneConsumerStatus(ws);
  ws.writeJson(
    ".kaitu/organizer.json",
    {
      agent: { name: "Synthetic", generatedAt: "2026-11-01T00:00:00Z" },
      daily: null,
      visits: [
        {
          agent: { name: "Synthetic", generatedAt: "2026-11-01T00:00:00Z" },
          actions: 1,
          needsReview: 0,
          daily: null,
          returnedAt: "2026-11-01T00:01:00Z",
          seen: false,
        },
      ],
      consumer: { deviceId: local.deviceId },
    },
    { internal: true },
  );
  const settings = new Workspace(ws.root);
  expect(organizerStatus(settings).unread).toBe(true);
  const snapshot = buildPhoneToday(await readOverviewPage(ws), new Date().toISOString(), ws);
  const other = randomUUID();
  observePhoneConsumer(
    ws,
    JSON.stringify({ ...snapshot, generator: { kind: "computer", device_id: other } }),
  );
  selectPhoneConsumer(ws, other);
  ws.writeJson("phone/today.json", {
    ...snapshot,
    generator: { kind: "computer", device_id: local.deviceId },
  });
  expect(markOrganizerSeen(settings)).toMatchObject({
    unread: false,
    consumer: { otherDeviceId: other, selectedDeviceId: other, paused: true },
  });
  expect(phoneConsumerStatus(ws)).toMatchObject({ selectedDeviceId: other, paused: true });
  await expect(applyPhoneActions(ws, "synthetic.actions.jsonl", "")).rejects.toMatchObject({
    code: "CONSUMER_PAUSED",
  });
  let sequence = 0;
  for (const today of [
    undefined,
    "invalid",
    JSON.stringify({ ...snapshot, generator: { kind: "agent", name: "Synthetic", spec: 1 } }),
  ]) {
    rememberOrganizer(settings, today, [], {
      organizer: "Synthetic",
      date: "2026-11-02",
      file: `daily/synthetic-${sequence++}.md`,
    });
    expect(phoneConsumerStatus(ws)).toMatchObject({ selectedDeviceId: other, paused: true });
    await expect(applyPhoneActions(ws, "synthetic.actions.jsonl", "")).rejects.toMatchObject({
      code: "CONSUMER_PAUSED",
    });
  }
  selectPhoneConsumer(ws, local.deviceId);
  rememberComputerSnapshot(settings, new Date("2026-11-02T00:00:00Z"));
  expect(phoneConsumerStatus(ws)).toMatchObject({ selectedDeviceId: local.deviceId, paused: false });
  const third = randomUUID();
  observePhoneConsumer(
    ws,
    JSON.stringify({ ...snapshot, generator: { kind: "computer", device_id: third } }),
  );
  rememberComputerSnapshot(settings, new Date("2026-11-03T00:00:00Z"));
  expect(phoneConsumerStatus(ws)).toMatchObject({ otherDeviceId: third, paused: true });
  expect(phoneConsumerStatus(ws).selectedDeviceId).toBeUndefined();
  await expect(applyPhoneActions(ws, "synthetic.actions.jsonl", "")).rejects.toMatchObject({
    code: "CONSUMER_PAUSED",
  });
});
