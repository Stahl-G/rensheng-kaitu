import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initWorkspace, readOnboardingMatter, saveOnboardingMatter } from "@kaitu/core";
import { afterEach, expect, test, vi } from "vitest";
import { agentEnvironment, cliCommand, localAgent } from "../src/local-agents/agents.js";
import { createAgentConnection } from "../src/local-agents/connection.js";
import { agentSessionOptions, createAgentRuntime } from "../src/local-agents/runtime.js";
import { createAskService } from "../src/ui/ask.js";
import { organizeOnboardingMatter } from "../src/ui/onboarding-ai.js";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function writeAgent(dir: string, name: string, source: string): string {
  const windows = process.platform === "win32";
  const script = join(dir, windows ? `${name}.mjs` : name);
  writeFileSync(script, source, { mode: 0o755 });
  chmodSync(script, 0o755);
  if (!windows) return script;
  // Exercise the same npm-shim resolution as installed Windows ACP CLIs.
  writeFileSync(join(dir, name), `exec node "$basedir/${name}.mjs" "$@"`);
  const path = join(dir, `${name}.cmd`);
  writeFileSync(path, `@node "%~dp0${name}.mjs" %*\r\n`);
  return path;
}
function copyAgent(path: string, dir: string, name: string): string {
  const script = process.platform === "win32" ? path.replace(/\.cmd$/, ".mjs") : path;
  return writeAgent(dir, name, readFileSync(script, "utf8"));
}
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "kaitu-codebuddy-"));
  dirs.push(dir);
  const workspace = join(dir, "workspace");
  mkdirSync(workspace);
  const path = writeAgent(
    dir,
    "codebuddy",
    `#!/usr/bin/env node
import {createInterface} from 'node:readline';
import {appendFileSync,existsSync,unlinkSync} from 'node:fs';
import {basename} from 'node:path';
const send = x => process.stdout.write(JSON.stringify(x)+'\\n');
const tag = basename(process.argv[1] || 'synthetic').replace(/\\.mjs$/, '');
const modeOptions = [{value:'default',name:'Ask'},{value:'auto',name:'Auto',description:existsSync('unsafe-auto')?'Skips all permission checks':'AI classifier reviews actions; risky actions are denied'},{value:'bypassPermissions',name:'Bypass'}];
const modes = value => existsSync('no-modes') ? {} : existsSync('legacy-modes') ? {modes:{currentModeId:value,availableModes:modeOptions.map(x=>({...x,id:x.value}))}} : {configOptions:[{id:'mode',category:'mode',currentValue:value,options:modeOptions}]};
let permitted;
createInterface({input:process.stdin}).on('line',line=>{
 const m=JSON.parse(line), p=m.params||{};
 appendFileSync('trace.jsonl',JSON.stringify(m)+'\\n');
 if(m.id===9001 && m.result){const granted=m.result.outcome?.optionId==='allow_once';send({method:'session/update',params:{sessionId:'upstream-'+tag,update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:granted?'approved once':'denied once'}}}});send({id:permitted,result:{stopReason:'end_turn'}});return;}
 if(m.method==='initialize')send({id:m.id,result:{agentCapabilities:{loadSession:true}}});
 else if(m.method==='session/new'||m.method==='session/load'){
   if(m.method==='session/new'&&existsSync('fail-new-once')){unlinkSync('fail-new-once');send({id:m.id,error:{message:'boom'}});return;}
   const mode=modes('default');send({id:m.id,result:{sessionId:p.sessionId||('upstream-'+tag),...mode,configOptions:[{id:'model',category:'model',currentValue:'m1',options:[{value:'m1',name:'M1'},{value:'m2',name:'M2'}]},...(mode.configOptions||[])]}});
 }
 else if((m.method==='session/set_config_option'&&p.configId==='mode')||m.method==='session/set_mode'){
   if(existsSync('mode-fail'))send({id:m.id,error:{message:'mode unavailable'}});
   else send({id:m.id,result:m.method==='session/set_mode'?{}:modes(existsSync('mode-ignore')?'default':p.value)});
 }
 else if(m.method==='session/set_config_option')send({id:m.id,result:{configOptions:[{id:'model',category:'model',currentValue:p.value}]}});
 else if(m.method==='session/prompt') {
   const text=p.prompt[0].text;
   if(text.endsWith('hang'))return;
   if(text.endsWith('permit')||text.includes('native-permission-probe')){permitted=m.id;send({id:9001,method:'session/request_permission',params:{options:[{kind:'allow',optionId:'allow_once',name:'Allow once'},{kind:'allow_always',optionId:'always',name:'Always'}]}});return;}
   if(text.endsWith('fail')){send({id:m.id,error:{message:'private upstream detail'}});return;}
   if(text.endsWith('missing-note')){send({method:'session/update',params:{sessionId:p.sessionId,update:{sessionUpdate:'tool_call',toolCallId:'read-note',title:'read_file',rawInput:{path:'learning/new/notes.md'}}}});send({method:'session/update',params:{sessionId:p.sessionId,update:{sessionUpdate:'tool_call_update',toolCallId:'read-note',status:'failed',content:[{type:'content',content:{type:'text',text:'notes.md does not exist yet'}}]}}});send({id:m.id,result:{stopReason:'end_turn'}});return;}
   if(text.endsWith('tool')){send({method:'session/update',params:{sessionId:p.sessionId,update:{sessionUpdate:'tool_call',toolCallId:'t1',title:'task_add'}}});send({id:m.id,result:{stopReason:'end_turn'}});return;}
   for(const text of ['synthetic ','reply'])send({method:'session/update',params:{sessionId:p.sessionId,update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text}}}});
   send({id:m.id,result:{stopReason:'end_turn'}});
 }
});
`,
  );
  return {
    state: join(dir, "state"),
    workspace,
    path,
    mcp: { command: process.execPath, args: [] },
  };
}
function setup(f: ReturnType<typeof fixture>, permissionMode?: string) {
  let backend = "codebuddy:test";
  const options = {
    ...f,
    runtime: () => createAgentRuntime({ ...f, agent: localAgent("codebuddy"), permissionMode }),
    settings: async () => ({
      configured: true,
      provider: "codebuddy",
      model: "default",
      backend,
      fullOnly: true,
      supportsAttachments: false,
    }),
    configure: async () => ({}),
    models: async () => [],
  };
  return {
    ask: createAskService(options),
    options,
    switchBackend: () => {
      backend = "dsh";
    },
  };
}
test("real stdio adapter streams, persists once, resumes after restart and keeps backend identity", async () => {
  const f = fixture();
  const { ask, options, switchBackend } = setup(f);
  let service = ask;
  try {
    const row = await ask.create();
    expect(row.mode).toBe("full");
    const chunks: string[] = [];
    ask.subscribe(row.id, (event) => {
      if (event.type === "assistant/delta") chunks.push(String(event.data.text));
    });
    await ask.send(row.id, "test");
    expect(chunks).toEqual(["synthetic ", "synthetic reply"]);
    expect(ask.events(row.id).filter((event) => event.type === "assistant/message")).toHaveLength(1);
    expect(ask.events(row.id).some((event) => event.type === "assistant/delta")).toBe(false);
    await expect(
      ask.send(row.id, "file", [{ kind: "file", data: "eA==", mimeType: "text/plain", name: "x" }]),
    ).rejects.toThrow(/文字/);
    await ask.close();
    service = createAskService(options);
    await service.send(row.id, "again");
    const trace = readFileSync(join(f.workspace, "trace.jsonl"), "utf8");
    expect(trace).toContain('"method":"session/load"');
    expect(trace).toContain('"sessionId":"upstream-codebuddy"');
    // 隐私提醒只在新会话的第一条消息前带一次。
    const prompts = trace
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line))
      .filter((frame) => frame.method === "session/prompt")
      .map((frame) => frame.params.prompt[0].text as string);
    expect(prompts.map((text) => text.includes("开图的完整 Agent 模式"))).toEqual([true, false]);
    expect(service.events(row.id).filter((event) => event.type === "assistant/message")).toHaveLength(2);
    // 换了 AI 仍在原对话里继续：新 AI 收到之前的记录，对话里只显示原话。
    switchBackend();
    await service.send(row.id, "switched");
    const last = readFileSync(join(f.workspace, "trace.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line))
      .filter((frame) => frame.method === "session/prompt")
      .at(-1);
    expect(last.params.prompt[0].text).toContain("用户：again");
    expect(last.params.prompt[0].text).toContain("AI：synthetic reply");
    expect(
      service
        .events(row.id)
        .filter((event) => event.type === "user/message")
        .at(-1)?.data.content,
    ).toEqual([{ type: "text", text: "switched" }]);
  } finally {
    await service.close();
  }
});
test("cancel terminates the owned prompt and failures are actionable without upstream private details", async () => {
  const f = fixture();
  const ws = await initWorkspace(f.workspace);
  const { ask } = setup(f);
  try {
    const row = await ask.create();
    expect(row.mode).toBe("full");
    const entered = new Promise<void>((resolve) =>
      ask.subscribe(row.id, (event) => {
        if (event.type === "user/message") resolve();
      }),
    );
    const sending = ask.send(row.id, "hang");
    await entered;
    await ask.cancel(row.id);
    await sending;
    expect(ask.events(row.id).at(-1)?.data.status).toBe("idle");
    await expect(ask.send(row.id, "fail")).rejects.toThrow(/CodeBuddy/);
    expect(JSON.stringify(ask.events(row.id))).not.toContain("private upstream detail");
    await ask.send(row.id, "recover");
    // A real ACP tool error must retain its text in Ask's tool details.
    await ask.send(row.id, "missing-note");
    expect(ask.events(row.id).find((e) => e.type === "tool/result")?.data.message).toEqual({
      toolCallId: "read-note",
      isError: true,
      content: [{ type: "text", text: "notes.md does not exist yet" }],
    });
    // 只调了工具、没回文字也算完成。
    await ask.send(row.id, "tool");
    const approval = () =>
      new Promise<{ requestId: string }>((resolve) => {
        const stop = ask.subscribe(row.id, (event) => {
          if (event.type === "approval/asked") {
            stop();
            resolve(event.data as { requestId: string });
          }
        });
      });
    const asked = approval();
    const permitting = ask.send(row.id, "permit");
    const permission = await asked;
    expect(readFileSync(join(f.workspace, "trace.jsonl"), "utf8")).not.toContain('"id":9001,"result"');
    await expect(ask.permission(row.id, permission.requestId, "always")).rejects.toThrow();
    const other = await ask.create();
    await expect(ask.permission(other.id, permission.requestId, "allow_once")).rejects.toThrow();
    await ask.permission(row.id, permission.requestId, "allow_once");
    await expect(ask.permission(row.id, permission.requestId, "allow_once")).rejects.toThrow();
    await permitting;
    expect(
      JSON.stringify(
        ask
          .events(row.id)
          .filter((e) => e.type === "assistant/message")
          .at(-1),
      ),
    ).toContain("approved once");
    const rejected = approval();
    const denying = ask.send(row.id, "permit");
    await ask.permission(row.id, (await rejected).requestId, null);
    await denying;
    expect(
      ask
        .events(row.id)
        .some((event) => event.type === "approval/resolved" && event.data.status === "rejected"),
    ).toBe(true);
    const realTimeout = globalThis.setTimeout;
    const timeout = vi
      .spyOn(globalThis, "setTimeout")
      .mockImplementation((callback, ms, ...args) => realTimeout(callback, ms === 60000 ? 10 : ms, ...args));
    try {
      await expect(ask.send(row.id, "permit")).rejects.toMatchObject({ code: "AI_APPROVAL_REQUIRED" });
    } finally {
      timeout.mockRestore();
    }
    expect(
      ask
        .events(row.id)
        .some((event) => event.type === "approval/resolved" && event.data.status === "expired"),
    ).toBe(true);
    const cancelling = approval();
    const cancelled = ask.send(row.id, "permit");
    await cancelling;
    await ask.cancel(row.id);
    await cancelled;
    expect(
      ask
        .events(row.id)
        .some((event) => event.type === "approval/resolved" && event.data.status === "cancelled"),
    ).toBe(true);
    const matter = await saveOnboardingMatter(ws, "native-permission-probe 合成原文");
    const threads = ask.list().map((thread) => thread.id);
    await expect(organizeOnboardingMatter(ws, matter.source, ask)).rejects.toMatchObject({
      code: "AI_APPROVAL_REQUIRED",
    });
    expect(ask.list().map((thread) => thread.id)).toEqual(threads);
    expect(readOnboardingMatter(ws, matter.source).text.trim()).toBe("native-permission-probe 合成原文");
  } finally {
    await ask.close();
  }
});
test("local agent: model choice, CLI identity, and switching back to the SDK provider", async () => {
  const f = fixture();
  const connection = createAgentConnection({
    state: f.state,
    workspace: () => f.workspace,
    mcp: f.mcp,
    sdk: () => ({
      settings: async () => ({ configured: true, provider: "deepseek-official", model: "test" }),
      configure: async () => ({}),
      models: async () => [],
      support: async () => ({}),
      runtime: async () => {
        throw Error("not used");
      },
    }),
  });
  await connection.configure({ choice: "local", agent: "codebuddy", path: f.path });
  const first = await connection.settings();
  expect(first.provider).toBe("codebuddy");
  expect(await connection.models({ agent: "codebuddy", path: f.path })).toEqual([
    { id: "m1", name: "M1" },
    { id: "m2", name: "M2" },
  ]);
  expect(await connection.support("localAgentModes", {})).toMatchObject({
    modes: [{ id: "default" }, { id: "auto" }],
  });
  await connection.configure({ choice: "local", agent: "codebuddy", path: f.path, permissionMode: "auto" });
  await expect(
    connection.configure({
      choice: "local",
      agent: "codebuddy",
      path: f.path,
      permissionMode: "bypassPermissions",
    }),
  ).rejects.toThrow(/未提供/);
  expect(await connection.settings()).toMatchObject({ permissionMode: "auto" });
  // 换模型仍是同一个连接，打开会话后切到所选模型。
  await connection.configure({ choice: "local", agent: "codebuddy", path: f.path, model: "m2" });
  expect(await connection.settings()).toMatchObject({ model: "m2", backend: first.backend });
  // 本机 Agent 自带读文件和命令工具，不能当成只收发文字的对话启动。
  await expect(connection.runtime("scoped", "local-ask", true)).rejects.toThrow(/不能用于只收发文字/);
  const runtime = await connection.runtime("full");
  await runtime.request("session/prompt", { sessionId: "k1", contentBlocks: [{ type: "text", text: "hi" }] });
  await runtime.close();
  expect(readFileSync(join(f.workspace, "trace.jsonl"), "utf8")).toContain('"configId":"model","value":"m2"');
  // 换成另一个 CLI 就是另一个连接：旧对话不会拿去续接。
  const other = copyAgent(f.path, f.state, "codebuddy-other");
  await connection.configure({ choice: "local", agent: "codebuddy", path: other });
  expect((await connection.settings()).backend).not.toBe(first.backend);
  await connection.configure({ choice: "builtin", provider: "deepseek-official" });
  expect((await connection.settings()).provider).toBe("deepseek-official");
  await expect(
    connection.configure({ choice: "local", agent: "codebuddy", path: join(f.state, "missing") }),
  ).rejects.toThrow(/未找到/);
});

