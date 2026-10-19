// Synthetic-only acceptance fixture. Never opens a user workspace or a real model connection.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const fixture = JSON.parse(
  readFileSync(new URL("./fixtures/learning-openmaic.json", import.meta.url), "utf8"),
);
const base = mkdtempSync(join(tmpdir(), "kaitu-learning-smoke-"));
const check = process.argv.includes("--check");
const portIndex = process.argv.indexOf("--port");
const port = portIndex < 0 ? 0 : Number(process.argv[portIndex + 1]);
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("Invalid --port");
for (const [key, value] of Object.entries({
  HOME: "home",
  KAITU_APP_HOME: "app",
  KAITU_LOCAL_STATE_DIR: "state",
  XDG_STATE_HOME: "xdg",
  LOCALAPPDATA: "local",
  DSH_HOME: "dsh",
}))
  process.env[key] = join(base, value);
// biome-ignore lint/performance/noDelete: process.env assignment coerces undefined to a string.
delete process.env.KAITU_DIR;
const { initWorkspace, addRecord, saveOnboardingChoices, Workspace, readLearning } = await import(
  "../packages/core/dist/index.js"
);
const { startUi } = await import("../packages/cli/dist/ui/server.js");
const { createAskService } = await import("../packages/cli/dist/ui/ask.js");
const ws = await initWorkspace(join(base, "workspace"), { timeZone: "Asia/Shanghai" });
await saveOnboardingChoices(ws, { seen: true });
addRecord(ws, "news_item", {
  kind: "article",
  title: fixture.title,
  url: fixture.source.url,
  source: "合成体验资料",
  via: "user",
  summary: fixture.source.text,
  published_at: new Date().toISOString(),
});
let notify = () => {};
let seq = 0;
const turns = new Map();
const ask = createAskService({
  state: join(base, "mock-ai"),
  workspace: ws.root,
  settings: async () => ({
    available: true,
    protocols: [],
    providers: [],
    saved: [],
    configured: true,
    provider: "synthetic",
    model: "fixed-fixture",
    providerName: "合成固定回复（无模型）",
  }),
  configure: async () => ({}),
  models: async () => [],
  runtime: async () => ({
    onNotification(listener) {
      notify = listener;
      return () => {};
    },
    async close() {},
    async request(_method, params) {
      if (!params.contentBlocks) return {};
      const sessionId = params.sessionId;
      const turn = (turns.get(sessionId) ?? 0) + 1;
      turns.set(sessionId, turn);
      const emit = (type, data) => notify("session.event", { sessionId, event: { seq: seq++, type, data } });
      emit("user/message", { content: params.contentBlocks, source: { kind: "user" } });
      if (turn === 2) {
        for (const [name, meta] of [
          ["card", fixture.card],
          ["widget", fixture.widget],
        ]) {
          const callId = `synthetic-${name}`;
          const { kind: _kind, ...args } = meta;
          emit("tool/call", { callId, name: `kaitu_learning_${name}`, arguments: JSON.stringify(args) });
          emit("tool/result", {
            message: {
              toolCallId: callId,
              content: [{ type: "text", text: "Synthetic aid rendered; no quiz answer sent back." }],
            },
            meta,
          });
        }
      }
      const text =
        turn === 1
          ? fixture.question
          : turn === 2
            ? fixture.feedback
            : "合成样例到此结束，请回资料页保存学习记录；此处不连接真实模型。";
      emit("assistant/message", { message: { content: [{ type: "text", text }] } });
      notify("session.status", { sessionId, status: "idle" });
      return { messageId: `synthetic-${seq}` };
    },
  }),
});
const ui = await startUi(ws, { port, open: false, ask, collectorStateRoot: join(base, "collectors") });
let closed = false;
const close = async () => {
  if (closed) return;
  closed = true;
  await ui.close();
  rmSync(base, { recursive: true, force: true });
};
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => void close().then(() => process.exit(0)));
if (check) {
  try {
    const post = async (method, args) => {
      const res = await fetch(`${ui.url}/api/product/${method}`, {
        method: "POST",
        headers: { Origin: ui.url, "X-Kaitu": "1", "Content-Type": "application/json" },
        body: JSON.stringify(args),
      });
      assert.equal(res.status, 200, method);
      return res.json();
    };
    const topic = await post("learningStart", [{ title: fixture.title, source: fixture.source }]);
    const thread = await post("askCreate", []);
    await post("askSend", [thread.id, "Synthetic learning prompt"]);
    await post("askSend", [thread.id, fixture.answer]);
    for (const call of ["synthetic-card", "synthetic-widget"]) {
      const frame = await fetch(`${ui.url}/api/ask/teaching-frame?session=${thread.id}&call=${call}`);
      assert.equal(frame.status, 200);
      assert.match(frame.headers.get("content-security-policy"), /sandbox allow-scripts/);
      assert.match(await frame.text(), /复利/);
    }
    await post("learningSave", [
      { topic: topic.topic, ...fixture.checkin, operationId: "fixture-save-0001" },
    ]);
    const retry = await post("learningSave", [
      { topic: topic.topic, ...fixture.checkin, operationId: "fixture-save-0001" },
    ]);
    assert.equal(retry.replayed, true);
    const reopened = readLearning(new Workspace(ws.root, { maintain: false }), topic.topic);
    assert.ok(reopened.notes.includes(fixture.checkin.questions));
    assert.equal(reopened.next[0].title, fixture.checkin.next);
    assert.equal(reopened.sources.length, 1);
    console.log(
      "PASS: synthetic HTTP save/reopen and teaching-frame replay. No model or upstream OpenMAIC plugin used.",
    );
  } finally {
    await close();
  }
} else
  console.log(
    JSON.stringify(
      {
        url: ui.url,
        workspace: ws.root,
        syntheticOnly: true,
        modelCalls: 0,
        fixture: "scripts/fixtures/learning-openmaic.json",
        cleanup: "Ctrl+C removes this temporary workspace",
      },
      null,
      2,
    ),
  );
