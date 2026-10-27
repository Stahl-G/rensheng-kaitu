import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { expect, test } from "vitest";
import { createAskService } from "../../cli/src/ui/ask.js";
// @ts-expect-error Desktop entry points are native ESM.
const { createSdkRuntime } = await import("../sdk-runtime.mjs");

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "kaitu-siwc-"));
  const home = join(root, "home");
  const workspace = join(root, "workspace");
  const payload = join(root, "payload with spaces");
  for (const dir of [home, workspace, payload]) mkdirSync(dir);
  const calls = join(root, "calls.jsonl");
  const unavailable = join(root, "unavailable");
  const helper = join(root, "credentials.mjs");
  writeFileSync(
    helper,
    `for await (const chunk of process.stdin) {}\nprocess.stdout.write(process.argv[2] === 'catalog' ? '[]' : '{"configured":true,"search":{}}');`,
  );
  const modules = fileURLToPath(new URL("../../cli/node_modules", import.meta.url));
  const protocol = pathToFileURL(
    createRequire(join(modules, "package.json")).resolve("@deepseek-ai/dsh-sdk-protocol"),
  ).href;
  const entry = join(root, "host.mjs");
  writeFileSync(join(payload, "chatgpt-siwc.mjs"), "synthetic bundled provider");
  writeFileSync(
    entry,
    `
import {appendFileSync, existsSync, readFileSync} from 'node:fs';
import {JsonRpcLineTransport} from ${JSON.stringify(protocol)};
const rpc = new JsonRpcLineTransport(process.stdin, process.stdout);
let seq = process.pid * 100000;
rpc.onRequest(async (method, params) => {
  appendFileSync(${JSON.stringify(calls)}, JSON.stringify({method, params})+'\\n');
  if (method === 'initialize') {
    const patch = JSON.parse(readFileSync(process.argv[process.argv.indexOf('--patch') + 1], 'utf8'));
    const provider = patch.flatMap(row => row.insert ?? []).find(row => row.id === 'chatgpt-siwc');
    if (readFileSync(provider.name, 'utf8') !== 'synthetic bundled provider') throw Error('missing bundled provider');
    return {};
  }
  if (method === 'shutdown') { setImmediate(() => process.exit(0)); return {}; }
  if (method === 'kaitu/providers') return [{provider:'deepseek-official',models:['synthetic']}];
  if (method === 'kaitu/saveProvider') return [];
  if (method.startsWith('kaitu/siwc/')) {
    if (existsSync(${JSON.stringify(unavailable)})) throw Error('ChatGPT service unavailable');
    if (method.endsWith('/models')) return [{id:'synthetic',name:'Synthetic'}];
    return {authenticated:!method.endsWith('/signOut'),planEnabled:true,signingIn:false,activeAccountId:'synthetic',models:[]};
  }
  if (method === 'session/prompt') {
    rpc.notify('session.event', {sessionId:params.sessionId,event:{seq:seq++,type:'user/message',data:{content:params.contentBlocks,source:{kind:'user'}}}});
    rpc.notify('session.event', {sessionId:params.sessionId,event:{seq:seq++,type:'assistant/message',data:{message:{content:[{type:'text',text:'synthetic answer'}]}}}});
    rpc.notify('session.status', {sessionId:params.sessionId,status:'idle'});
    return {accepted:true};
  }
  throw Error('unexpected request');
});
rpc.start();`,
  );
  const sdk = createSdkRuntime({
    executable: process.execPath,
    archive: root,
    home,
    workspace,
    plugin: join(payload, "plugin.mjs"),
    hostPlugin: join(payload, "sdk-host.mjs"),
    helper,
    modules,
    entry,
  });
  const select = (provider = "chatgpt-siwc") =>
    writeFileSync(
      join(home, "kaitu-ai.json"),
      JSON.stringify({ choice: "builtin", provider, model: "synthetic" }),
    );
  const requests = () =>
    readFileSync(calls, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
  return { root, home, workspace, sdk, select, requests, unavailable };
}

test("idle sign-out invalidates real Ask caches; re-login sends spawn a fresh process without saving the model", async () => {
  const f = fixture();
  f.select();
  const ask = createAskService({
    state: join(f.root, "ask"),
    workspace: f.workspace,
    settings: f.sdk.settings,
    configure: f.sdk.configure,
    models: f.sdk.models,
    runtime: (mode, connection, textOnly) => f.sdk.runtime(mode, false, connection, textOnly),
  });
  try {
    const row = await ask.create();
    await ask.send(row.id, "first turn");
    const statusReads = () => f.requests().filter((row) => row.method === "kaitu/siwc/status").length;
    const reads = statusReads();
    await f.sdk.settings();
    await f.sdk.support("siwc/status");
    await f.sdk.settings();
    expect(statusReads()).toBe(reads + 1);
    await f.sdk.support("siwc/signOut");
    // The synthetic server represents the same account having signed back in; no configure call.
    await f.sdk.support("siwc/status");
    await ask.send(row.id, "after re-login");
    await ask.send(row.id, "another turn");
    expect(
      f.requests().filter((row) => row.method === "initialize" && !row.params.capabilities),
    ).toHaveLength(2);
    expect(ask.events(row.id).filter((row) => row.type === "assistant/message")).toHaveLength(3);
    const full = await f.sdk.runtime("full");
    await full.close();
  } finally {
    await ask.close();
    await f.sdk.closeSupport();
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("non-ChatGPT saves and saved models work when SIWC is unavailable; invalid ChatGPT selections preserve settings", async () => {
  const f = fixture();
  f.select("deepseek-official");
  writeFileSync(f.unavailable, "synthetic outage");
  try {
    expect(
      (await f.sdk.configure({ choice: "builtin", provider: "deepseek-official", model: "synthetic" }))
        .configured,
    ).toBe(true);
    expect((await f.sdk.catalogSettings(true)).saved[0].provider).toBe("deepseek-official");
    expect(f.requests().some((row) => row.method.startsWith("kaitu/siwc/"))).toBe(false);
    rmSync(f.unavailable);
    await expect(
      f.sdk.configure({ choice: "builtin", provider: "chatgpt-siwc", model: "unlisted" }),
    ).rejects.toMatchObject({ code: "AI_MODEL" });
    expect(JSON.parse(readFileSync(join(f.home, "kaitu-ai.json"), "utf8")).provider).toBe(
      "deepseek-official",
    );
  } finally {
    await f.sdk.closeSupport();
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("sign-out rejects an overlapping ChatGPT startup before it can create a chat process", async () => {
  const f = fixture();
  f.select();
  try {
    const starting = f.sdk.runtime();
    const rejected = expect(starting).rejects.toMatchObject({ code: "AI_CONNECTION" });
    await f.sdk.support("siwc/signOut");
    await rejected;
    expect(
      f.requests().filter((row) => row.method === "initialize" && !row.params.capabilities),
    ).toHaveLength(0);
  } finally {
    await f.sdk.closeSupport();
    rmSync(f.root, { recursive: true, force: true });
  }
});
