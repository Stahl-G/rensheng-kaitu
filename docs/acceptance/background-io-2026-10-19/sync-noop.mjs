// 完全合成文件 + 内存 remote；真实 JSON.parse/stringify 与文件 IO，不伪造 Git 或时间。
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
const project = resolve(import.meta.dirname, "../../..");
const beforeProject = resolve(process.argv[2] ?? join(project, "../desktop-demand-io"));
const temporary = fs.mkdtempSync(join(tmpdir(), "kaitu-sync-noop-"));
process.env.KAITU_LOCAL_STATE_DIR = join(temporary, "state");
process.env.KAITU_APP_HOME = join(temporary, "app");
let active;
const parse = JSON.parse;
const stringify = JSON.stringify;
JSON.parse = function (text, ...args) {
  if (active && typeof text === "string" && text.includes('"exercise":"SyntheticNoOp')) active.recordParses++;
  return parse.call(this, text, ...args);
};
JSON.stringify = function (value, ...args) {
  if (active && typeof value?.exercise === "string" && value.exercise.startsWith("SyntheticNoOp"))
    active.recordStringifies++;
  return stringify.call(this, value, ...args);
};
const read = fs.promises.readFile.bind(fs.promises);
fs.promises.readFile = async (file, ...args) => {
  const value = await read(file, ...args);
  if (active && String(file).startsWith(active.root)) {
    active.reads++;
    active.readBytes += Buffer.byteLength(value);
  }
  return value;
};
const readdir = fs.promises.readdir.bind(fs.promises);
fs.promises.readdir = async (file, ...args) => {
  const value = await readdir(file, ...args);
  if (active && String(file).startsWith(active.root)) active.directories++;
  return value;
};
const write = fs.writeFileSync;
fs.writeFileSync = function (file, data, ...args) {
  const result = write.call(this, file, data, ...args);
  if (active && String(file).startsWith(active.root)) {
    active.writes++;
    active.writeBytes += Buffer.byteLength(data);
  }
  return result;
};
syncBuiltinESMExports();
const current = await import(pathToFileURL(join(project, "packages/core/dist/index.js")));
const before = await import(pathToFileURL(join(beforeProject, "packages/core/dist/index.js")));
const result = [];
try {
  for (const count of [600, 6000]) {
    const rows = `${Array.from({ length: count }, (_, i) => JSON.stringify({ id: current.ulid(), ts: "2026-10-19T00:00:00Z", by: "user", exercise: `SyntheticNoOp${i}`, sets: 3, reps: 10, weight_kg: 20, session_id: `s${i}` })).join("\n")}\n`;
    for (const [label, core] of [
      ["before", before],
      ["after", current],
    ]) {
      const ws = await core.initWorkspace(join(temporary, `${label}-${count}`), { timeZone: "UTC" });
      fs.mkdirSync(join(ws.root, "health/data/workouts"), { recursive: true });
      fs.writeFileSync(join(ws.root, "health/data/workouts/2026-10.jsonl"), rows);
      fs.mkdirSync(join(ws.root, "inbox/notes/2026-10-19"), { recursive: true });
      for (let i = 0; i < 40; i++)
        fs.writeFileSync(
          join(ws.root, `inbox/notes/2026-10-19/${i}.md`),
          `Synthetic note ${i}\n${"body text ".repeat(1700)}`,
        );
      for (let i = 0; i < 40; i++) {
        const dir = join(ws.root, `health/files/synthetic/${i}`);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(join(dir, "sample.bin"), "x");
      }
      const scan = ws.scanText.bind(ws);
      ws.scanText = (path) => {
        if (active && path === ".kaitu/config.json") active.overviewRefreshes++;
        return scan(path);
      };
      let files = {};
      let head = null;
      let pushes = 0;
      const remote = {
        inspect: async () => ({ private: true, branch: "main" }),
        read: async () => ({ head, files: { ...files } }),
        push: async (_r, _b, expected, next) => {
          if (expected !== head) throw new Error("Remote changed");
          files = { ...next };
          head = `synthetic-snapshot-${++pushes}`;
          return head;
        },
      };
      await core.connectWorkspaceBackup(ws, { repo: "synthetic/noop", text: true, records: true }, remote);
      await core.syncWorkspaceBackup(ws, remote);
      await core.syncWorkspaceBackup(ws, remote);
      const incoming = await remote.read();
      for (let i = 0; i < 5; i++) incoming.files[`inbox/notes/2026-10-19/${i}.md`] += "\nRemote update";
      await remote.push("synthetic/noop", "main", incoming.head, incoming.files);
      active = {
        root: ws.root,
        recordParses: 0,
        recordStringifies: 0,
        overviewRefreshes: 0,
        reads: 0,
        readBytes: 0,
        directories: 0,
        writes: 0,
        writeBytes: 0,
      };
      const applyStarted = performance.now();
      await core.syncWorkspaceBackup(ws, remote);
      const applied = active;
      active = undefined;
      const { root: applyRoot, ...applyCounts } = applied;
      result.push({
        label,
        phase: "five remote text updates",
        records: count,
        ...applyCounts,
        elapsedMs: +(performance.now() - applyStarted).toFixed(2),
      });
      const previousPushes = pushes;
      active = {
        root: ws.root,
        recordParses: 0,
        recordStringifies: 0,
        overviewRefreshes: 0,
        reads: 0,
        readBytes: 0,
        directories: 0,
        writes: 0,
        writeBytes: 0,
      };
      const started = performance.now();
      await core.syncWorkspaceBackup(ws, remote);
      const elapsedMs = +(performance.now() - started).toFixed(2);
      const measured = active;
      active = undefined;
      if (
        pushes !== previousPushes ||
        fs.readFileSync(join(ws.root, "health/data/workouts/2026-10.jsonl"), "utf8") !== rows
      )
        throw new Error("No-op changed records or pushed");
      const { root, ...counts } = measured;
      result.push({
        label,
        phase: "warm no-op",
        records: count,
        recordBytes: Buffer.byteLength(rows),
        ...counts,
        elapsedMs,
        pushes: pushes - previousPushes,
        sourceUnchanged: true,
      });
    }
  }
  console.log(
    JSON.stringify(
      {
        node: process.version,
        scope:
          "Warm default core sync, complete local reads/state writes retained; async application reads counted, sync JSON state writes counted; independent synthetic workspaces. No network or wall-clock threshold.",
        result,
      },
      null,
      2,
    ),
  );
} finally {
  active = undefined;
  JSON.parse = parse;
  JSON.stringify = stringify;
  fs.rmSync(temporary, { recursive: true, force: true });
}
