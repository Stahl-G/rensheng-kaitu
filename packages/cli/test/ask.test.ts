import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initWorkspace } from "@kaitu/core";
import { expect, test } from "vitest";
import { type AskRuntime, createAskService } from "../src/ui/ask.js";
import { startUi } from "../src/ui/server.js";

test("SDK turns persist and replay only their own visible events through SSE", async () => {
  const temp = mkdtempSync(join(tmpdir(), "kaitu-ask-"));
  const ws = await initWorkspace(join(temp, "workspace"), { timeZone: "Asia/Shanghai" });
  let notify: Parameters<AskRuntime["onNotification"]>[0] = () => {};
  const options = {
    state: join(temp, "state"),
    workspace: ws.root,
    settings: async () => ({ configured: true, provider: "fake", model: "fake" }),
    configure: async () => ({}),
    runtime: async (): Promise<AskRuntime> => ({
      onNotification(listener) {
        notify = listener;
        return () => {};
      },
      async request(_method, params) {
        const sessionId = params.sessionId;
        notify("session.event", {
          sessionId: "other-session",
          event: { seq: 0, type: "user/message", data: {} },
        });
        const emit = (seq: number, type: string, data: object) =>
          notify("session.event", { sessionId, event: { seq, type, data } });
        if (JSON.stringify(params.contentBlocks).includes("synthetic-failure")) {
          emit(6, "turn/end", {
            reason: { kind: "error", error: { message: "synthetic provider failure" } },
          });
          notify("session.status", { sessionId, status: "idle" });
          return { messageId: "message-2" };
        }
        emit(0, "user/message", { content: params.contentBlocks, source: { kind: "user" } });
        emit(1, "tool/call", { callId: "read-1", name: "read_file", arguments: '{"path":"NOW.md"}' });
        emit(2, "tool/result", {
          message: { toolCallId: "read-1", content: [{ type: "text", text: "合成计划" }] },
        });
        emit(3, "assistant/message", {
          message: { content: [{ type: "text", text: "今天有一项合成任务" }] },
          stream: [],
        });
        emit(3, "assistant/message", { message: { content: [] } });
        emit(5, "user/message", {
          content: [{ type: "text", text: "internal context" }],
          source: { kind: "runtime-context" },
        });
        emit(4, "request/header", { secret: "not-for-ui" });
        notify("session.status", { sessionId, status: "idle" });
        return { messageId: "message-1" };
      },
      async close() {},
    }),
  };
  const ask = createAskService(options);
  const server = await startUi(ws, { port: 0, open: false, ask });
  const post = async (method: string, args: unknown[]) => {
    const response = await fetch(`${server.url}/api/product/${method}`, {
      method: "POST",
      headers: { Origin: server.url, "X-Kaitu": "1", "Content-Type": "application/json" },
      body: JSON.stringify(args),
    });
    expect(response.ok).toBe(true);
    return response.json();
  };
  const abort = new AbortController();
  try {
    const row = await post("askCreate", []);
    const other = await post("askCreate", []);
    const live = await fetch(`${server.url}/api/ask/events?session=${row.id}`, { signal: abort.signal });
    const reading = (async () => {
      let text = "";
      for await (const chunk of live.body as AsyncIterable<Uint8Array>) {
        text += new TextDecoder().decode(chunk);
        if (text.includes('"status":"idle"')) return text;
      }
      return text;
    })();
    await post("askSend", [row.id, "今天有什么安排？"]);
    const frames = (await reading)
      .split("\n\n")
      .filter((frame) => frame.startsWith("id:"))
      .map((frame) => JSON.parse(frame.split("data: ")[1] as string));
    expect(frames.map((event) => event.type)).toEqual([
      "session.status",
      "user/message",
      "tool/call",
      "tool/result",
      "assistant/message",
      "session.status",
    ]);
    expect(frames[4].data.message.content[0].text).toBe("今天有一项合成任务");
    const restored = createAskService(options);
    expect(restored.events(row.id)).toEqual(frames);
    expect(restored.events(other.id)).toEqual([]);
    expect(restored.list().find((item) => item.id === row.id)?.title).toBe("今天有什么安排？");
    const replay = await fetch(`${server.url}/api/ask/events?session=${row.id}&after=4`, {
      signal: abort.signal,
    });
    const reader = replay.body?.getReader();
    const tail = new TextDecoder().decode((await reader?.read())?.value);
    expect(tail).toContain('"id":5');
    expect(tail).not.toContain('"id":4');
    await post("askSend", [row.id, "synthetic-failure"]);
    expect(ask.events(row.id).at(-2)?.data.error).toBeTruthy();
    expect(ask.events(row.id).at(-1)?.data.status).toBe("idle");
    await restored.close();
  } finally {
    abort.abort();
    await server.close();
    rmSync(temp, { recursive: true, force: true });
  }
});
test("conversations can be pinned, renamed, archived and deleted", async () => {
  const temp = mkdtempSync(join(tmpdir(), "kaitu-ask-organize-"));
  try {
    const options = {
      state: join(temp, "state"),
      workspace: temp,
      settings: async () => ({ configured: true, provider: "fake", model: "fake" }),
      configure: async () => ({}),
      models: async () => [],
      runtime: async (): Promise<AskRuntime> => {
        throw Error("not used");
      },
    };
    const ask = createAskService(options);
    const row = ask.create();
    ask.organize(row.id, { pinned: true, title: "  计划  " });
    ask.organize(row.id, { archived: true });
    expect(createAskService(options).list()[0]).toMatchObject({
      title: "计划",
      pinned: true,
      archived: true,
    });
    ask.remove(row.id);
    expect(createAskService(options).list()).toEqual([]);
    expect(() => ask.events(row.id)).toThrow(/不存在/);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
