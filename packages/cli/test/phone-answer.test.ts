import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { type AskRuntime, createAskService } from "../src/ui/ask.js";
import { phoneAnswer } from "../src/ui/phone-answer.js";

it("手机回复跟随问问连接，始终使用默认权限并等待完整回复", async () => {
  const directory = mkdtempSync(join(tmpdir(), "kaitu-phone-answer-"));
  let configured = false;
  const modes: string[] = [];
  let notify!: (method: string, params: Record<string, unknown>) => void;
  const runtime: AskRuntime = {
    onNotification(listener) {
      notify = listener;
      return () => {};
    },
    async request(_method, params) {
      notify("session.event", {
        sessionId: params.sessionId,
        event: {
          type: "assistant/message",
          seq: 1,
          data: { message: { content: [{ type: "text", text: "训练已记录" }] } },
        },
      });
      notify("session.status", { sessionId: params.sessionId, status: "idle" });
    },
    async close() {},
  };
  const ask = createAskService({
    state: directory,
    workspace: directory,
    runtime: async (mode) => {
      modes.push(mode);
      return runtime;
    },
    settings: async () => ({ configured, provider: "synthetic", model: "synthetic" }),
    configure: async () => {},
  });
  try {
    const reply = phoneAnswer(ask);
    const signal = new AbortController().signal;
    await reply("记录训练", signal);
    expect(ask.list()).toHaveLength(0);
    configured = true;
    expect(await reply("记录训练", signal)).toBe("训练已记录");
    expect(modes).toEqual(["scoped"]);
  } finally {
    await ask.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
