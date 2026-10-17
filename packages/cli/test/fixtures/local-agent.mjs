#!/usr/bin/env node
import { appendFileSync } from "node:fs";
import { basename } from "node:path";
import { createInterface } from "node:readline";

const kind = basename(process.argv[1]);
const args = process.argv.slice(2);
const out = (frame) => process.stdout.write(`${JSON.stringify(frame)}\n`);
if (args.includes("--version")) {
  console.log(`${kind} mock-1`);
} else if (args.includes("--help")) {
  console.log("--tools --permission-mode --strict-mcp-config --settings --setting-sources");
} else if (args.includes("status")) {
  console.log(JSON.stringify({ loggedIn: true }));
} else if (kind === "acp-agent") {
  let promptId;
  const lines = createInterface({ input: process.stdin });
  lines.on("line", (line) => {
    const frame = JSON.parse(line);
    if (frame.id === "permission") {
      appendFileSync(process.env.MOCK_RECORD, `${JSON.stringify(frame.result)}\n`);
      out({ jsonrpc: "2.0", id: promptId, result: { stopReason: "end_turn" } });
    } else if (frame.method === "initialize")
      out({
        jsonrpc: "2.0",
        id: frame.id,
        result: { protocolVersion: 1, agentCapabilities: { loadSession: true } },
      });
    else if (frame.method === "session/new")
      out({ jsonrpc: "2.0", id: frame.id, result: { sessionId: "mock-session" } });
    else if (frame.method === "session/prompt") {
      promptId = frame.id;
      out({
        jsonrpc: "2.0",
        id: "permission",
        method: "session/request_permission",
        params: { sessionId: "mock-session", options: [{ optionId: "yes", kind: "allow_once" }] },
      });
    }
  });
} else {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  appendFileSync(
    process.env.MOCK_RECORD,
    `${JSON.stringify({ kind, args, leaked: !!process.env.EXAMPLE_API_KEY || !!process.env.KAITU_SECRET, cwd: process.cwd() })}\n`,
  );
  const resumed = args.includes("--resume") || args.includes("resume");
  const text = resumed ? "接着说" : "你好";
  if (kind === "claude") out({ type: "system", session_id: "mock-session" });
  if (kind === "codex") out({ type: "thread.started", thread_id: "mock-session" });
  if (kind === "gemini") out({ type: "init", session_id: "mock-session" });
  for (const part of [text.slice(0, 1), text.slice(1)]) {
    if (kind === "claude")
      out({ type: "stream_event", event: { delta: { type: "text_delta", text: part } } });
    if (kind === "codex") out({ type: "item.completed", item: { type: "agent_message", text: part } });
    if (kind === "gemini") out({ type: "message", role: "assistant", content: part, delta: true });
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  if (input.includes("wait")) setInterval(() => {}, 1000);
}
