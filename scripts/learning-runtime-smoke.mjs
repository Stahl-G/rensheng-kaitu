// Actual bundled DSH engine and tools with a localhost scripted provider; no model inference.
import assert from "node:assert/strict";
import { appendFileSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
const base = realpathSync(mkdtempSync(join(tmpdir(), "kaitu-learning-runtime-")));
for (const [k, v] of Object.entries({
  HOME: "home",
  KAITU_APP_HOME: "app",
  KAITU_LOCAL_STATE_DIR: "state",
  XDG_STATE_HOME: "xdg",
  LOCALAPPDATA: "local",
  DSH_HOME: "dsh",
  DSH_AGENTS_HOME: "agents",
}))
  process.env[k] = join(base, v);
// biome-ignore lint/performance/noDelete: process.env coerces undefined to a string.
delete process.env.KAITU_DIR;
const root = fileURLToPath(new URL("../", import.meta.url));
const { initWorkspace, startLearning, readLearning, saveOnboardingChoices } = await import(
  "../packages/core/dist/index.js"
);
const { createSdkRuntime } = await import("../packages/desktop/sdk-runtime.mjs");
const { createAskService } = await import("../packages/cli/dist/ui/ask.js");
const { startUi } = await import("../packages/cli/dist/ui/server.js");
const fixture = JSON.parse(readFileSync(join(root, "scripts/fixtures/learning-openmaic.json"), "utf8"));
const ws = await initWorkspace(join(base, "workspace"), { timeZone: "Asia/Shanghai" });
await saveOnboardingChoices(ws, { seen: true });
const topic = await startLearning(ws, { title: fixture.title, source: fixture.source });
const requests = [];
const calls = [];

let sequence = 0;
const textOf = (m) => (typeof m?.content === "string" ? m.content : JSON.stringify(m?.content ?? ""));
const fake = createServer(async (req, res) => {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  if (req.url?.endsWith("/models")) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        object: "list",
        data: [{ id: "synthetic-learning", object: "model", owned_by: "local" }],
      }),
    );
    return;
  }
  const input = JSON.parse(raw || "{}");
  const names = (input.tools ?? []).map((t) => t.function?.name);
  requests.push({
    path: req.url,
    stream: input.stream,
    tools: names,
    messageCount: input.messages?.length,
    characters: raw.length,
  });
  writeFileSync(join(base, "requests.json"), JSON.stringify(requests, null, 2));
  let message = { role: "assistant", content: "OK" };
  if (input.stream) {
    const msgs = input.messages ?? [];
    const lastUser = msgs.findLastIndex(
      (m) => m.role === "user" && /ACTUAL_(START|ANSWER|SAVE|RESUME)/.test(textOf(m)),
    );
    const command = textOf(msgs[lastUser]);
    const action = [...command.matchAll(/ACTUAL_(START|ANSWER|SAVE|RESUME)/g)].at(-1)?.[1];
    const after = msgs.slice(lastUser + 1);
    const used = after.flatMap((m) => m.tool_calls ?? []).map((t) => t.function?.name);
    requests.at(-1).debug = { command: command.slice(-100), used, roles: msgs.map((m) => m.role) };
    writeFileSync(join(base, "requests.json"), JSON.stringify(requests, null, 2));
    let name;
    let args;
    if (action === "START" || action === "RESUME") {
      if (!used.includes("kaitu_learning")) {
        name = "kaitu_learning";
        args = { action: "read", topic: topic.topic };
      } else
        message = {
          role: "assistant",
          content:
            action === "RESUME" ? "从实际读回的待解问题继续：连续复利为什么会出现 e？" : fixture.question,
        };
    } else if (action === "ANSWER") {
      if (!used.includes("kaitu_learning_card")) {
        name = "kaitu_learning_card";
        args = { title: fixture.card.title, fragment: fixture.card.fragment };
      } else if (!used.includes("kaitu_learning_widget")) {
        name = "kaitu_learning_widget";
        args = {
          title: fixture.widget.title,
          widgetType: fixture.widget.widgetType,
          html: fixture.widget.html,
        };
      } else message = { role: "assistant", content: fixture.feedback };
    } else if (action === "SAVE") {
      if (!used.includes("kaitu_learning")) {
        name = "kaitu_learning";
        args = {
          action: "save",
          input: { topic: topic.topic, ...fixture.checkin, operationId: "runtime-real-tools-0001" },
        };
      } else message = { role: "assistant", content: "实际工具已完成保存，稍后可重开主题继续。" };
    }
    if (name) {
      assert.ok(names.includes(name), `missing actual tool ${name}`);
      calls.push(name);
      message = {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: `call-local-${++sequence}`,
            type: "function",
            function: { name, arguments: JSON.stringify(args) },
          },
        ],
      };
    }
  }
  const id = `chatcmpl-synthetic-${sequence}`;
  if (input.stream) {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
    const send = (delta, finish_reason = null) =>
      res.write(
        `data: ${JSON.stringify({ id, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model: "synthetic-learning", choices: [{ index: 0, delta, finish_reason }] })}\n\n`,
      );
    send(
      message.tool_calls
        ? { role: "assistant", tool_calls: message.tool_calls.map((c, index) => ({ ...c, index })) }
        : { role: "assistant", content: message.content },
    );
    send({}, message.tool_calls ? "tool_calls" : "stop");
    res.end("data: [DONE]\n\n");
  } else {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        id,
        object: "chat.completion",
        model: "synthetic-learning",
        choices: [{ index: 0, message, finish_reason: "stop" }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
    );
  }
});
await new Promise((r) => fake.listen(0, "127.0.0.1", r));
const modules = join(root, "packages/cli/node_modules");
const require = createRequire(join(root, "packages/cli/package.json"));
const sdk = createSdkRuntime({
  executable: process.execPath,
  modules,
  entry: require.resolve("@deepseek-ai/dsh/lib/bin.js"),
  home: join(base, "ai"),
  workspace: ws.root,
  plugin: join(root, "packages/cli/dist/engine/sdk-plugin.mjs"),
  hostPlugin: join(root, "packages/cli/dist/engine/sdk-host.mjs"),
  helper: join(root, "packages/cli/dist/engine/sdk-credentials.mjs"),
});
let ask;
let ui;
const create = () =>
  createAskService({
    state: join(base, "conversation"),
    workspace: ws.root,
    runtime: async (mode) => {
      const runtime = await sdk.runtime(mode);
      runtime.onNotification((method, params) => {
        if (method === "session.status" || params.event?.type === "turn/end")
          appendFileSync(join(base, "sdk-outcomes.jsonl"), `${JSON.stringify({ method, params })}\n`);
      });
      return runtime;
    },
    settings: () => sdk.settings(),
    configure: (input) => sdk.configure(input),
    models: (input) => sdk.models(input),
    support: (method, input) => sdk.support(method, input),
    dispose: () => sdk.closeSupport(),
  });
