import { execFileSync } from "node:child_process";
import fs, {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import {
  Workspace,
  archiveInboxNote,
  historyDirectory,
  inboxNotes,
  initWorkspace,
  openFeishuInbox,
  parseFrontmatter,
  snapshot,
} from "../../core/src/index.js";
import { importFeishuFolder } from "../src/feishu.js";

const roots: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  syncBuiltinESMExports();
  for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true });
});
const doc = (token = "docA", name = "同名") => ({
  token,
  name,
  type: "docx",
  url: `https://example.feishu.cn/docx/${token}`,
});
interface Scenario {
  pages?: unknown[];
  revisions?: Record<string, number>;
  contents?: Record<string, string>;
  version?: string;
  bad?: string;
  fail?: { type: string; code?: number };
  hang?: string;
}
function fixture(initial: Scenario = {}) {
  const home = mkdtempSync(join(tmpdir(), "kaitu-feishu-test-"));
  roots.push(home);
  const root = join(home, "workspace");
  mkdirSync(join(root, ".kaitu"), { recursive: true });
  writeFileSync(join(root, ".kaitu/config.json"), "{}\n");
  mkdirSync(join(root, "me"));
  writeFileSync(join(root, "me/rules.md"), "---\ntimezone: UTC\n---\n");
  const config = join(home, "scenario.json");
  const log = join(home, "calls.jsonl");
  const cli = join(home, "fakeCLI");
  // 真实子进程，严格接受协议允许的 argv。未知命令直接失败，不模拟 shell。
  writeFileSync(
    cli,
    `#!${process.execPath}
const fs = require('node:fs');
const config = ${JSON.stringify(config)};
const log = ${JSON.stringify(log)};
const scenario = JSON.parse(fs.readFileSync(config, 'utf8'));
const a = process.argv.slice(2);
fs.appendFileSync(log, JSON.stringify({ argv:a, cwd:process.cwd(), at:Date.now() })+'\\n');
fs.writeFileSync('sidecar.md', 'synthetic resource');
function out(data) { console.log(JSON.stringify({ok:true,identity:'user',data})); }
function invalid() { console.error('not an allowed read argv'); process.exit(91); }
let stage;
if (a.length === 1 && a[0] === '--version') {
 console.log('lark-cli version '+(scenario.version || '1.0.98')); process.exit(0);
} else if (a.length === 9 && a.slice(0,4).join(' ') === 'drive files list --params' &&
 a.slice(5).join(' ') === '--as user --format json') {
 const p = JSON.parse(a[4]);
 if (p.folder_token !== 'folderA' || p.page_size !== 200 ||
 Object.keys(p).some(k=>!['folder_token','page_size','page_token'].includes(k))) invalid();
 stage = 'list';
 const index = p.page_token === undefined ? 0 : Number(p.page_token);
 const data = (scenario.pages || [{files:[${JSON.stringify(doc())}],has_more:false}])[index];
 if (scenario.hang === stage) setInterval(()=>{},1000);
 else if (scenario.bad === 'list-json') console.log('{}{}');
 else out(data);
} else if (a.length === 7 && a[0] === 'api' && a[1] === 'GET' &&
 /^\\/open-apis\\/docx\\/v1\\/documents\\/[A-Za-z0-9_-]+$/.test(a[2]) &&
 a.slice(3).join(' ') === '--as user --format json') {
 stage = 'raw';
 const id = a[2].split('/').pop();
 const document = {document_id:id,revision_id:(scenario.revisions || {})[id] ?? 1};
 if (scenario.bad === 'raw-id') document.document_id = 'wrong';
 if (scenario.bad === 'raw-revision') delete document.revision_id;
 out({document});
} else if (a.length === 12 && a.slice(0,3).join(' ') === 'docs +fetch --doc' &&
 /^[A-Za-z0-9_-]+$/.test(a[3]) &&
 a.slice(4,11).join(' ') === '--doc-format markdown --as user --format json --revision-id' && /^\\d+$/.test(a[11])) {
 stage = 'fetch';
 if (scenario.hang === stage) setInterval(()=>{},1000);
 else if (scenario.fail) {
  console.error(JSON.stringify({ok:false,error:{...scenario.fail,hint:'auth login synthetic-secret'}}));
  process.exit(4);
 } else {
  const document = {document_id:a[3],revision_id:Number(a[11]),content:(scenario.contents || {})[a[3]] ?? '# 合成原文\\n'};
  if (scenario.bad === 'fetch-id') document.document_id='wrong';
  if (scenario.bad === 'fetch-revision') document.revision_id++;
  if (scenario.bad === 'fetch-content') delete document.content;
  if (scenario.bad === 'fetch-ok') console.log(JSON.stringify({ok:false,data:{document}}));
  else out({document});
 }
} else invalid();
`,
  );
  chmodSync(cli, 0o700);
  const set = (scenario: Scenario) => writeFileSync(config, JSON.stringify(scenario));
  set(initial);
  const calls = () =>
    existsSync(log)
      ? readFileSync(log, "utf8")
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line))
      : [];
  const run = (extra: { signal?: AbortSignal; timeoutMs?: number } = {}) =>
    importFeishuFolder({ root, folder: "folderA", cli, ...extra });
  return { home, root, cli, set, run, calls, ws: new Workspace(root, { maintain: false }) };
}
function notes(f: ReturnType<typeof fixture>) {
  return inboxNotes(f.ws);
}
function checkCleanCwds(f: ReturnType<typeof fixture>) {
  for (const call of f.calls()) {
    expect(call.cwd).not.toBe(f.root);
    expect(existsSync(call.cwd)).toBe(false);
  }
  expect(existsSync(join(f.root, "sidecar.md"))).toBe(false);
  expect(existsSync(join(f.root, ".kaitu/feishu/import.lock"))).toBe(false);
}

