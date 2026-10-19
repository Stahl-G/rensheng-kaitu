// Actual installed Claude ACP CLI and its file/MCP tools with a localhost scripted provider.
// Isolated HOME and allowlisted environment: never uses the user's login or a paid model.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
const base = realpathSync(mkdtempSync(join(tmpdir(), "kaitu-learning-acp-")));
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
const cli = process.argv[2];
if (!cli || !isAbsolute(cli))
  throw Error("Pass the absolute path to an already installed claude-agent-acp CLI");
const { initWorkspace, startLearning, readLearning, saveOnboardingChoices } = await import(
  "../packages/core/dist/index.js"
);
const { createAgentRuntime } = await import("../packages/cli/dist/local-agents/runtime.js");
const { localAgent } = await import("../packages/cli/dist/local-agents/agents.js");
const { createAskService } = await import("../packages/cli/dist/ui/ask.js");
const { startUi } = await import("../packages/cli/dist/ui/server.js");
const fixture = JSON.parse(readFileSync(join(root, "scripts/fixtures/learning-openmaic.json"), "utf8"));
const ws = await initWorkspace(join(base, "workspace"), { timeZone: "Asia/Shanghai" });
await saveOnboardingChoices(ws, { seen: true });
const topic = await startLearning(ws, { title: fixture.title, source: fixture.source });
const prefix = `learning/${topic.topic}`;
const source = topic.sources[0].file;
const notes = `${prefix}/notes.md`;
const status = `${prefix}/STATUS.md`;
const savedNotes = `# 学习笔记\n\n## 合成 ACP 体验\n\n### 我的理解\n${fixture.checkin.understanding}\n\n### 未解问题\n${fixture.checkin.questions}\n\n### 下一步\n${fixture.checkin.next}\n`;
const originalStatus = readFileSync(join(ws.root, status), "utf8");
const savedStatus = originalStatus.replace(
  "next: []",
  `next:\n  - id: 01M5AKHD7SN1SGCF66XGHCGVC6\n    title: ${JSON.stringify(fixture.checkin.next)}\n    status: todo`,
);
assert.notEqual(savedStatus, originalStatus);
const requests = [];
let sequence = 0;
const server = createServer(async (req, res) => {
  let raw = "";
  for await (const part of req) raw += part;
  const input = JSON.parse(raw || "{}");
  if (req.url?.includes("count_tokens")) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end('{"input_tokens":1000}');
    return;
  }
  if (!req.url?.includes("/messages")) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end("{}");
    return;
  }
  const msgs = input.messages ?? [];
  const tools = (input.tools ?? []).map((t) => t.name);
  const textOf = (m) =>
    typeof m.content === "string"
      ? m.content
      : (m.content ?? [])
          .filter((c) => c.type === "text")
          .map((c) => c.text)
          .join("\n");
  const lastUser = msgs.findLastIndex(
    (m) => m.role === "user" && /ACP_(START|ANSWER|SAVE|RESUME)/.test(textOf(m)),
  );
  const command = lastUser >= 0 ? textOf(msgs[lastUser]) : "";
  const action = [...command.matchAll(/ACP_(START|ANSWER|SAVE|RESUME)/g)].at(-1)?.[1];
  const used = msgs
    .slice(lastUser + 1)
    .flatMap((m) => (Array.isArray(m.content) ? m.content : []))
    .filter((c) => c.type === "tool_use");
  const record = {
    path: req.url,
    tools,
    characters: raw.length,
    command: command.slice(-90),
    used: used.map((c) => ({ name: c.name, input: c.input })),
  };
  requests.push(record);
  writeFileSync(join(base, "requests.json"), JSON.stringify(requests, null, 2));
  let toolName;
  let args;
  let text;
  const readName = tools.find((n) => n.endsWith("__read_file"));
  const read = (path) => {
    toolName = readName;
    args = { path };
  };
  const readBefore = (path) => used.some((t) => t.name === readName && t.input.path === path);
  const writtenBefore = (path) =>
    used.some((t) => t.name === "Write" && t.input.file_path === join(ws.root, path));
  if (action === "START" || action === "RESUME") {
    const path = [status, notes, source].find((p) => !readBefore(p));
    if (path) read(path);
    else
      text =
        action === "RESUME"
          ? `读回了你上次的问题：${fixture.checkin.questions} 先说说你觉得计息次数增加时，收益是否会一直无界增加？`
          : fixture.question;
  } else if (action === "ANSWER") text = fixture.feedback;
  else if (action === "SAVE") {
    if (!readBefore(notes)) read(notes);
    else if (!writtenBefore(notes)) {
      toolName = "Write";
      args = { file_path: join(ws.root, notes), content: savedNotes };
    } else if (!used.some((t) => t.name === "Read" && t.input.file_path === join(ws.root, status))) {
      toolName = "Read";
      args = { file_path: join(ws.root, status) };
    } else if (!writtenBefore(status)) {
      toolName = "Write";
      args = { file_path: join(ws.root, status), content: savedStatus };
    } else text = "已用现有文件工具保存理解、未解问题和下一步，可以从同一主题接着学。";
  } else text = "本机受控模型只用于合成学习验收。";
  const block = toolName
    ? { type: "tool_use", id: `toolu_local_${++sequence}`, name: toolName, input: args }
    : { type: "text", text };
  if (toolName) assert.ok(tools.includes(toolName), `missing tool ${toolName}`);
  const message = {
    id: `msg_local_${sequence}`,
    type: "message",
    role: "assistant",
    model: input.model,
    content: [block],
    stop_reason: toolName ? "tool_use" : "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 100, output_tokens: 20 },
  };
  if (!input.stream) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(message));
    return;
  }
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
  const send = (event, data) =>
    res.write(`event: ${event}\ndata: ${JSON.stringify({ type: event, ...data })}\n\n`);
  send("message_start", { message: { ...message, content: [], stop_reason: null } });
  send("content_block_start", {
    index: 0,
    content_block: toolName ? { ...block, input: {} } : { type: "text", text: "" },
  });
  send("content_block_delta", {
    index: 0,
    delta: toolName
      ? { type: "input_json_delta", partial_json: JSON.stringify(args) }
      : { type: "text_delta", text },
  });
  send("content_block_stop", { index: 0 });
  send("message_delta", {
    delta: { stop_reason: message.stop_reason, stop_sequence: null },
    usage: { output_tokens: 20 },
  });
  send("message_stop", {});
  res.end();
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
mkdirSync(join(base, "home"), { recursive: true });
mkdirSync(join(base, "tmp"));
const env = {
  PATH: process.env.PATH,
  HOME: join(base, "home"),
  TMPDIR: join(base, "tmp"),
  CLAUDE_CONFIG_DIR: join(base, "claude"),
  ANTHROPIC_BASE_URL: `http://127.0.0.1:${server.address().port}`,
  ANTHROPIC_AUTH_TOKEN: "synthetic-local-only",
  ANTHROPIC_API_KEY: "",
  CLAUDE_CODE_OAUTH_TOKEN: "",
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
  DISABLE_AUTOUPDATER: "1",
  ANTHROPIC_MODEL: "claude-sonnet-4-6",
};
const create = () =>
  createAskService({
    state: join(base, "conversation"),
    workspace: ws.root,
    runtime: () =>
      createAgentRuntime({
        agent: localAgent("claude"),
        path: cli,
        workspace: ws.root,
        state: join(base, "agent-state"),
        mcp: {
          command: process.execPath,
          args: [join(root, "packages/cli/dist/engine/mcp-stdio.mjs"), ws.root],
        },
        env,
      }),
    settings: async () => ({
      configured: true,
      choice: "local",
      provider: "claude",
      providerName: "实际 Claude ACP / 本机受控响应",
      model: "claude-sonnet-4-6",
      backend: "claude-local-controlled",
      fullOnly: true,
      protocols: [],
      providers: [],
    }),
    configure: async () => ({}),
    models: async () => [],
  });
