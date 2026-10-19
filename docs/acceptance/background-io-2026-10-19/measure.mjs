// 合成数据、真实 Node worker/SQLite/ZIP/文件 IO；不读取账号或用户资料。
import fs from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { setImmediate as yieldToIO } from "node:timers/promises";
import { pathToFileURL } from "node:url";
const project = resolve(import.meta.dirname, "../../..");
const temporary = fs.mkdtempSync(join(tmpdir(), "kaitu-background-measure-"));
process.env.KAITU_LOCAL_STATE_DIR = join(temporary, "state");
process.env.KAITU_APP_HOME = join(temporary, "app");
const { unzipSync } = createRequire(join(project, "packages/core/package.json"))("fflate");
const core = await import(pathToFileURL(join(project, "packages/core/dist/index.js")));
const ws = await core.initWorkspace(join(temporary, "workspace"), { timeZone: "UTC" });
const write = (file, text) => {
  const target = join(ws.root, file);
  fs.mkdirSync(dirname(target), { recursive: true });
  fs.writeFileSync(target, text);
};
let bytes = 0;
for (let i = 0; i < 600; i++) {
  const text = [
    {
      type: "chat",
      id: `chat-${i}`,
      title: `Synthetic ${i}`,
      source: "synthetic",
      created: "2026-10-19T00:00:00Z",
      updated: "2026-10-19T00:00:00Z",
    },
    {
      type: "message",
      id: "m1",
      role: "user",
      ts: null,
      text: `${"synthetic content ".repeat(6000)} ${i === 599 ? "only-final-file" : ""}`,
    },
  ]
    .map((row) => JSON.stringify(row))
    .join("\n");
  bytes += Buffer.byteLength(text);
  write(`chats/2026/10/${String(i).padStart(4, "0")}.jsonl`, text);
}
async function measure(operation) {
  const started = performance.now();
  let ticks = 0;
  let last = started;
  let maxGapMs = 0;
  const tick = () => {
    const now = performance.now();
    maxGapMs = Math.max(maxGapMs, now - last);
    last = now;
    ticks++;
  };
  const timer = setInterval(tick, 10);
  try {
    const result = operation();
    const callReturnedMs = performance.now() - started;
    const value = await result;
    await yieldToIO();
    tick();
    return {
      value,
      elapsedMs: +(performance.now() - started).toFixed(2),
      callReturnedMs: +callReturnedMs.toFixed(2),
      timerTicks: ticks - 1,
      maxObservedMainThreadGapMs: +maxGapMs.toFixed(2),
    };
  } finally {
    clearInterval(timer);
  }
}
try {
  let progress;
  const syncSearch = await measure(() => core.searchChats(ws, "only-final-file"));
  fs.rmSync(ws.resolve(".kaitu/index.sqlite", { internal: true }));
  const asyncSearch = await measure(() =>
    core.searchChatsAsync(ws, "only-final-file", {
      progress: (p) => {
        progress = p;
      },
    }),
  );
  const indexProgress = progress;
  const syncExport = await measure(() => core.exportWorkspace(ws));
  const asyncExport = await measure(() =>
    core.exportWorkspaceAsync(ws, {
      progress: (p) => {
        progress = p;
      },
    }),
  );
  const exportProgress = progress;
  const originalArchive = unzipSync(Buffer.from(syncExport.value.base64, "base64"));
  const workerArchive = unzipSync(Buffer.from(asyncExport.value.base64, "base64"));
  const sameFiles =
    Object.keys(originalArchive).length === Object.keys(workerArchive).length &&
    Object.entries(originalArchive).every(([path, bytes]) =>
      Buffer.from(bytes).equals(Buffer.from(workerArchive[path] ?? [])),
    );
  const syncScan = await measure(() => core.workspaceFileStamps(ws));
  const asyncScan = await measure(() =>
    core.workspaceFileStampsAsync(ws, {
      progress: (p) => {
        progress = p;
      },
    }),
  );
  const scanProgress = progress;
  const restoreFiles = {
    "kaitu-backup.json": JSON.stringify({
      format: "kaitu-workspace",
      version: 1,
      text: true,
      records: false,
    }),
  };
  for (let i = 0; i < 600; i++)
    restoreFiles[`inbox/notes/2026-10-19/${String(i).padStart(4, "0")}.md`] = `Synthetic restore ${i}`;
  const remote = {
    inspect: async () => ({ private: true, branch: "main" }),
    read: async () => ({ head: "synthetic-snapshot", files: restoreFiles }),
    push: async () => {
      throw new Error("not used");
    },
  };
  const restore = await measure(() =>
    core.restoreWorkspaceBackup(
      join(temporary, "restored"),
      undefined,
      { via: "gh", repo: "synthetic/backup" },
      remote,
      {
        progress: (p) => {
          progress = p;
        },
      },
    ),
  );
  const restoredFiles = fs.readdirSync(join(restore.value.root, "inbox/notes/2026-10-19")).length;
  const strip = ({ value, ...measurement }) => measurement;
  const report = {
    node: process.version,
    platform: `${process.platform}/${process.arch}`,
    scope: { syntheticChats: 600, chatBytes: bytes },
    firstIndex: {
      sync: strip(syncSearch),
      worker: strip(asyncSearch),
      foundLastFile: asyncSearch.value.at(0)?.id === "chat-599",
      progress: indexProgress,
    },
    zip: {
      sync: strip(syncExport),
      worker: strip(asyncExport),
      sameFiles,
      base64Bytes: asyncExport.value.base64.length,
      progress: exportProgress,
    },
    fallbackMetadataScan: {
      sync: strip(syncScan),
      async: strip(asyncScan),
      syncFiles: syncScan.value.size,
      asyncFiles: asyncScan.value.size,
      progress: scanProgress,
    },
    restore: { ...strip(restore), restoredFiles, progress },
    limitations:
      "Single local run, real wall time; no timing pass/fail thresholds. Export still buffers full archive. Restore has one final synchronous derived overview refresh.",
  };
  console.log(JSON.stringify(report, null, 2));
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
