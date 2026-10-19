import { execFile } from "node:child_process";
// 只创建和读取本脚本的临时合成工作区；先 pnpm build。可传入已构建的 main 对照目录。
import fs from "node:fs";
import { createRequire } from "node:module";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const project = resolve(import.meta.dirname, "../../..");
const temporary = fs.mkdtempSync(join(tmpdir(), "kaitu-demand-measure-"));
process.env.KAITU_LOCAL_STATE_DIR = join(temporary, "state");
process.env.KAITU_APP_HOME = join(temporary, "app");
const current = await import(pathToFileURL(join(project, "packages/core/dist/index.js")));
const ws = await current.initWorkspace(join(temporary, "workspace"), { timeZone: "UTC" });
const write = (file, value) => {
  const target = join(ws.root, file);
  fs.mkdirSync(dirname(target), { recursive: true });
  fs.writeFileSync(target, value);
};
for (let i = 0; i < 2400; i++) {
  const recent = i < 400;
  write(
    `inbox/notes/${i % 2 ? "done/" : ""}${recent ? "2026-10-19" : "2020-01-01"}/${String(i).padStart(5, "0")}.md`,
    `---\nkind: capture\ndate: ${recent ? "2026-10-19" : "2020-01-01"}\n---\n合成原文 ${i}\n${"正文".repeat(1000)}`,
  );
}
for (let i = 0; i < 600; i++) {
  const header = {
    type: "chat",
    id: `chat-${i}`,
    title: `合成对话 ${i}`,
    source: "test",
    created: "2026-10-19T00:00:00Z",
    updated: "2026-10-19T00:00:00Z",
  };
  write(
    `chats/2026/10/chat-${i}.jsonl`,
    `${JSON.stringify(header)}\n${JSON.stringify({ type: "message", id: "m1", role: "user", ts: null, text: `needle ${"合成内容".repeat(4000)}` })}\n`,
  );
}
const rows = Array.from({ length: 12000 }, (_, i) =>
  JSON.stringify({
    id: current.ulid(),
    ts: "2026-10-19T00:00:00Z",
    by: "user",
    exercise: `训练${i}`,
    sets: 3,
    reps: 10,
    weight_kg: 20,
    session_id: `s${i}`,
  }),
);
write("health/data/workouts/2026-10.jsonl", `${rows.join("\n")}\n`);
for (let i = 0; i < 2000; i++) write(`health/files/attachments/${i}/sample.bin`, "合成附件");
write("decisions/example/STATUS.md", "---\nupdated: null\n---\n# 合成决定\n");
let counters;
const tracked = (file) => typeof file === "string" && file.startsWith(`${ws.root}/`);
for (const [name, bucket] of [
  ["readFileSync", "reads"],
  ["readdirSync", "readdir"],
  ["statSync", "stat"],
  ["lstatSync", "stat"],
]) {
  const original = fs[name];
  fs[name] = function (file, ...args) {
    const result = original.call(this, file, ...args);
    if (counters && tracked(file)) {
      counters[bucket]++;
      if (bucket === "reads") counters.bytes += Buffer.byteLength(result);
    }
    return result;
  };
}
syncBuiltinESMExports();
const reports = [];
const measure = (version, action, run) => {
  counters = { reads: 0, bytes: 0, readdir: 0, stat: 0 };
  const start = performance.now();
  const value = run();
  reports.push({ version, action, ms: +(performance.now() - start).toFixed(2), ...counters });
  counters = undefined;
  return value;
};
const versions = [];
if (process.argv[2])
  versions.push([
    "main-e2d9cd8",
    await import(pathToFileURL(join(resolve(process.argv[2]), "packages/core/dist/index.js"))),
  ]);
versions.push(["fixed", current]);
for (const [version, core] of versions) {
  const work = new core.Workspace(ws.root, { maintain: false });
  core.searchChats(work, "needle");
  measure(version, "warm-chat-search", () => core.searchChats(work, "needle"));
  measure(version, "library-navigation", () => core.readLibrary(work, { section: "summary" }));
  measure(version, "inbox-first-page", () => core.readLibrary(work, { section: "inbox" }));
  measure(version, "open-one-document", () => core.readLibraryDocument(work, "decisions/example/STATUS.md"));
  measure(version, "discover-statuses", () => core.statusFiles(work));
  measure(version, "recent-note-input", () => core.inboxNotes(work, "inbox/notes", { from: "2026-10-01" }));
  measure(version, "open-ui-workspace", () => new core.Workspace(ws.root, { deferOverview: true }));
  const started = performance.now();
  const result = await core.readOverviewPage(work);
  reports.push({ version, action: "overview-projection", ms: +(performance.now() - started).toFixed(2) });
  measure(version, "phone-library", () => core.buildPhoneLibrary(work, result, new Date().toISOString()));
}
// 正文搜索用真实 ripgrep；250 条上限沿用生产代码。
for (let i = 0; i < 11000; i++) write(`grep-scope/${String(i).padStart(5, "0")}.txt`, "needle\n");
const rg = createRequire(join(project, "packages/cli/package.json"))("@vscode/ripgrep").rgPath;
const execute = promisify(execFile);
for (const [version] of versions) {
  const location = version === "fixed" ? project : resolve(process.argv[2]);
  const { agentSearch } = await import(pathToFileURL(join(location, "packages/desktop/sdk-search.mjs")));
  let batches = 0;
  let searchedFiles = 0;
  const start = performance.now();
  try {
    const result = await agentSearch(
      ws.root,
      "grep",
      { path: "grep-scope", pattern: "needle" },
      undefined,
      rg,
      async (command, args, options) => {
        batches++;
        searchedFiles += args.length - args.indexOf("--") - 1;
        return execute(command, args, options);
      },
    );
    reports.push({
      version,
      action: "bounded-content-search",
      ms: +(performance.now() - start).toFixed(2),
      batches,
      searchedFiles,
      matches: result.matches.length,
    });
  } catch (error) {
    reports.push({
      version,
      action: "bounded-content-search",
      ms: +(performance.now() - start).toFixed(2),
      batches,
      searchedFiles,
      error: error.message,
    });
  }
}
console.log(
  JSON.stringify(
    { fixture: { chats: 600, notes: 2400, workouts: 12000, attachmentDirectories: 2000 }, reports },
    null,
    2,
  ),
);
fs.rmSync(temporary, { recursive: true, force: true });