let ask = create();
let ui;
try {
  ui = await startUi(ws, { port: 0, open: false, ask });
  const thread = ask.create();
  await ask.setMode(thread.id, "full", true);
  console.log(
    JSON.stringify({
      base,
      url: ui.url,
      topic: topic.topic,
      runtime: "actual-claude-agent-acp",
      model: "local-controlled-anthropic",
    }),
  );
  const turn = async (command) => {
    const before = ask.events(thread.id).length;
    await Promise.race([
      ask.send(thread.id, command),
      new Promise((_, reject) => {
        const timeout = setTimeout(() => reject(Error("ACP turn timeout")), 90000);
        timeout.unref();
      }),
    ]);
    const added = ask.events(thread.id).slice(before);
    writeFileSync(join(base, "transcript.json"), JSON.stringify(ask.events(thread.id), null, 2));
    assert.ok(added.some((e) => e.type === "assistant/message"));
    const errors = added.filter((e) => e.type === "tool/result" && e.data.message?.isError);
    assert.ok(
      errors.every(
        (e) =>
          JSON.stringify(e.data.message.content).includes("ENOENT") &&
          JSON.stringify(e.data.message.content).includes("notes.md"),
      ),
      "unexpected tool error",
    );
    console.log(
      JSON.stringify({ command, tools: added.filter((e) => e.type === "tool/call").map((e) => e.data.name) }),
    );
  };
  await turn("ACP_START 请按 learn-topic 教学，读取主题材料，一次问一个问题。");
  await turn(`ACP_ANSWER ${fixture.answer}`);
  await turn(
    `ACP_SAVE 请保存我表达的理解：${fixture.checkin.understanding}。我的问题：${fixture.checkin.questions}。下一步：${fixture.checkin.next}。没有教学写入工具时用现有文件工具，沿用相同 Markdown。`,
  );
  assert.ok(readLearning(ws, topic.topic).notes.includes(fixture.checkin.questions));
  assert.equal(readLearning(ws, topic.topic).next[0].title, fixture.checkin.next);
  await ui.close();
  ui = undefined;
  ask = create();
  ui = await startUi(ws, { port: 0, open: false, ask });
  await turn("ACP_RESUME 从同一主题上次保存的问题继续，一次问一个问题。");
  console.log(JSON.stringify({ passed: true, requests: requests.length, base }));
  if (process.argv.includes("--hold")) {
    console.log(JSON.stringify({ hold: true, url: ui.url, base }));
    await new Promise((r) => process.once("SIGINT", r));
  }
} catch (error) {
  console.log(JSON.stringify({ error: String(error), base, requestCount: requests.length }));
  process.exitCode = 1;
} finally {
  await ui?.close();
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  console.log(`retained synthetic evidence ${base}`);
}
