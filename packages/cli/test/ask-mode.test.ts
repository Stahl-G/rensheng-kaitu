import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { type AskMode, type AskRuntime, createAskService } from "../src/ui/ask.js";

it("连接能力决定新旧会话模式，切换普通模型收回完整能力并重启运行时", async () => {
  const temp = mkdtempSync(join(tmpdir(), "kaitu-mode-"));
  let fullOnly = false;
  const calls: { mode: AskMode; id: unknown }[] = [];
  const closed: AskMode[] = [];
  const ask = createAskService({
    state: temp,
    workspace: join(temp, "workspace"),
    settings: async () => ({ configured: true, model: "synthetic", provider: "synthetic", fullOnly }),
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
    const first = await ask.create();
    await ask.send(first.id, "合成消息");
    await expect(ask.setMode(first.id, "full", false)).rejects.toThrow();
    fullOnly = true;
    await ask.send(first.id, "继续原对话");
    const second = await ask.create();
    await ask.send(second.id, "新对话");
    expect(calls).toEqual([
      { mode: "scoped", id: first.id },
      { mode: "full", id: first.id },
      { mode: "full", id: second.id },
    ]);
    expect(closed).toEqual(["scoped"]);
    expect(ask.list().find((row) => row.id === first.id)?.mode).toBe("full");
    expect(ask.list().find((row) => row.id === second.id)?.mode).toBe("full");
    fullOnly = false;
    await ask.send(first.id, "收回完整权限后继续");
    expect(calls.at(-1)).toEqual({ mode: "scoped", id: first.id });
  } finally {
    await ask.close();
    rmSync(temp, { recursive: true, force: true });
  }
});
