import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { initWorkspace } from "@kaitu/core";
import { expect, test } from "vitest";
import { type AskEvent, createAskService } from "../../cli/src/ui/ask.js";
// @ts-expect-error Desktop adapters run as native ESM.
import { createSdkRuntime } from "../sdk-runtime.mjs";

// The real DSH subprocess talks only to this loopback provider with a synthetic key.
test("SDK streams raw reasoning and attachments, blocks changes while busy, and restores settings and history", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "kaitu-sdk-stream-")));
  const requests: Record<string, unknown>[] = [];
  let finish = () => {};
  const completed = Promise.withResolvers<void>();
  const server = createServer(async (request, response) => {
    let raw = "";
    for await (const part of request) raw += part;
    const body = JSON.parse(raw);
    requests.push(body);
    if (!body.stream) {
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ choices: [{ message: { content: "OK" } }] }));
      return;
    }
    response.setHeader("Content-Type", "text/event-stream");
    const chunk = (delta: object, finishReason: string | null = null) =>
      response.write(
        `data: ${JSON.stringify({ id: "synthetic", object: "chat.completion.chunk", choices: [{ index: 0, delta, finish_reason: finishReason }] })}\n\n`,
      );
    chunk({ role: "assistant", reasoning_content: "<signature>synthetic</signature>\nThought" });
    chunk({ content: "Synthetic " });
    finish = () => {
      chunk({ content: "answer" });
      chunk({}, "stop");
      response.end("data: [DONE]\n\n");
    };
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  let ask: ReturnType<typeof createAskService> | undefined;
  let sdk: ReturnType<typeof createSdkRuntime> | undefined;
  try {
    const ws = await initWorkspace(join(root, "workspace"));
    const home = join(root, "app");
    const cli = createRequire(new URL("../../cli/package.json", import.meta.url));
    const make = () => {
      sdk = createSdkRuntime({
        executable: process.execPath,
        modules: resolve("packages/cli/node_modules"),
        entry: cli.resolve("@deepseek-ai/dsh/lib/bin.js"),
        home,
        workspace: ws.root,
        plugin: resolve("packages/cli/dist/engine/sdk-plugin.mjs"),
        hostPlugin: resolve("packages/cli/dist/engine/sdk-host.mjs"),
        helper: resolve("packages/cli/dist/engine/sdk-credentials.mjs"),
      });
      return createAskService({
        state: home,
        workspace: ws.root,
        runtime: (mode, connection, textOnly) => sdk.runtime(mode, false, connection, textOnly),
        settings: (images) => sdk.settings(images),
        configure: (input) => sdk.configure(input),
        dispose: () => sdk.closeSupport(),
      });
    };
    ask = make();
    await ask.configure({
      choice: "builtin",
      provider: "kaitu-custom",
      model: "synthetic-model",
      api: "openai-completions",
      baseURL: url,
      apiKey: "synthetic-loopback-key",
      supportsImages: true,
    });
    const settings = readFileSync(join(home, "kaitu-ai.json"));
    await ask.close();
    ask = make();
    expect(await ask.settings()).toMatchObject({ configured: true, model: "synthetic-model", baseURL: url });
    const row = await ask.create();
    const events: AskEvent[] = [];
    ask.subscribe(row.id, (event) => {
      events.push(event);
      if (event.type === "session.status" && event.data.status === "idle") completed.resolve();
    });
    const png =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
    await ask.send(row.id, "Synthetic question", [
      { data: png, mimeType: "image/png" },
      {
        kind: "file",
        data: Buffer.from("Synthetic attachment").toString("base64"),
        mimeType: "text/plain",
        name: "synthetic.txt",
      },
    ]);
    await expect
      .poll(() =>
        events.some((event) => event.type === "assistant/delta" && event.data.text === "Synthetic "),
      )
      .toBe(true);
    await expect(ask.send(row.id, "Another question")).rejects.toMatchObject({ code: "AI_CONNECTION" });
    await expect(ask.configure({ choice: "external" })).rejects.toMatchObject({ code: "AI_CONNECTION" });
    finish();
    await completed.promise;
    const answer = ask.events(row.id).find((event) => event.type === "assistant/message");
    expect(answer?.data.message).toMatchObject({
      content: [
        { type: "reasoning", text: "<signature>synthetic</signature>\nThought" },
        { type: "text", text: "Synthetic answer" },
      ],
    });
    expect(events.at(-1)?.data).toMatchObject({ status: "idle" });
    expect(JSON.stringify(requests.filter((body) => body.stream))).toMatch(
      /data:image\/(?:png|webp);base64,/,
    );
    expect(ask.events(row.id).find((event) => event.type === "user/message")?.data.content).toMatchObject([
      { type: "text", text: "Synthetic question" },
      { type: "image" },
      { type: "file", attachment: expect.objectContaining({ name: "synthetic.txt" }) },
    ]);
    const names = requests
      .filter((body) => body.stream)
      .flatMap((body) => (body.tools as { function?: { name?: string } }[] | undefined) ?? [])
      .map((tool) => tool.function?.name);
    expect(names).toContain("kaitu_status");
    expect(names).not.toContain("schedule_create");
    expect(names).not.toContain("schedule_list");
    expect(names).not.toContain("ask_user_question");
    const history = ask.events(row.id);
    await ask.close();
    ask = make();
    expect(ask.events(row.id)).toEqual(history);
    expect(ask.events(row.id).some((event) => event.type === "assistant/delta")).toBe(false);
    expect(readFileSync(join(home, "kaitu-ai.json"))).toEqual(settings);
    expect((await ask.settings()).configured).toBe(true);
  } finally {
    finish();
    await ask?.close();
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
    rmSync(root, { recursive: true, force: true });
  }
});
