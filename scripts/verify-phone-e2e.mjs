// Real CLI + ordinary local Git; never connects a remote or writes generated phone files.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("../", import.meta.url));
const base = process.argv[2] ? resolve(process.argv[2]) : mkdtempSync(join(tmpdir(), "kaitu-v4-"));
const root = join(base, "workspace");
assert(!existsSync(root), `Use a fresh destination: ${root}`);
mkdirSync(base, { recursive: true });
process.env.KAITU_LOCAL_STATE_DIR = join(base, "state");
const { schemas } = await import("../packages/core/dist/index.js");
const { ulid } = await import("../packages/core/dist/ulid.js");
const commands = [];
function run(label, bin, args, cwd = repo) {
  const at = performance.now();
  const r = spawnSync(bin, args, { cwd, env: process.env, encoding: "utf8" });
  const ms = performance.now() - at;
  writeFileSync(join(base, `${label}.log`), `${r.stdout ?? ""}${r.stderr ?? ""}`);
  commands.push({ label, command: [bin, ...args], cwd, ms, exit: r.status });
  writeFileSync(join(base, "commands.json"), JSON.stringify(commands, null, 2));
  assert.equal(r.status, 0, `${label}: ${r.stderr || r.error}`);
  return r.stdout.trim();
}
const cli = (label, ...args) =>
  run(label, process.execPath, [join(repo, "packages/cli/dist/main.js"), ...args, "--dir", root]);
const json = (path) => JSON.parse(readFileSync(join(root, path), "utf8"));
const taskPath = `me/data/tasks/${new Date().toISOString().slice(0, 7)}.jsonl`;
const records = () => readFileSync(join(root, taskPath), "utf8").trim().split("\n").map(JSON.parse);
function capture(stage) {
  for (const name of ["today", "week", "map", "library", "receipts"]) {
    const value = json(`phone/${name}.json`);
    const validate = schemas().builtin(`phone-${name}.schema.json`);
    assert(validate(value), `${name}: ${JSON.stringify(validate.errors)}`);
  }
  for (const item of json("phone/library.json").items) {
    assert(!item.path.startsWith("/") && !item.path.split("/").includes(".."));
    assert(existsSync(join(root, item.path)), `Missing library target ${item.path}`);
  }
  mkdirSync(join(base, stage), { recursive: true });
  cpSync(join(root, "phone"), join(base, stage, "phone"), { recursive: true });
  if (existsSync(join(root, taskPath))) cpSync(join(root, taskPath), join(base, stage, "tasks.jsonl"));
}
const deliver = (suffix, text) => {
  const name = `ios-3fa9c1d2-${ulid()}.${suffix}`;
  writeFileSync(join(root, "inbox/agents", name), text);
  return name;
};
cpSync(join(repo, "docs/guides/agent-memory/template"), root, { recursive: true });
const profile = readFileSync(join(root, "me/profile.md"), "utf8");
const ignore = readFileSync(join(root, ".gitignore"), "utf8");
run("git-init", "git", ["init", "-b", "main"], root);
run("git-add", "git", ["add", "."], root);
run(
  "git-commit",
  "git",
  [
    "-c",
    "user.name=V4 Synthetic",
    "-c",
    "user.email=v4@example.invalid",
    "commit",
    "-m",
    "Official template",
  ],
  root,
);
const head = run("git-before", "git", ["rev-parse", "HEAD"], root);
cli("init", "init", root);
assert.equal(readFileSync(join(root, "me/profile.md"), "utf8"), profile);
assert.equal(readFileSync(join(root, ".gitignore"), "utf8"), ignore);
assert.equal(run("git-after", "git", ["rev-parse", "HEAD"], root), head);
assert.equal(run("git-remotes", "git", ["remote"], root), "");
cli("initial-phone", "phone", "run", "--as", "V4-cloud");
capture("01-initial");
assert.equal(json("phone/today.json").generator.kind, "agent");
const payload = `${JSON.stringify({ type: "task", agent: "iPhone", origin: "user", ts: new Date().toISOString(), title: "V4 合成手机事项", status: "open" })}\n`;
const file = deliver("records.jsonl", payload);
const note = deliver(
  "note.md",
  `---\nagent: 你（iPhone）\nkind: capture\norigin: user\ndate: ${new Date().toISOString().slice(0, 10)}\ncreated: ${new Date().toISOString()}\n---\n\nV4 合成手机原文\n第二行供手机点开回读。\n`,
);
cli("computer-process", "phone", "run");
capture("02-received");
const task = records()[0];
assert.equal(records().length, 1);
assert.equal(task.by, "user");
assert(json("phone/today.json").mobile.tasks.some((t) => t.id === task.id && t.status === "open"));
assert(json("phone/library.json").items.some((i) => i.title === "V4 合成手机原文"));
for (const ref of [file, note])
  assert(json("phone/receipts.json").items.some((i) => i.ref === ref && i.status === "applied"));
const before = readFileSync(join(root, taskPath), "utf8");
const unchanged = JSON.parse(cli("no-new-delivery", "phone", "run"));
assert.equal(unchanged.snapshots, 0);
assert.equal(readFileSync(join(root, taskPath), "utf8"), before);
writeFileSync(join(root, "inbox/agents", file), payload);
cli("same-file-redelivery", "phone", "run");
assert.equal(readFileSync(join(root, taskPath), "utf8"), before);
assert(json("phone/receipts.json").items.some((i) => i.ref === file && i.status === "duplicate"));
capture("03-record-replayed");
const action = {
  client_id: ulid(),
  at: new Date().toISOString(),
  device: "3fa9c1d2",
  op: "complete_task",
  args: { id: task.id, expected_rev: task.rev ?? 1 },
};
assert(schemas().builtin("phone-action.schema.json")(action));
const actionText = `${JSON.stringify(action)}\n`;
deliver("actions.jsonl", actionText);
cli("complete-task", "phone", "run");
capture("04-completed");
assert(
  json("phone/today.json").mobile.tasks.some((t) => t.id === task.id && t.status === "done" && t.rev === 2),
);
assert(json("phone/receipts.json").items.some((i) => i.ref === action.client_id && i.status === "applied"));
const completed = readFileSync(join(root, taskPath), "utf8");
deliver("actions.jsonl", actionText);
cli("action-redelivery", "phone", "run");
assert.equal(readFileSync(join(root, taskPath), "utf8"), completed);
assert(json("phone/receipts.json").items.some((i) => i.ref === action.client_id && i.status === "duplicate"));
capture("05-final");
cli("validate", "validate");
cli("doctor", "doctor");
run("git-final-status", "git", ["status", "--short"], root);
writeFileSync(
  join(base, "result.json"),
  JSON.stringify(
    {
      status: "passed",
      base,
      root,
      file,
      note,
      task: task.id,
      action: action.client_id,
      taskRows: records().length,
      schemas: 5,
      phoneUI: "not tested: Linux has no iPhone",
      commands,
    },
    null,
    2,
  ),
);
console.log(JSON.stringify({ status: "passed", base, root, taskRows: records().length, commands }, null, 2));
