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
