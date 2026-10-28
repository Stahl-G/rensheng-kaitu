import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
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
  const holdModels = join(root, "hold-models");
  const failModels = join(root, "fail-models");
  const noDefault = join(root, "no-default");
  const helper = join(root, "credentials.mjs");
  const credentialCalls = join(root, "credential-calls.jsonl");
  writeFileSync(
    helper,
    `import {appendFileSync} from 'node:fs'; for await (const chunk of process.stdin) {}\nappendFileSync(${JSON.stringify(credentialCalls)}, JSON.stringify(process.argv[2])+'\\n'); process.stdout.write(process.argv[2] === 'catalog' ? '[]' : '{"configured":true,"search":{}}');`,
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
  appendFileSync(${JSON.stringify(calls)}, JSON.stringify({method, params, hostCwd:process.cwd()})+'\\n');
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
    if (method.endsWith('/models')) {
      if (existsSync(${JSON.stringify(failModels)})) throw Error('synthetic model failure');
      while (existsSync(${JSON.stringify(holdModels)})) await new Promise(resolve => setTimeout(resolve, 10));
      return [{id:'synthetic',name:'Synthetic',reasoning:{...(existsSync(${JSON.stringify(noDefault)}) ? {} : {defaultEffort:'low'}),efforts:[{id:'low',name:'Low'},{id:'high',name:'High'}]}}];
    }
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
  return {
    root,
    home,
    workspace,
    sdk,
    select,
    requests,
    unavailable,
    holdModels,
    failModels,
    noDefault,
    credentialCalls,
  };
}

test("ChatGPT conversation startup does not launch the unrelated provider catalog", async () => {
  const f = fixture();
  f.select();
  try {
    const runtime = await f.sdk.runtime();
    await runtime.close();
    const calls = existsSync(f.credentialCalls) ? readFileSync(f.credentialCalls, "utf8") : "";
    expect(calls).not.toContain('"catalog"');
    // Catalogs remain available when explicitly requested by the picker.
    await f.sdk.catalogSettings(true);
    expect(readFileSync(f.credentialCalls, "utf8")).toContain('"catalog"');
  } finally {
    await f.sdk.closeSupport();
    rmSync(f.root, { recursive: true, force: true });
  }
});

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
    for (const row of f.requests().filter((row) => row.method === "initialize")) {
      expect(realpathSync(row.hostCwd)).toBe(realpathSync(f.home));
      if (!row.params.capabilities) expect(row.params.cwd).toBe(f.workspace);
    }
  } finally {
    await ask.close();
    await f.sdk.closeSupport();
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("account sign-in and models work without a workspace directory", async () => {
  const f = fixture();
  rmSync(f.workspace, { recursive: true });
  try {
    expect((await f.sdk.support("siwc/status")).authenticated).toBe(true);
    await f.sdk.support("siwc/beginSignIn");
    expect(await f.sdk.support("siwc/models")).toEqual([
      {
        id: "synthetic",
        name: "Synthetic",
        reasoning: {
          defaultEffort: "low",
          efforts: [
            { id: "low", name: "Low" },
            { id: "high", name: "High" },
          ],
        },
      },
    ]);
    await f.sdk.support("siwc/cancelSignIn");
    await f.sdk.support("siwc/signOut");
    const initialization = f.requests().find((row) => row.method === "initialize");
    expect(initialization.params).not.toHaveProperty("cwd");
  } finally {
    await f.sdk.closeSupport();
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("advertised reasoning effort persists and reaches the next SDK initialization", async () => {
  const f = fixture();
  f.select();
  try {
    await f.sdk.configure({
      choice: "builtin",
      provider: "chatgpt-siwc",
      model: "synthetic",
      reasoningEffort: "high",
    });
    const runtime = await f.sdk.runtime();
    expect(
      f
        .requests()
        .filter((row) => row.method === "initialize" && !row.params.capabilities)
        .at(-1).params.reasoningEffort,
    ).toBe("high");
    await runtime.close();
    await expect(
      f.sdk.configure({
        choice: "builtin",
        provider: "chatgpt-siwc",
        model: "synthetic",
        reasoningEffort: "unsupported",
      }),
    ).rejects.toMatchObject({ code: "AI_MODEL" });
    expect(JSON.parse(readFileSync(join(f.home, "kaitu-ai.json"), "utf8")).reasoningEffort).toBe("high");
    writeFileSync(f.noDefault, "no default");
    await expect(
      f.sdk.configure({
        choice: "builtin",
        provider: "chatgpt-siwc",
        model: "synthetic",
        reasoningEffort: null,
      }),
    ).rejects.toMatchObject({ code: "AI_MODEL" });
    expect(JSON.parse(readFileSync(join(f.home, "kaitu-ai.json"), "utf8")).reasoningEffort).toBe("high");
    rmSync(f.noDefault);
    await f.sdk.configure({
      choice: "builtin",
      provider: "chatgpt-siwc",
      model: "synthetic",
      reasoningEffort: null,
    });
    expect(JSON.parse(readFileSync(join(f.home, "kaitu-ai.json"), "utf8")).reasoningEffort).toBe("low");
    const afterReset = await f.sdk.runtime();
    expect(
      f
        .requests()
        .filter((row) => row.method === "initialize" && !row.params.capabilities)
        .at(-1).params.reasoningEffort,
    ).toBe("low");
    await afterReset.close();
  } finally {
    await f.sdk.closeSupport();
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("a settings read during a delayed provider switch cannot retain the old connection", async () => {
  const f = fixture();
  f.select("deepseek-official");
  writeFileSync(f.holdModels, "hold");
  try {
    const saving = f.sdk.configure({ choice: "builtin", provider: "chatgpt-siwc", model: "synthetic" });
    const until = Date.now() + 5000;
    while (
      (!existsSync(join(f.root, "calls.jsonl")) ||
        !f.requests().some((row) => row.method === "kaitu/siwc/models")) &&
      Date.now() < until
    )
      await new Promise((resolve) => setTimeout(resolve, 10));
    expect(f.requests().some((row) => row.method === "kaitu/siwc/models")).toBe(true);
    expect((await f.sdk.settings()).provider).toBe("deepseek-official");
    rmSync(f.holdModels);
    expect((await saving).provider).toBe("chatgpt-siwc");
    expect((await f.sdk.settings()).provider).toBe("chatgpt-siwc");
  } finally {
    rmSync(f.holdModels, { force: true });
    await f.sdk.closeSupport();
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("a model capability failure preserves the other saved providers", async () => {
  const f = fixture();
  f.select();
  try {
    await f.sdk.settings();
    writeFileSync(f.failModels, "fail");
    const catalog = await f.sdk.catalogSettings(true);
    expect(catalog.modelCapabilityError).toBe(true);
    expect(
      catalog.saved.some((row) => row.provider === "deepseek-official" && row.models.includes("synthetic")),
    ).toBe(true);
  } finally {
    await f.sdk.closeSupport();
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("unavailable ChatGPT status does not hide other saved models", async () => {
  const f = fixture();
  f.select();
  writeFileSync(f.unavailable, "fail");
  try {
    const catalog = await f.sdk.catalogSettings(true);
    expect(catalog.modelCapabilityError).toBe(true);
    expect(
      catalog.saved.some((row) => row.provider === "deepseek-official" && row.models.includes("synthetic")),
    ).toBe(true);
  } finally {
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
