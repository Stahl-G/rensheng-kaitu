// 真实异步恢复，最后一份文件进度之后单独计数尾部同步维护；不改时钟/Git。
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
const project = resolve(import.meta.dirname, "../../..");
const temporary = fs.mkdtempSync(join(tmpdir(), "kaitu-restore-tail-"));
process.env.KAITU_LOCAL_STATE_DIR = join(temporary, "state");
process.env.KAITU_APP_HOME = join(temporary, "app");
let current;
for (const name of ["readFileSync", "readdirSync", "statSync", "lstatSync", "writeFileSync"]) {
  const original = fs[name];
  fs[name] = function (file, ...args) {
    const result = original.call(this, file, ...args);
    if (current && typeof file === "string" && file.startsWith(current.root)) {
      current.calls[name] = (current.calls[name] ?? 0) + 1;
      if (name === "readFileSync") current.readBytes += Buffer.byteLength(result);
    }
    return result;
  };
}
syncBuiltinESMExports();
const core = await import(pathToFileURL(join(project, "packages/core/dist/index.js")));
try {
  const rows = [];
  for (const [notes, records] of [
    [200, 1000],
    [2400, 12000],
  ]) {
    const files = {
      "kaitu-backup.json": JSON.stringify({
        format: "kaitu-workspace",
        version: 1,
        text: true,
        records: true,
      }),
    };
    for (let i = 0; i < notes; i++)
      files[`inbox/notes/2026-10-19/${String(i).padStart(4, "0")}.md`] =
        `---\nkind: capture\ndate: 2026-10-19\n---\nSynthetic note ${i}\n${"synthetic body ".repeat(200)}`;
    files["health/data/workouts/2026-10.jsonl"] = `${Array.from({ length: records }, (_, i) =>
      JSON.stringify({
        id: core.ulid(),
        ts: "2026-10-19T00:00:00Z",
        by: "user",
        exercise: `Synthetic ${i}`,
        sets: 3,
        reps: 10,
        weight_kg: 20,
        session_id: `s${i}`,
      }),
    ).join("\n")}\n`;
    const root = join(temporary, `restored-${notes}`);
    const remote = {
      inspect: async () => ({ private: true, branch: "main" }),
      read: async () => ({ head: "synthetic-snapshot", files }),
      push: async () => {
        throw new Error("not used");
      },
    };
    let tailStarted;
    let lastTick = performance.now();
    let tailMaxGapMs = 0;
    const timer = setInterval(() => {
      const now = performance.now();
      if (tailStarted !== undefined) tailMaxGapMs = Math.max(tailMaxGapMs, now - lastTick);
      lastTick = now;
    }, 5);
    const started = performance.now();
    try {
      await core.restoreWorkspaceBackup(root, undefined, { via: "gh", repo: "synthetic/backup" }, remote, {
        progress: (p) => {
          if (p.phase === "restore" && p.total !== undefined && p.completed === p.total) {
            tailStarted = performance.now();
            lastTick = tailStarted;
            current = { root, calls: {}, readBytes: 0 };
          }
        },
      });
      const completed = performance.now();
      tailMaxGapMs = Math.max(tailMaxGapMs, completed - lastTick);
      rows.push({
        syntheticNotes: notes,
        syntheticRecords: records,
        restoredFiles: Object.keys(files).length - 1,
        totalMs: +(completed - started).toFixed(2),
        tailWallMs: +(completed - tailStarted).toFixed(2),
        maxObservedTailMainThreadGapMs: +tailMaxGapMs.toFixed(2),
        tailWorkspaceSyncCalls: current.calls,
        tailWorkspaceSyncReadBytes: current.readBytes,
      });
    } finally {
      clearInterval(timer);
      current = undefined;
    }
  }
  console.log(
    JSON.stringify(
      {
        node: process.version,
        platform: `${process.platform}/${process.arch}`,
        scope:
          "Tail begins after final restored file progress; includes writeAgentsMd, backup state save, one setImmediate yield and final refreshOverview. Counters are application fs sync calls, not physical disk or SQLite IO. No timing pass/fail threshold.",
        rows,
      },
      null,
      2,
    ),
  );
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
