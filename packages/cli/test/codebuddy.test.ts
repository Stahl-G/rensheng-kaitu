import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { cliCommand } from "../src/local-agents/codebuddy.js";
import { createAgentConnection } from "../src/local-agents/connection.js";
import { createCodeBuddyRuntime } from "../src/local-agents/runtime.js";
import { createAskService } from "../src/ui/ask.js";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "kaitu-codebuddy-"));
  dirs.push(dir);
  const workspace = join(dir, "workspace");
  mkdirSync(workspace);
  const path = join(dir, "codebuddy");
  writeFileSync(
    path,
    `#!/usr/bin/env node
import {createInterface} from 'node:readline';
import {appendFileSync} from 'node:fs';
const send = x => process.stdout.write(JSON.stringify(x)+'\\n');
let permitted;
createInterface({input:process.stdin}).on('line',line=>{
 const m=JSON.parse(line), p=m.params||{};
 appendFileSync('trace.jsonl',JSON.stringify(m)+'\\n');
 if(m.id===9001 && m.result){if(m.result.outcome?.optionId!=='allow_once')process.exit(3);send({method:'session/update',params:{sessionId:'upstream-synthetic',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'approved once'}}}});send({id:permitted,result:{stopReason:'end_turn'}});return;}
 if(m.method==='initialize')send({id:m.id,result:{agentCapabilities:{loadSession:true}}});
 else if(m.method==='session/new'||m.method==='session/load')send({id:m.id,result:{sessionId:p.sessionId||'upstream-synthetic'}});
 else if(m.method==='session/prompt') {
   const text=p.prompt[0].text;
   if(text.endsWith('hang'))return;
   if(text.endsWith('permit')){permitted=m.id;send({id:9001,method:'session/request_permission',params:{options:[{kind:'allow',optionId:'allow_once',name:'Allow once'}]}});return;}
   if(text.endsWith('fail')){send({id:m.id,error:{message:'private upstream detail'}});return;}
   for(const text of ['synthetic ','reply'])send({method:'session/update',params:{sessionId:p.sessionId,update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text}}}});
   send({id:m.id,result:{stopReason:'end_turn'}});
 }
});
`,
  );
  chmodSync(path, 0o755);
  return {
    state: join(dir, "state"),
    workspace,
    path,
    mcp: { command: process.execPath, args: [] },
    mode: "full" as const,
  };
}
function setup(f: ReturnType<typeof fixture>) {
  let backend = "codebuddy:test";
  const options = {
    ...f,
    runtime: () => createCodeBuddyRuntime(f),
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
    const row = ask.create();
    await expect(ask.send(row.id, "test")).rejects.toThrow(/完整 Agent/);
    await ask.setMode(row.id, "full", true);
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
    expect(trace).toContain('"sessionId":"upstream-synthetic"');
    expect(trace).toContain("Do not scan the home directory");
    expect(service.events(row.id).filter((event) => event.type === "assistant/message")).toHaveLength(2);
    switchBackend();
    await expect(service.send(row.id, "wrong backend")).rejects.toThrow(/新建对话/);
  } finally {
    await service.close();
  }
});
test("cancel terminates the owned prompt and failures are actionable without upstream private details", async () => {
  const f = fixture();
  const { ask } = setup(f);
  try {
    const row = ask.create();
    await ask.setMode(row.id, "full", true);
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
    await ask.send(row.id, "permit");
    expect(
      JSON.stringify(
        ask
          .events(row.id)
          .filter((e) => e.type === "assistant/message")
          .at(-1),
      ),
    ).toContain("approved once");
  } finally {
    await ask.close();
  }
});
test("selecting CodeBuddy neither authenticates nor changes the existing SDK provider", async () => {
  const f = fixture();
  let configured = 0;
  const connection = createAgentConnection({
    state: f.state,
    workspace: () => f.workspace,
    mcp: f.mcp,
    sdk: () => ({
      settings: async () => ({ configured: true, provider: "deepseek-official", model: "test" }),
      configure: async () => {
        configured++;
        return {};
      },
      models: async () => [],
      support: async () => ({}),
      runtime: async () => {
        throw Error("not used");
      },
    }),
  });
  await connection.configure({ choice: "local", agent: "codebuddy", path: f.path });
  expect((await connection.settings()).provider).toBe("codebuddy");
  expect(configured).toBe(0);
  await expect(connection.runtime("scoped")).rejects.toThrow(/完整 Agent/);
  await connection.configure({ choice: "builtin", provider: "deepseek-official" });
  expect((await connection.settings()).provider).toBe("deepseek-official");
  expect(configured).toBe(1);
  await expect(
    connection.configure({ choice: "local", agent: "codebuddy", path: join(f.state, "missing") }),
  ).rejects.toThrow(/未找到/);
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