try {
  await sdk.configure({
    choice: "builtin",
    provider: "kaitu-custom",
    model: "synthetic-learning",
    api: "openai-completions",
    baseURL: `http://127.0.0.1:${fake.address().port}/v1`,
    apiKey: "synthetic-local-key",
  });
  ask = create();
  ui = await startUi(ws, { port: 0, open: false, ask });
  console.log(
    JSON.stringify({
      url: ui.url,
      base,
      topic: topic.topic,
      runtime: "actual-dsh",
      model: "local-scripted-http",
    }),
  );
  const thread = ask.create();
  const turn = async (command) => {
    const before = ask.events(thread.id).length;
    await ask.send(thread.id, command);
    const end = Date.now() + 45000;
    while (Date.now() < end) {
      const added = ask.events(thread.id).slice(before);
      const last = added.filter((e) => e.type === "session.status").at(-1);
      writeFileSync(join(base, "transcript.json"), JSON.stringify(ask.events(thread.id), null, 2));
      const failed = added.find((e) => e.type === "session.status" && e.data.error);
      if (failed) throw Error(String(failed.data.error));
      if (last?.data.status === "idle" && added.some((e) => e.type === "assistant/message")) {
        assert.ok(!added.some((e) => e.type === "tool/result" && e.data.message?.isError));
        console.log(
          JSON.stringify({
            command,
            tools: added.filter((e) => e.type === "tool/call").map((e) => e.data.name),
          }),
        );
        return;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    throw Error("turn timeout");
  };
  await turn("ACTUAL_START");
  await turn(`ACTUAL_ANSWER ${fixture.answer}`);
  await turn("ACTUAL_SAVE");
  assert.ok(readLearning(ws, topic.topic).notes.includes(fixture.checkin.questions));
  await ui.close();
  ui = undefined;
  ask = create();
  ui = await startUi(ws, { port: 0, open: false, ask });
  await turn("ACTUAL_RESUME");
  console.log(JSON.stringify({ passed: true, calls, requestCount: requests.length, notesSaved: true }));
  if (process.argv.includes("--hold")) {
    console.log(JSON.stringify({ hold: true, url: ui.url, base }));
    await new Promise((r) => process.once("SIGINT", r));
  }
} catch (error) {
  console.log(JSON.stringify({ error: String(error), base, calls, requests: requests.slice(-4) }));
  try {
    console.log(readFileSync(join(base, "sdk-outcomes.jsonl"), "utf8"));
  } catch {}
  process.exitCode = 1;
} finally {
  await ui?.close();
  await sdk.closeSupport();
  fake.closeAllConnections();
  await new Promise((r) => fake.close(r));
  console.log(`retained synthetic evidence ${base}`);
}
