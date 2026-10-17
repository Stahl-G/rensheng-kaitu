import { spawn } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { connectAcp } from "../src/local-agents/acp.js";
import { detectAgents } from "../src/local-agents/detection.js";
import { createLocalAgentRuntime } from "../src/local-agents/runtime.js";
import { createAskService } from "../src/ui/ask.js";

const fixture = fileURLToPath(new URL("./fixtures/local-agent.mjs", import.meta.url));
const waitFor = async (check: () => boolean) => {
  const deadline = Date.now() + 5000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("mock agent timed out");
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
};
function setup() {
  const root = mkdtempSync(join(tmpdir(), "kaitu-local-agents-"));
  const bin = join(root, "bin");
  mkdirSync(bin);
  for (const name of ["claude", "codex", "gemini", "acp-agent"]) {
    copyFileSync(fixture, join(bin, name));
    chmodSync(join(bin, name), 0o755);
  }
  return {
    root,
    bin,
    env: {
      HOME: root,
      PATH: `${bin}:${dirname(process.execPath)}`,
      MOCK_RECORD: join(root, "calls.jsonl"),
      EXAMPLE_API_KEY: "must-not-leak",
      KAITU_SECRET: "must-not-leak",
    },
  };
}
describe("local agents", () => {
  it("detects fake CLIs, streams, resumes across runtime restarts and cancels without granting scoped command tools", async () => {
    const { root, env } = setup();
    try {
      const detected = await detectAgents(undefined, env);
      expect(detected.map((agent) => agent.status)).toEqual(["ready", "ready", "unknown"]);
      for (const agent of ["claude", "codex", "gemini"]) {
        const workspace = join(root, agent);
        mkdirSync(workspace);
        const mode = agent === "claude" ? "scoped" : "full";
        const runtime = () =>
          createLocalAgentRuntime({
            selection: { agent },
            mode,
            workspace,
            state: join(root, "state"),
            mcp: { command: process.execPath, args: ["mock-mcp", workspace] },
            env,
          });
        if (mode === "full")
          await expect(
            createLocalAgentRuntime({
              selection: { agent },
              mode: "scoped",
              workspace,
              state: join(root, "state"),
              mcp: { command: process.execPath, args: [] },
              env,
            }),
          ).rejects.toThrow();
        const service = () =>
          createAskService({
            workspace,
            state: join(root, "state"),
            runtime,
            settings: async () => ({ configured: true, provider: agent, model: "default" }),
            configure: async () => ({}),
          });
        let ask = service();
        const thread = ask.create();
        if (mode === "full") await ask.setMode(thread.id, "full", true);
        const seen: string[] = [];
        ask.subscribe(thread.id, (event) => {
          if (event.type === "assistant/message") seen.push(JSON.stringify(event.data));
        });
        await ask.send(thread.id, "hello");
        await waitFor(() => ask.events(thread.id).at(-1)?.data.status === "idle");
        expect(seen.length).toBeGreaterThanOrEqual(2);
        expect(ask.events(thread.id).filter((event) => event.type === "assistant/message")).toHaveLength(1);
        await ask.close();
        ask = service();
        await ask.send(thread.id, "continue");
        await waitFor(() => ask.events(thread.id).at(-1)?.data.status === "idle");
        const messages = ask.events(thread.id).filter((event) => event.type === "assistant/message");
        expect((messages.at(-1)?.data.message as { content: { text: string }[] }).content[0].text).toBe(
          "接着说",
        );
        await ask.send(thread.id, "wait");
        await waitFor(
          () => ask.events(thread.id).filter((event) => event.type === "assistant/message").length === 3,
        );
        await ask.cancel(thread.id);
        await waitFor(() => ask.events(thread.id).at(-1)?.data.status === "idle");
        await ask.close();
      }
      const calls = readFileSync(env.MOCK_RECORD, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      expect(calls).toHaveLength(9);
      expect(calls.every((call) => !call.leaked)).toBe(true);
      for (const call of calls.filter((call) => call.kind === "claude")) {
        expect(call.args[call.args.indexOf("--tools") + 1].split(",")).toEqual(["WebSearch", "WebFetch"]);
        expect(call.args[call.args.indexOf("--permission-mode") + 1]).toBe("dontAsk");
        expect(JSON.parse(call.args[call.args.indexOf("--mcp-config") + 1]).mcpServers.kaitu.args[1]).toBe(
          call.cwd,
        );
        expect(call.args).not.toContain("bypassPermissions");
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  it("denies a fake ACP agent permission request in scoped transport and advertises no client filesystem or terminal", async () => {
    const { root, bin, env } = setup();
    const child = spawn(join(bin, "acp-agent"), [], { env, stdio: ["pipe", "pipe", "pipe"] });
    const rpc = connectAcp(child, { full: false, update: () => {} });
    try {
      await rpc.request("initialize", { protocolVersion: 1, clientCapabilities: {} });
      await rpc.request("session/new", { cwd: root, mcpServers: [] });
      rpc.notify("initialized", {});
      await rpc.request("session/prompt", {
        sessionId: "mock-session",
        prompt: [{ type: "text", text: "test" }],
      });
      await waitFor(() => existsSync(env.MOCK_RECORD));
      expect(JSON.parse(readFileSync(env.MOCK_RECORD, "utf8").trim())).toEqual({
        outcome: { outcome: "cancelled" },
      });
    } finally {
      rpc.close();
      child.kill("SIGKILL");
      rmSync(root, { recursive: true, force: true });
    }
  });
});