test("分页只取直接 docx，保留空文档和完整长 Markdown，隔离 sidecar 并限制调用速率", async () => {
  const long = `  # 原文\n${"全文🔖\n".repeat(30000)}\n  `;
  const f = fixture({
    pages: [
      {
        files: [doc(), { type: "folder", token: "child" }, { type: "file" }],
        has_more: true,
        next_page_token: "1",
      },
      { files: [doc("docB"), { type: "sheet" }, { type: "bitable" }], has_more: false },
    ],
    contents: { docA: long, docB: "" },
  });
  const result = await f.run();
  expect([result.listed, result.documents, result.imported, result.requests, result.versionChecks]).toEqual([
    6, 2, 2, 6, 1,
  ]);
  const captured = notes(f).map((note) => parseFrontmatter(note.content));
  expect(captured.find((note) => note.data.feishu_document_id === "docA")?.body).toBe(long);
  expect(captured.find((note) => note.data.feishu_document_id === "docB")?.body).toBe("");
  expect(captured.map((note) => [note.data.source, note.data.feishu_revision_id]).sort()).toEqual([
    [doc().url, 1],
    [doc("docB").url, 1],
  ]);
  const calls = f.calls();
  for (let i = 1; i < calls.length; i++) expect(calls[i].at - calls[i - 1].at).toBeGreaterThanOrEqual(195);
  checkCleanCwds(f);
});

test("同名异 ID 独立，改名和同 revision 不新增，归档/本地改写保留，新 revision 只追加，远端消失不删除", async () => {
  const f = fixture({ pages: [{ files: [doc(), doc("docB")], has_more: false }] });
  expect((await f.run()).imported).toBe(2);
  const original = notes(f);
  const archived = archiveInboxNote(f.ws, original[0]?.path ?? "missing");
  f.ws.writeText(archived, `${f.ws.readText(archived)}\n本地手改`);
  const edited = f.ws.readText(archived);
  f.set({ pages: [{ files: [doc("docA", "已改名"), doc("docB")], has_more: false }] });
  const repeat = await f.run();
  expect([repeat.imported, repeat.unchanged, repeat.requests]).toEqual([0, 2, 3]);
  f.set({
    pages: [{ files: [doc("docA", "已改名"), doc("docB")], has_more: false }],
    revisions: { docA: 2 },
    contents: { docA: "新版本正文" },
  });
  expect((await f.run()).imported).toBe(1);
  expect(f.ws.readText(archived)).toBe(edited);
  expect(
    notes(f)
      .map((note) => parseFrontmatter(note.content))
      .find((note) => note.data.feishu_revision_id === 2)?.body,
  ).toBe("新版本正文");
  f.set({ pages: [{ files: [], has_more: false }] });
  expect((await f.run()).imported).toBe(0);
  expect(notes(f)).toHaveLength(2);
  expect(f.ws.readText(archived)).toBe(edited);
  checkCleanCwds(f);
});

