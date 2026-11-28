import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
import { processInbox } from "../src/inbox.js";
import {
  observePhoneConsumer,
  organizerStatus,
  phoneConsumerStatus,
  selectPhoneConsumer,
  subscribeOrganizer,
} from "../src/organizer.js";
import { readOverviewPage } from "../src/overview-page.js";
import { applyPhoneActions } from "../src/phone-actions.js";
import { buildPhoneToday } from "../src/phone-projections.js";
import { Workspace } from "../src/workspace.js";
import { clonedWorkspace } from "./helpers.js";
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
it("reads a fresh workspace without taking ownership, then persists the ID when it processes an inbox file", async () => {
  const ws = await clonedWorkspace();
  roots.push(ws.root);
  const stateFile = ".kaitu/organizer.json";
  const before = vi.spyOn(ws, "writeJson");
  const changed = vi.fn();
  const unsubscribe = subscribeOrganizer(ws, changed);
  try {
    expect(ws.exists(stateFile)).toBe(false);
    for (let i = 0; i < 2; i++) {
      expect(phoneConsumerStatus(ws)).toEqual({ paused: false });
      expect(organizerStatus(ws).consumer).toEqual({ paused: false });
      expect(ws.exists(stateFile)).toBe(false);
    }
    expect(() => selectPhoneConsumer(ws, randomUUID())).toThrow("Unknown computer");
    expect(before).not.toHaveBeenCalled();
    expect(changed).not.toHaveBeenCalled();
    ws.writeText("inbox/agents/synthetic-note.md", "# Synthetic test note");
    expect((await processInbox(ws, { stableMs: 0 })).notes).toHaveLength(1);
    const saved = ws.readJson<{ consumer: { deviceId: string } }>(stateFile);
    expect(saved.consumer.deviceId).toMatch(/^[0-9a-f-]{36}$/);
    before.mockClear();
    expect(phoneConsumerStatus(ws)).toEqual({ ...saved.consumer, paused: false });
    expect(phoneConsumerStatus(new Workspace(ws.root))).toEqual({ ...saved.consumer, paused: false });
    expect(before).not.toHaveBeenCalled();
  } finally {
    unsubscribe();
    before.mockRestore();
  }
});
it("detects another pseudonymous consumer and pauses until a local choice without terminal receipts", async () => {
  const ws = await clonedWorkspace();
  roots.push(ws.root);
  const snapshot = buildPhoneToday(await readOverviewPage(ws), new Date().toISOString(), ws);
  const other = randomUUID();
  ws.writeJson("phone/today.json", { ...snapshot, generator: { kind: "computer", device_id: other } });
  await expect(applyPhoneActions(ws, "synthetic.actions.jsonl", "")).rejects.toMatchObject({
    code: "CONSUMER_PAUSED",
  });
  expect(phoneConsumerStatus(ws)).toMatchObject({ paused: true, otherDeviceId: other });
  expect(ws.exists("phone/receipts.json")).toBe(false);
  const local = selectPhoneConsumer(ws, other);
  expect(local.paused).toBe(true);
  if (!local.deviceId) throw new Error("missing persisted device ID");
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
  const local = { deviceId: randomUUID() };
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
