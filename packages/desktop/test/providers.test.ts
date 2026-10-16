import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { KaituError, initWorkspace } from "@kaitu/core";
import { expect, test, vi } from "vitest";
import { createAskService } from "../../cli/src/ui/ask.js";
import { startUi } from "../../cli/src/ui/server.js";

vi.mock("../../core/dist/index.js", () => ({ KaituError }));
// @ts-expect-error Desktop entry points are shipped as native ESM.
const { createSdkRuntime } = await import("../sdk-runtime.mjs");
const executable = "/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness";
const archive = "/Applications/DeepSeek Harness.app/Contents/Resources/app.asar";
const available = existsSync(executable);
const secret = "synthetic-key-never-return-this";
async function setup() {
  const temp = mkdtempSync(join(tmpdir(), "kaitu-providers-"));
  const ws = await initWorkspace(join(temp, "workspace"), { timeZone: "Asia/Shanghai" });
  let status = 200;
  let reason = "";
  const requests: unknown[] = [];
  const fake = createServer(async (req, res) => {
    let input = "";
    for await (const chunk of req) input += chunk;
    requests.push({ url: req.url, auth: req.headers.authorization, body: JSON.parse(input) });
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify(
        status === 200
          ? { choices: [{ message: { content: "OK" } }] }
          : { error: { message: `${reason} ${secret}` } },
      ),
    );
  });
  await new Promise<void>((done) => fake.listen(0, "127.0.0.1", done));
  const address = fake.address() as { port: number };
  const home = join(temp, "ai");
  const sdk = createSdkRuntime({
    executable,
    archive,
    home,
    workspace: ws.root,
    helper: resolve("packages/desktop/sdk-credentials.mjs"),
  });
  const ask = createAskService({
    state: temp,
    workspace: ws.root,
    settings: sdk.settings,
    configure: sdk.configure,
    runtime: async () => {
      throw new Error("unused");
    },
  });
  const ui = await startUi(ws, { port: 0, open: false, ask });
  return {
    temp,
    home,
    sdk,
    requests,
    baseURL: `http://127.0.0.1:${address.port}/v1`,
    fail: (value: number, message: string) => {
      status = value;
      reason = message;
    },
    post: async (input: object) => {
      const res = await fetch(`${ui.url}/api/product/askConfigure`, {
        method: "POST",
        headers: { Origin: ui.url, "X-Kaitu": "1", "Content-Type": "application/json" },
        body: JSON.stringify([input]),
      });
      return { status: res.status, body: await res.json() };
    },
    async close() {
      await ui.close();
      await new Promise<void>((done) => fake.close(() => done()));
      rmSync(temp, { recursive: true, force: true });
    },
  };
}
test.skipIf(!available)(
  "validated credentials stay out of settings, API responses, patches and helper logs",
  async () => {
    const run = await setup();
    try {
      const result = await run.post({
        choice: "builtin",
        provider: "kaitu-custom",
        model: "local-model",
        baseURL: run.baseURL,
        apiKey: secret,
      });
      expect(result.status).toBe(200);
      expect(run.requests).toMatchObject([
        {
          url: "/v1/chat/completions",
          auth: `Bearer ${secret}`,
          body: { model: "local-model" },
        },
      ]);
      expect(JSON.stringify(result.body)).not.toContain(secret);
      expect(JSON.stringify(await run.sdk.settings())).not.toContain(secret);
      expect(readFileSync(join(run.home, "kaitu-ai.json"), "utf8")).not.toContain(secret);
      // @ts-expect-error Native ESM runtime configuration.
      const { providerPatch } = await import("../sdk-providers.mjs");
      expect(JSON.stringify(providerPatch(result.body))).not.toContain(secret);
      const logs = await new Promise<string>((done, reject) => {
        const child = spawn(executable, [resolve("packages/desktop/sdk-credentials.mjs"), "status"], {
          env: {
            ...process.env,
            ELECTRON_RUN_AS_NODE: "1",
            DSH_HOME: run.home,
            KAITU_DSH_MODULES: join(archive, "dsh/node_modules"),
          },
        });
        let output = "";
        child.stdout.on("data", (chunk) => {
          output += chunk;
        });
        child.stderr.on("data", (chunk) => {
          output += chunk;
        });
        child.on("error", reject);
        child.on("exit", () => done(output));
        child.stdin.end(JSON.stringify({ ref: "KAITU_KAITU_CUSTOM_API_KEY" }));
      });
      expect(logs).not.toContain(secret);
      expect(JSON.parse(logs).configured).toBe(true);
      const kept = await run.post({
        choice: "builtin",
        provider: "kaitu-custom",
        model: "other-model",
        baseURL: run.baseURL,
      });
      expect(kept.status).toBe(200);
      expect(kept.body.model).toBe("other-model");
    } finally {
      await run.close();
    }
  },
);
test.skipIf(!available)(
  "connection failures remain actionable and distinct through the HTTP API without saving failed settings",
  async () => {
    const run = await setup();
    try {
      const input = {
        choice: "builtin",
        provider: "kaitu-custom",
        model: "local-model",
        baseURL: run.baseURL,
        apiKey: secret,
      };
      for (const [status, reason, code] of [
        [401, "invalid api key", "AI_KEY"],
        [402, "balance", "AI_QUOTA"],
        [429, "rate limit", "AI_RATE_LIMIT"],
        [404, "model not found", "AI_MODEL"],
        [500, "broken", "AI_CONNECTION"],
      ] as const) {
        run.fail(status, reason);
        const result = await run.post(input);
        expect(result.status).toBeGreaterThanOrEqual(400);
        expect(result.body.code).toBe(code);
        expect(JSON.stringify(result.body)).not.toContain(secret);
        expect(existsSync(join(run.home, "kaitu-ai.json"))).toBe(false);
      }
      const result = await run.post({ ...input, baseURL: "http://127.0.0.1:1/v1" });
      expect(result.body.code).toBe("AI_NETWORK");
      expect(existsSync(run.home)).toBe(false);
    } finally {
      await run.close();
    }
  },
);