async function rejectScenarios(cases: Scenario[]) {
  for (const scenario of cases) {
    const f = fixture(scenario);
    await expect(f.run()).rejects.toThrow();
    expect(notes(f)).toHaveLength(0);
    expect(existsSync(join(f.root, ".kaitu/feishu/imports.json"))).toBe(false);
    checkCleanCwds(f);
  }
}

test("版本与分页协议错误停止，非单 JSON 和不可继续的分页不作为完整清单", async () => {
  await rejectScenarios([
    { version: "1.0.99" },
    { bad: "list-json" },
    { pages: [{ files: [] }] },
    { pages: [{ files: [], has_more: true }] },
    {
      pages: [
        { files: [], has_more: true, next_page_token: "1" },
        { files: [], has_more: true, next_page_token: "1" },
      ],
    },
  ]);
});

test("正文 ID/revision/内容或成功状态错误不保存，失败后允许手动重试", async () => {
  await rejectScenarios([
    { bad: "raw-id" },
    { bad: "raw-revision" },
    { bad: "fetch-id" },
    { bad: "fetch-revision" },
    { bad: "fetch-content" },
    { bad: "fetch-ok" },
  ]);
  const retry = fixture({ bad: "fetch-content" });
  await expect(retry.run()).rejects.toThrow();
  retry.set({});
  expect((await retry.run()).imported).toBe(1);
});

test("认证、权限、429 和额度直接停止，不执行 hint，不继续下一篇或写成功映射", async () => {
  for (const fail of [
    { type: "authentication" },
    { type: "authorization" },
    { type: "api", code: 429 },
    { type: "api", code: 99991403 },
  ]) {
    const f = fixture({ fail, pages: [{ files: [doc(), doc("docB")], has_more: false }] });
    const error = await f.run().catch((error) => error);
    expect(error.report.requests).toBe(3);
    expect(error.message).not.toContain("synthetic-secret");
    expect(f.calls()).toHaveLength(4);
    expect(notes(f)).toHaveLength(0);
    expect(existsSync(join(f.root, ".kaitu/feishu/imports.json"))).toBe(false);
    checkCleanCwds(f);
  }
});

test("原文已写但映射故障显式失败，归档后重试补映射，不改本地正文或重建原文", async () => {
  const f = fixture();
  const write = Workspace.prototype.writeJson;
  const failure = vi.spyOn(Workspace.prototype, "writeJson").mockImplementation(function (
    this: Workspace,
    path,
    value,
    options,
  ) {
    if (path === ".kaitu/feishu/imports.json") throw new Error("synthetic disk failure");
    return write.call(this, path, value, options);
  });
  await expect(f.run()).rejects.toThrow("synthetic disk failure");
  failure.mockRestore();
  expect(notes(f)).toHaveLength(1);
  const path = archiveInboxNote(f.ws, notes(f)[0]?.path ?? "missing");
  f.ws.writeText(path, `${f.ws.readText(path)}\nedited after failed mapping`);
  const body = f.ws.readText(path);
  expect((await f.run()).imported).toBe(0);
  expect(notes(f)).toHaveLength(0);
  expect(f.ws.readText(path)).toBe(body);
  expect((await f.run()).requests).toBe(2);
  checkCleanCwds(f);
});

