import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { type OnboardingMatter, initWorkspace, readOnboardingMatter } from "@kaitu/core";
import { expect, test } from "vitest";
import { createAskService } from "../../cli/src/ui/ask.js";
import { productRequest } from "../../cli/src/ui/product.js";
// @ts-expect-error Desktop adapters run as native ESM.
import { createSdkRuntime } from "../sdk-runtime.mjs";

// Exercise the same product command as the desktop onboarding UI and capture DSH's provider request.
test("desktop first-use model gets a redacted submission only, with no workspace tools or instructions", async ({
  onTestFailed,
}) => {
  let stage = "setup";
  onTestFailed(() => console.error("First-use SDK stage:", stage));
  const root = realpathSync(mkdtempSync(join(tmpdir(), "kaitu-onboard-privacy-")));
  const requests: Record<string, unknown>[] = [];
  const draft = { goal: "合成目标", current: "待核对", next: "写第一行" };
  const server = createServer(async (request, response) => {
    let raw = "";
    for await (const part of request) raw += part;
    const body = JSON.parse(raw);
    requests.push(body);
    stage = body.stream ? "provider.stream.request" : "provider.request";
    if (!body.stream) {
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ choices: [{ message: { content: "OK" } }] }));
      return;
    }
    response.setHeader("Content-Type", "text/event-stream");
    for (const [delta, finish_reason] of [
      [{ role: "assistant", content: JSON.stringify(draft) }, null],
      [{}, "stop"],
    ]) {
      response.write(
        `data: ${JSON.stringify({ id: "synthetic", object: "chat.completion.chunk", choices: [{ index: 0, delta, finish_reason }] })}\n\n`,
      );
    }
    response.end("data: [DONE]\n\n");
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  let ask: ReturnType<typeof createAskService> | undefined;
  try {
    const ws = await initWorkspace(join(root, "workspace"));
    const home = join(root, "app");
    const cli = createRequire(new URL("../../cli/package.json", import.meta.url));
    const sdk = createSdkRuntime({
      executable: process.execPath,
      modules: resolve("packages/cli/node_modules"),
      entry: cli.resolve("@deepseek-ai/dsh/lib/bin.js"),
      home,
      workspace: ws.root,
      plugin: resolve("packages/cli/dist/engine/sdk-plugin.mjs"),
      hostPlugin: resolve("packages/cli/dist/engine/sdk-host.mjs"),
      helper: resolve("packages/cli/dist/engine/sdk-credentials.mjs"),
    });
    ask = createAskService({
      state: home,
      workspace: ws.root,
      runtime: (mode, connection, textOnly) => sdk.runtime(mode, false, connection, textOnly),
      settings: (images) => sdk.settings(images),
      configure: (input) => sdk.configure(input),
      models: async () => [],
      dispose: () => sdk.closeSupport(),
    });
    await ask.configure({
      choice: "builtin",
      provider: "kaitu-custom",
      model: "synthetic-model",
      api: "openai-completions",
      baseURL: `http://127.0.0.1:${(server.address() as { port: number }).port}`,
      apiKey: "synthetic-loopback-key",
    });
    stage = "configuration.saved";
    const credential = "sk-notARealCredential0123456789";
    const privatePath = "/Users/synthetic/private-notes.md";
    const original = `第一次提交的合成内容。API Key: ${credential}，文件在 ${privatePath}`;
    const before = requests.length;
    const row = (await productRequest(ws, "onboardingMatterSave", [original], ask)) as OnboardingMatter;
    expect(requests).toHaveLength(before);
    stage = "original.saved";
    ws.writeText("AGENTS.md", "# Workspace instructions\n\nSYNTHETIC_UNRELATED_WORKSPACE_INSTRUCTIONS");
    const result = (await productRequest(
      ws,
      "onboardingMatterOrganize",
      [row.source, "zh-CN"],
      ask,
    )) as OnboardingMatter;
    stage = "draft.received";
    expect(result.draft).toEqual(draft);
    expect(readOnboardingMatter(ws, row.source).text.trim()).toBe(original);
    expect(ask.list()).toEqual([]);
    const submissions = requests.slice(before).filter(({ stream }) => stream);
    expect(submissions).toHaveLength(1);
    const outgoing = JSON.stringify(submissions[0]);
    expect(outgoing).toContain("第一次提交的合成内容");
    expect(outgoing).toContain("密钥已去掉");
    expect(outgoing).toContain("本机路径已去掉");
    expect(outgoing).not.toContain(credential);
    expect(outgoing).not.toContain(privatePath);
    expect(outgoing).not.toContain(ws.root);
    expect(outgoing).not.toContain("SYNTHETIC_UNRELATED_WORKSPACE_INSTRUCTIONS");
    const names = (submissions[0]?.tools as { function?: { name?: string } }[] | undefined)?.map(
      (tool) => tool.function?.name,
    );
    expect(names ?? []).toEqual([]);
  } finally {
    stage = `cleanup after ${stage}`;
    await ask?.close();
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
    rmSync(root, { recursive: true, force: true });
  }
});
