import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { type AskRuntime, createAskService } from "../src/ui/ask.js";

test("the capture operation opens one conversation and an ambiguous send is not repeated after restart", async () => {
  const temp = mkdtempSync(join(tmpdir(), "ask-handoff-"));
  let calls = 0;
  const options = {
    state: temp,
    workspace: join(temp, "workspace"),
    settings: async () => ({ configured: true, provider: "synthetic", model: "synthetic" }),
    configure: async () => ({}),
    models: async () => [],
    runtime: async (): Promise<AskRuntime> => ({
      onNotification: () => () => {},
      request: async () => {
        calls++;
        throw new Error("synthetic response lost");
      },
      close: async () => {},
    }),
  };
  const ask = createAskService(options);
  try {
    const [first, duplicate] = await Promise.all([
      ask.create("capture-operation-1"),
      ask.create("capture-operation-1"),
    ]);
    expect(duplicate.id).toBe(first.id);
    await expect(ask.send(first.id, "synthetic", [], "capture-operation-1")).rejects.toThrow();
    const restored = createAskService(options);
    try {
      expect((await restored.create("capture-operation-1")).id).toBe(first.id);
      expect(await restored.send(first.id, "synthetic", [], "capture-operation-1")).toEqual({
        status: "already-started",
      });
      expect(calls).toBe(1);
    } finally {
      await restored.close();
    }
  } finally {
    await ask.close();
    rmSync(temp, { recursive: true, force: true });
  }
});

test("durable terminal events reconcile lost acknowledgements without another turn", async () => {
  const temp = mkdtempSync(join(tmpdir(), "ask-receipt-"));
  let notify: Parameters<AskRuntime["onNotification"]>[0] = () => {};
  let calls = 0;
  const options = {
    state: temp,
    workspace: join(temp, "workspace"),
    settings: async () => ({ configured: true, provider: "synthetic", model: "synthetic" }),
    configure: async () => ({}),
    models: async () => [],
    runtime: async (): Promise<AskRuntime> => ({
      onNotification(listener) {
        notify = listener;
        return () => {};
      },
      async request(_method, params) {
        calls++;
        const kind = String(params.sessionId) === completedId ? "completed" : "error";
        notify("session.event", {
          sessionId: params.sessionId,
          event: { type: "turn/end", data: { reason: { kind } }, seq: 1 },
        });
        throw new Error("lost acknowledgement");
      },
      close: async () => {},
    }),
  };
  let completedId = "";
  const ask = createAskService(options);
  try {
    const completed = await ask.create("capture-completed");
    completedId = completed.id;
    const failed = await ask.create("capture-failed");
    await expect(ask.send(completed.id, "synthetic", [], "capture-completed")).rejects.toThrow();
    await expect(ask.send(failed.id, "synthetic", [], "capture-failed")).rejects.toThrow();
    const restored = createAskService(options);
    try {
      expect(restored.handoffStatus("capture-completed")).toEqual({
        status: "completed",
        sessionId: completed.id,
      });
      expect(restored.handoffStatus("capture-failed")).toEqual({ status: "failed", sessionId: failed.id });
      expect(restored.handoffStatus("capture-absent")).toEqual({ status: "not_found" });
      await restored.send(completed.id, "synthetic", [], "capture-completed");
      await restored.send(failed.id, "synthetic", [], "capture-failed");
      expect(calls).toBe(2);
    } finally {
      await restored.close();
    }
  } finally {
    await ask.close();
    rmSync(temp, { recursive: true, force: true });
  }
});