test("已有文件不可覆盖，符号链接和越界 token 在入口拒绝，不记录失败写入", async () => {
  const f = fixture();
  const link = fs.linkSync;
  let collided = "";
  const race = vi.spyOn(fs, "linkSync").mockImplementation((source, target) => {
    collided = String(target);
    writeFileSync(target, "racing local writer");
    return link(source, target);
  });
  syncBuiltinESMExports();
  await expect(f.run()).rejects.toThrow();
  race.mockRestore();
  syncBuiltinESMExports();
  expect(readFileSync(collided, "utf8")).toBe("racing local writer");
  expect(existsSync(join(f.root, ".kaitu/feishu/imports.json"))).toBe(false);
  rmSync(collided);
  await f.run();
  const path = notes(f)[0]?.path ?? "missing";
  rmSync(join(f.root, ".kaitu/feishu/imports.json"));
  f.ws.writeText(path, "已存在的私人内容");
  await expect(f.run()).rejects.toThrow();
  expect(f.ws.readText(path)).toBe("已存在的私人内容");
  expect(existsSync(join(f.root, ".kaitu/feishu/imports.json"))).toBe(false);
  rmSync(f.ws.resolve(path));
  // 同名符号链接不会被当作原文，不得通过 wx 写入覆盖其目标。
  const outside = join(f.home, "outside.md");
  writeFileSync(outside, "outside sentinel");
  symlinkSync(outside, f.ws.resolve(path));
  await expect(f.run()).rejects.toThrow();
  expect(readFileSync(outside, "utf8")).toBe("outside sentinel");
  const escaped = fixture();
  mkdirSync(join(escaped.root, "inbox"));
  symlinkSync(f.home, join(escaped.root, "inbox/notes"));
  await expect(escaped.run()).rejects.toThrow();
  expect(escaped.calls()).toHaveLength(0);
  await expect(
    importFeishuFolder({ root: escaped.root, cli: escaped.cli, folder: "../escape" }),
  ).rejects.toThrow();
  expect(escaped.calls()).toHaveLength(0);
  const bad = fixture({ pages: [{ files: [doc("../escape")], has_more: false }] });
  await expect(bad.run()).rejects.toThrow();
  expect(notes(bad)).toHaveLength(0);
  checkCleanCwds(f);
});

test("超时与取消终止子进程和后续写入，清理自己的 cwd，预先取消不启动 CLI", async () => {
  const timed = fixture({ hang: "fetch" });
  await expect(timed.run({ timeoutMs: 500 })).rejects.toThrow();
  expect(notes(timed)).toHaveLength(0);
  checkCleanCwds(timed);
  const f = fixture({ hang: "fetch" });
  const abort = new AbortController();
  const pending = f.run({ signal: abort.signal });
  await vi.waitFor(() => expect(f.calls().some((call) => call.argv[0] === "docs")).toBe(true), {
    timeout: 5000,
  });
  abort.abort();
  await expect(pending).rejects.toThrow();
  expect(notes(f)).toHaveLength(0);
  checkCleanCwds(f);
  const cancelled = fixture();
  await expect(cancelled.run({ signal: AbortSignal.abort() })).rejects.toThrow();
  expect(cancelled.calls()).toHaveLength(0);
  // 取消后的下一次手动运行可以正常重试。
  f.set({});
  expect((await f.run()).imported).toBe(1);
});

test("飞书原文进入真实历史树，本机去重映射和运行锁不进入历史", async () => {
  const f = fixture();
  const ws = await initWorkspace(join(f.home, "history-workspace"), { timeZone: "UTC" });
  await importFeishuFolder({ root: ws.root, folder: "folderA", cli: f.cli });
  const saved = inboxNotes(ws)[0]?.path ?? "missing";
  const pending = openFeishuInbox(ws);
  await snapshot(ws, "合成飞书原文");
  pending.close();
  const files = execFileSync(
    "git",
    ["--git-dir", historyDirectory(ws), "ls-tree", "-r", "--name-only", "HEAD"],
    { encoding: "utf8", shell: false },
  )
    .trim()
    .split("\n");
  expect(files).toContain(saved);
  expect(files.filter((path) => path.startsWith(".kaitu/feishu/"))).toEqual([]);
  expect(existsSync(ws.resolve(".kaitu/feishu/imports.json", { internal: true }))).toBe(true);
});
