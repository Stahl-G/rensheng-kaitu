import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initWorkspace } from "@kaitu/core";
import { expect, test } from "vitest";
import { type AskRuntime, createAskService } from "../src/ui/ask.js";
import { askTextOnly } from "../src/ui/project-ai.js";

/** 假的 AI 进程：记下收到的请求、是否以只收发文字启动、是否被关掉。 */
async function fake(
  turn: (emit: (seq: number, type: string, data: object) => void, idle: () => void) => void,
) {
  const temp = mkdtempSync(join(tmpdir(), "kaitu-text-only-"));
  const ws = await initWorkspace(join(temp, "workspace"), { timeZone: "Asia/Shanghai" });
  const seen = { methods: [] as string[], textOnly: [] as (boolean | undefined)[], closed: 0 };
  let notify: Parameters<AskRuntime["onNotification"]>[0] = () => {};
  const ask = createAskService({
    state: join(temp, "state"),
    workspace: ws.root,
    settings: async () => ({ configured: true, provider: "fake", model: "fake" }),
    configure: async () => ({}),
    models: async () => [],
    runtime: async (_mode, _connection, textOnly): Promise<AskRuntime> => {
      seen.textOnly.push(textOnly);
      return {
        onNotification(listener) {
          notify = listener;
          return () => {};
        },
        async request(method, params) {
          seen.methods.push(method);
          if (method !== "session/prompt") return {};
          const sessionId = params.sessionId;
          turn(
            (seq, type, data) => notify("session.event", { sessionId, event: { seq, type, data } }),
            () => notify("session.status", { sessionId, status: "idle" }),
          );
          return { messageId: "m" };
        },
        async close() {
          seen.closed++;
        },
      };
    },
  });
  return { ask, seen };
}
const messages = { timeout: "超时了", empty: "没有回答" };

test("只收发文字的一次性对话：模型一调工具就停下并关掉进程，问问历史里不留内部对话", async () => {
  const { ask, seen } = await fake((emit, idle) => {
    emit(1, "tool/call", { callId: "w", name: "kaitu_write", arguments: "{}" });
    emit(2, "assistant/message", { message: { content: [{ type: "text", text: "{}" }] } });
    idle();
  });
  await expect(askTextOnly(ask, "画图", messages)).rejects.toThrow("AI 想调用工具");
  expect(seen.textOnly).toEqual([true]);
  expect(seen.methods).toContain("session/cancel");
  expect(seen.closed).toBe(1);
  expect(ask.list()).toEqual([]);
});

test("超时后取消这次回答并关掉进程，不在后台继续跑", async () => {
  const { ask, seen } = await fake(() => {});
  await expect(askTextOnly(ask, "画图", messages, 50)).rejects.toThrow("超时了");
  expect(seen.methods).toContain("session/cancel");
  expect(seen.closed).toBe(1);
});

test("只回文字时照常拿到回答", async () => {
  const { ask, seen } = await fake((emit, idle) => {
    emit(1, "assistant/message", { message: { content: [{ type: "text", text: '{"links":[]}' }] } });
    idle();
  });
  await expect(askTextOnly(ask, "画图", messages)).resolves.toBe('{"links":[]}');
  expect(seen.closed).toBe(1);
  expect(ask.list()).toEqual([]);
});