test.each([false, true])(
  "native Auto applies before prompts and restored sessions (legacy=%s)",
  async (legacy) => {
    const f = fixture();
    const agent = localAgent("codebuddy");
    expect(
      (await agentSessionOptions(agent, f.path, f.state)).permissionModes.modes.map((x) => x.id),
    ).toEqual(["default", "auto"]);
    if (legacy) writeFileSync(join(f.workspace, "legacy-modes"), "");
    for (let i = 0; i < 2; i++) {
      const runtime = await createAgentRuntime({ ...f, agent, permissionMode: "auto" });
      try {
        await runtime.request("session/prompt", {
          sessionId: "auto",
          contentBlocks: [{ type: "text", text: "synthetic" }],
        });
      } finally {
        await runtime.close();
      }
    }
    const trace = readFileSync(join(f.workspace, "trace.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((x) => JSON.parse(x));
    expect(trace.filter((x) => x.method === "session/load")).toHaveLength(1);
    expect(
      trace.filter((x) => (legacy ? x.method === "session/set_mode" : x.params?.configId === "mode")),
    ).toHaveLength(2);
    const firstPrompt = trace.findIndex((x) => x.method === "session/prompt");
    expect(
      trace
        .slice(0, firstPrompt)
        .some((x) => (legacy ? x.method === "session/set_mode" : x.params?.configId === "mode")),
    ).toBe(true);
  },
);
test.each(["no-modes", "unsafe-auto", "mode-fail", "mode-ignore"])(
  "Auto %s blocks before sending and supports explicit ask fallback",
  async (flag) => {
    const f = fixture();
    writeFileSync(join(f.workspace, flag), "");
    const runtime = await createAgentRuntime({
      ...f,
      agent: localAgent("codebuddy"),
      permissionMode: "auto",
    });
    try {
      await expect(
        runtime.request("session/prompt", {
          sessionId: "auto",
          contentBlocks: [{ type: "text", text: "synthetic" }],
        }),
      ).rejects.toThrow(/权限模式/);
    } finally {
      await runtime.close();
    }
    expect(readFileSync(join(f.workspace, "trace.jsonl"), "utf8")).not.toContain('"method":"session/prompt"');
    rmSync(join(f.workspace, flag));
    const ask = await createAgentRuntime({ ...f, agent: localAgent("codebuddy"), permissionMode: "default" });
    try {
      await ask.request("session/prompt", {
        sessionId: "ask",
        contentBlocks: [{ type: "text", text: "synthetic" }],
      });
    } finally {
      await ask.close();
    }
  },
);
test("Auto never answers residual approvals itself and rejection is not retried", async () => {
  const f = fixture();
  const { ask } = setup(f, "auto");
  try {
    const row = await ask.create();
    ask.subscribe(row.id, (event) => {
      if (event.type === "approval/asked") void ask.permission(row.id, String(event.data.requestId), null);
    });
    await ask.send(row.id, "permit");
    expect(ask.events(row.id).find((x) => x.type === "approval/resolved")?.data.status).toBe("rejected");
    const trace = readFileSync(join(f.workspace, "trace.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((x) => JSON.parse(x));
    expect(trace.filter((x) => x.method === "session/prompt")).toHaveLength(1);
    expect(trace.find((x) => x.id === 9001 && x.result)?.result.outcome).toEqual({ outcome: "cancelled" });
  } finally {
    await ask.close();
  }
});
test("CodeBuddy keeps only its own login variables; Kaitu, Electron and other credentials are removed", () => {
  const env = agentEnvironment(localAgent("codebuddy"), {
    CODEBUDDY_API_KEY: "synthetic",
    OPENAI_API_KEY: "synthetic",
    OTHER_AUTH_TOKEN: "synthetic",
    KAITU_DIR: "x",
    ELECTRON_RUN_AS_NODE: "1",
    LANG: "zh_CN.UTF-8",
  });
  expect(env.CODEBUDDY_API_KEY).toBe("synthetic");
  for (const key of ["OPENAI_API_KEY", "OTHER_AUTH_TOKEN", "KAITU_DIR", "ELECTRON_RUN_AS_NODE"])
    expect(env[key]).toBeUndefined();
  expect(env.LANG).toBe("zh_CN.UTF-8");
});
test("Windows npm launch resolves Node entry without shell interpolation", () => {
  const f = fixture();
  const cmd = join(f.workspace, "codebuddy.cmd");
  const entry = join(f.workspace, "node_modules/@tencent-ai/codebuddy-code/bin/codebuddy");
  mkdirSync(join(f.workspace, "node_modules/@tencent-ai/codebuddy-code/bin"), { recursive: true });
  writeFileSync(entry, "");
  writeFileSync(join(f.workspace, "node.exe"), "");
  writeFileSync(
    cmd.slice(0, -4),
    'exec node "$basedir/node_modules/@tencent-ai/codebuddy-code/bin/codebuddy" "$@"',
  );
  expect(cliCommand(cmd, {}, "win32")).toEqual([join(f.workspace, "node.exe"), entry]);
});
test("switching AI keeps transcript after a failed first connect", async () => {
  const f = fixture();
  const { ask, switchBackend } = setup(f);
  try {
    const row = await ask.create();
    expect(row.mode).toBe("full");
    await ask.send(row.id, "before");
    expect(ask.list().find((item) => item.id === row.id)?.backend).toBe("codebuddy:test");
    switchBackend();
    writeFileSync(join(f.workspace, "fail-new-once"), "");
    await expect(ask.send(row.id, "switched")).rejects.toThrow(/未能连接|未发送/);
    expect(ask.list().find((item) => item.id === row.id)?.backend).toBe("codebuddy:test");
    await ask.send(row.id, "switched");
    expect(ask.list().find((item) => item.id === row.id)?.backend).toBe("dsh");
    const last = readFileSync(join(f.workspace, "trace.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line))
      .filter((frame) => frame.method === "session/prompt")
      .at(-1);
    expect(last.params.prompt[0].text).toContain("用户：before");
    expect(last.params.prompt[0].text).toContain("换了 AI");
  } finally {
    await ask.close();
  }
});
test("legacy agent sessions file is used when path-scoped file is missing", async () => {
  const f = fixture();
  mkdirSync(join(f.state, "local-agents"), { recursive: true, mode: 0o700 });
  writeFileSync(
    join(f.state, "local-agents", "codebuddy-sessions.json"),
    JSON.stringify({ t1: "upstream-legacy" }),
    { mode: 0o600 },
  );
  const runtime = await createAgentRuntime({
    ...f,
    agent: localAgent("codebuddy"),
    path: f.path,
  });
  try {
    await runtime.request("session/prompt", {
      sessionId: "t1",
      contentBlocks: [{ type: "text", text: "resume" }],
    });
  } finally {
    await runtime.close();
  }
  const loaded = readFileSync(join(f.workspace, "trace.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line))
    .find((frame) => frame.method === "session/load");
  expect(loaded?.params.sessionId).toBe("upstream-legacy");
});
test("same agent at two CLI paths keeps separate upstream sessions", async () => {
  const f = fixture();
  const other = copyAgent(f.path, f.workspace, "codebuddy-other");
  const agent = localAgent("codebuddy");
  const a = await createAgentRuntime({ ...f, agent, path: f.path });
  try {
    await a.request("session/prompt", {
      sessionId: "t1",
      contentBlocks: [{ type: "text", text: "on-a" }],
    });
  } finally {
    await a.close();
  }
  const b = await createAgentRuntime({ ...f, agent, path: other });
  try {
    await b.request("session/prompt", {
      sessionId: "t1",
      fresh: true,
      contentBlocks: [{ type: "text", text: "on-b" }],
    });
  } finally {
    await b.close();
  }
  const files = readdirSync(join(f.state, "local-agents")).filter((name) => name.endsWith("-sessions.json"));
  expect(files.length).toBe(2);
  const maps = files.map((name) => JSON.parse(readFileSync(join(f.state, "local-agents", name), "utf8")));
  expect(new Set(maps.map((map) => map.t1))).toEqual(
    new Set(["upstream-codebuddy", "upstream-codebuddy-other"]),
  );
  rmSync(join(f.workspace, "trace.jsonl"), { force: true });
  const again = await createAgentRuntime({ ...f, agent, path: f.path });
  try {
    await again.request("session/prompt", {
      sessionId: "t1",
      contentBlocks: [{ type: "text", text: "back-a" }],
    });
  } finally {
    await again.close();
  }
  const loaded = readFileSync(join(f.workspace, "trace.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line))
    .find((frame) => frame.method === "session/load");
  expect(loaded?.params.sessionId).toBe("upstream-codebuddy");
});
