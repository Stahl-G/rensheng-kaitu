import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { type AskRuntime, createAskService } from "../src/ui/ask.js";

it("降权与资料搬迁期间旧完整 Agent 不能再接收请求，关闭失败也不能复用", async () => {
  const temp = mkdtempSync(join(tmpdir(), "kaitu-ask-gate-"));
  let release: (() => void) | undefined;
  let fail = false;
  const calls: string[] = [];
  const ask = createAskService({
    state: temp,
    workspace: join(temp, "workspace"),
    settings: async () => ({ configured: true, provider: "synthetic", model: "synthetic" }),
    configure: async () => ({}),
    runtime: async (mode): Promise<AskRuntime> => {
      let notify: Parameters<AskRuntime["onNotification"]>[0] = () => {};
      return {
        onNotification(listener) {
          notify = listener;
          return () => {};
        },
        async request(_method, params) {
          calls.push(mode);
          notify("session.status", { sessionId: params.sessionId, status: "idle" });
        },
        async close() {
          if (fail) throw new Error("synthetic close failure");
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        },
      };
    },
  });
  try {
    const row = ask.create();
    await expect(ask.setMode(row.id, "full", false)).rejects.toThrow();
    await ask.setMode(row.id, "full", true);
    await ask.send(row.id, "synthetic first");
    const switching = ask.setMode(row.id, "scoped", false);
    await Promise.resolve();
    await expect(ask.send(row.id, "during switch")).rejects.toThrow();
    await expect(ask.configure({})).rejects.toThrow();
    await expect(ask.setMode(row.id, "full", true)).rejects.toThrow();
    release?.();
    await switching;
    await ask.send(row.id, "after switch");
    expect(calls).toEqual(["full", "scoped"]);
    const moving = ask.prepareRelocation();
    await Promise.resolve();
    await expect(ask.send(row.id, "during close")).rejects.toThrow();
    release?.();
    await moving;
    await expect(ask.send(row.id, "during copy")).rejects.toThrow();
    ask.relocate(join(temp, "workspace"));
    await ask.setMode(row.id, "full", true);
    await ask.send(row.id, "full again");
    fail = true;
    await expect(ask.setMode(row.id, "scoped", false)).rejects.toThrow();
    await expect(ask.send(row.id, "must not reuse full")).rejects.toThrow();
    expect(calls).toEqual(["full", "scoped", "full"]);
  } finally {
    fail = false;
    const closing = ask.close();
    await Promise.resolve();
    release?.();
    await closing;
    rmSync(temp, { recursive: true, force: true });
  }
});
