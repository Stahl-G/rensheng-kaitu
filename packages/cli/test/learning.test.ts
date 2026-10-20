import { rmSync } from "node:fs";
import { readLearning } from "@kaitu/core";
import { expect, it } from "vitest";
import { freshWorkspace } from "../../core/test/helpers.js";
import { startUi } from "../src/ui/server.js";

it("独立资料接口在无模型下保存来源与真实学习结果，返回资料列表并可重读", async () => {
  const ws = await freshWorkspace();
  const ui = await startUi(ws, { port: 0, open: false });
  const post = async (method: string, args: unknown[]) => {
    const response = await fetch(`${ui.url}/api/product/${method}`, {
      method: "POST",
      headers: { Origin: ui.url, "X-Kaitu": "1", "Content-Type": "application/json" },
      body: JSON.stringify(args),
    });
    expect(response.ok).toBe(true);
    return response.json();
  };
  try {
    const topic = await post("learningStart", [
      {
        title: "Synthetic learning",
        source: {
          title: "Synthetic source",
          url: "https://example.com/source",
          text: "A synthetic excerpt.",
        },
      },
    ]);
    const result = await post("learningSave", [
      {
        topic: topic.topic,
        operationId: "http-study-0001",
        understanding: "I can explain the example.",
        questions: "When does it fail?",
        next: "Try a counterexample",
      },
    ]);
    expect(result.version).toBeNull(); // UI versions are scheduled in the background.
    expect(result.notes).toContain("When does it fail?");
    expect(await post("learningRead", [topic.topic])).toMatchObject({
      notes: result.notes,
      next: [{ title: "Try a counterexample", status: "todo" }],
    });
    expect((await post("library", [])).notes).toContainEqual(
      expect.objectContaining({ title: "Synthetic learning", status: "Try a counterexample" }),
    );
    expect(readLearning(ws, topic.topic).sources[0]?.text).toContain("https://example.com/source");
  } finally {
    await ui.close();
    rmSync(ws.root, { recursive: true, force: true });
  }
});

it("教学帧只读取已保存的工具结果，独立 CSP 允许交互且不放宽主页面策略", async () => {
  const ws = await freshWorkspace();
  let notify: (method: string, params: Record<string, unknown>) => void = () => {};
  const { createAskService } = await import("../src/ui/ask.js");
  const ask = createAskService({
    state: `${ws.root}/test-ai`,
    workspace: ws.root,
    transient: true,
    settings: async () => ({ configured: true, provider: "fake", model: "fake" }),
    configure: async () => ({}),
    models: async () => [],
    runtime: async () => ({
      onNotification(listener) {
        notify = listener;
        return () => {};
      },
      async close() {},
      async request(_method, params) {
        notify("session.event", {
          sessionId: params.sessionId,
          event: {
            seq: 1,
            type: "tool/result",
            data: {
              message: { toolCallId: "synthetic-card", content: [{ type: "text", text: "Rendered" }] },
              meta: {
                kind: "openmaic-render",
                title: "Synthetic quiz",
                fragment: '<button onclick="this.textContent=42">Try</button>',
              },
            },
          },
        });
        notify("session.status", { sessionId: params.sessionId, status: "idle" });
        return {};
      },
    }),
  });
  const ui = await startUi(ws, { port: 0, open: false, ask });
  try {
    const thread = await ask.create();
    await ask.send(thread.id, "synthetic");
    const response = await fetch(`${ui.url}/api/ask/teaching-frame?session=${thread.id}&call=synthetic-card`);
    expect(response.status).toBe(200);
    const policy = response.headers.get("content-security-policy");
    expect(policy).toContain("sandbox allow-scripts");
    expect(policy).toContain("form-action 'none'");
    expect(policy).toContain("connect-src blob: data:");
    expect(await response.text()).toContain('onclick="this.textContent=42"');
    expect((await fetch(`${ui.url}/api/state`)).headers.get("content-security-policy")).not.toContain(
      "script-src 'unsafe-inline'",
    );
    expect((await fetch(`${ui.url}/api/ask/teaching-frame?session=${thread.id}&call=missing`)).status).toBe(
      404,
    );
  } finally {
    await ui.close();
    rmSync(ws.root, { recursive: true, force: true });
  }
});
