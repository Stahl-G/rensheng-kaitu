import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { type AskMode, type AskRuntime, createAskService } from "../src/ui/ask.js";

it("完整模式需要确认，换模式重启运行时且续接原会话，新对话使用默认范围", async () => {
  const temp = mkdtempSync(join(tmpdir(), "kaitu-mode-"));
  const calls: { mode: AskMode; id: unknown }[] = [];
  const closed: AskMode[] = [];
  const ask = createAskService({
    state: temp,
    workspace: join(temp, "workspace"),
    settings: async () => ({ configured: true, model: "synthetic", provider: "synthetic" }),
    configure: async () => ({}),
    runtime: async (mode): Promise<AskRuntime> => {
      let notify: Parameters<AskRuntime["onNotification"]>[0] = () => {};
      return {
        onNotification(listener) {
          notify = listener;
          return () => {};
        },
        async request(_method, params) {
          calls.push({ mode, id: params.sessionId });
          notify("session.status", { sessionId: params.sessionId, status: "idle" });
          return {};
        },
        async close() {
          closed.push(mode);
        },
      };
    },
  });
  try {
    const first = ask.create();
    await ask.send(first.id, "合成消息");
    await expect(ask.setMode(first.id, "full", false)).rejects.toThrow();
    await ask.setMode(first.id, "full", true);
    await ask.send(first.id, "继续原对话");
    const second = ask.create();
    await ask.send(second.id, "新对话");
    expect(calls).toEqual([
      { mode: "scoped", id: first.id },
      { mode: "full", id: first.id },
      { mode: "scoped", id: second.id },
    ]);
    expect(closed).toEqual(["scoped", "full"]);
    expect(ask.list().find((row) => row.id === first.id)?.mode).toBe("full");
    expect(ask.list().find((row) => row.id === second.id)?.mode).toBe("scoped");
    await ask.setMode(first.id, "scoped", false);
    await ask.send(first.id, "收回完整权限后继续");
    expect(calls.at(-1)).toEqual({ mode: "scoped", id: first.id });
  } finally {
    await ask.close();
    rmSync(temp, { recursive: true, force: true });
  }
});
