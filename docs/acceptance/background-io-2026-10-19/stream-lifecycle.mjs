// 真实分块压缩、随机数据、回环 HTTP 背压/中断、实际 ENOENT；不使用真实资料或凭据。
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import { get } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
const project = resolve(import.meta.dirname, "../../..");
const temporary = fs.mkdtempSync(join(tmpdir(), "kaitu-stream-lifecycle-"));
process.env.KAITU_LOCAL_STATE_DIR = join(temporary, "state");
process.env.KAITU_APP_HOME = join(temporary, "app");
const core = await import(pathToFileURL(join(project, "packages/core/dist/index.js")));
const baseline = resolve(process.argv[2] ?? join(project, "../desktop-demand-io"));
const legacy = fs.existsSync(join(baseline, "packages/core/dist/index.js"))
  ? await import(pathToFileURL(join(baseline, "packages/core/dist/index.js")))
  : undefined;
const { unzipSync, Unzip, UnzipInflate } = createRequire(join(project, "packages/core/package.json"))(
  "fflate",
);
const ws = await core.initWorkspace(join(temporary, "workspace"));
const managed = join(temporary, "state/exports");
const empty = () => !fs.existsSync(managed) || fs.readdirSync(managed).length === 0;
let downloads;
async function until(test) {
  for (let i = 0; i < 3000; i++) {
    const value = await test();
    if (value) return value;
    await delay(20);
  }
  throw new Error("Operation did not reach terminal state");
}
try {
  const folder = join(ws.root, "health/files/synthetic");
  fs.mkdirSync(folder, { recursive: true });
  for (let i = 0; i < 8; i++) fs.writeFileSync(join(folder, `${i} 中文.bin`), randomBytes(1024 * 1024));
  fs.writeFileSync(join(ws.root, ".hidden"), "excluded");
  const expected = legacy ? unzipSync(Buffer.from(legacy.exportWorkspace(ws).base64, "base64")) : undefined;
  const archive = await core.exportWorkspaceAsync(ws);
  const observed = unzipSync(fs.readFileSync(archive.path));
  const names = Object.keys(observed).sort();
  if (
    JSON.stringify(names) !== JSON.stringify(Object.keys(observed).sort()) ||
    !names.every((name) => Buffer.from(expected[name]).equals(Buffer.from(observed[name])))
  )
    throw new Error("Archive range/content changed");
  const archiveMode = fs.statSync(archive.path).mode & 0o777;
  await archive.dispose();
  const integrity = {
    completeFileCount: names.length,
    multiChunkBinaryBytes: 8 * 1024 * 1024,
    equalsLegacyNamesAndBytes: expected ? true : null,
    archiveMode,
    cleanup: empty(),
  };
  fs.rmSync(folder, { recursive: true });
  fs.mkdirSync(folder);
  const block = randomBytes(1024 * 1024);
  const large = join(folder, "large.bin");
  for (let i = 0; i < 64; i++) fs.appendFileSync(large, block);
  await core.workspaceExportRequest(ws, "start");
  const processing = await until(async () => {
    const s = await core.workspaceExportRequest(ws, "status");
    if (s.status === "failed") throw new Error(s.error);
    return s.status === "running" && s.progress?.bytes >= 8 * 1024 * 1024 ? s : undefined;
  });
  const cancelled = await core.workspaceExportRequest(ws, "cancel");
  if (!empty() || cancelled.status !== "cancelled") throw new Error("Compression cancellation leaked output");
  const compressionCancel = {
    inputBytes: 64 * 1024 * 1024,
    processedBytesAtCancel: processing.progress.bytes,
    status: cancelled.status,
    managedDirectoriesRemaining: fs.readdirSync(managed).length,
    sourcePreservedBytes: fs.statSync(large).size,
  };
  let error;
  try {
    await core.exportWorkspaceAsync(new core.Workspace(join(temporary, "missing"), { maintain: false }));
  } catch (e) {
    error = e.code;
  }
  if (error !== "ENOENT" || !empty()) throw new Error("Real read failure leaked output");
  const failedRead = { code: error, managedDirectoriesRemaining: fs.readdirSync(managed).length };
  let appended = false;
  const snapshot = await core.exportWorkspaceAsync(ws, {
    progress: (p) => {
      if (!appended && p.bytes >= 8 * 1024 * 1024) {
        fs.appendFileSync(large, block);
        appended = true;
      }
    },
  });
  const expectedHash = createHash("sha256");
  for (let i = 0; i < 64; i++) expectedHash.update(block);
  let exportedBytes = 0;
  let exportedHash;
  const decoder = new Unzip((file) => {
    const hash = createHash("sha256");
    let size = 0;
    file.ondata = (error, data, final) => {
      if (error) throw error;
      hash.update(data);
      size += data.length;
      if (final && file.name === "health/files/synthetic/large.bin") {
        exportedBytes = size;
        exportedHash = hash.digest("hex");
      }
    };
    file.start();
  });
  decoder.register(UnzipInflate);
  for await (const chunk of fs.createReadStream(snapshot.path)) decoder.push(chunk);
  decoder.push(new Uint8Array(), true);
  await snapshot.dispose();
  if (!appended || exportedBytes !== 64 * 1024 * 1024 || exportedHash !== expectedHash.digest("hex"))
    throw new Error("Append changed the opened file extent");
  const concurrentAppend = {
    sourceAfterAppendBytes: fs.statSync(large).size,
    exportedBytes,
    exportedBytesEqualOriginal: true,
    cleanup: empty(),
  };
  downloads = await core.startWorkspaceExportDownloads(ws);
  await core.workspaceExportRequest(ws, "start");
  await until(async () => (await core.workspaceExportRequest(ws, "status")).status === "ready");
  const result = await core.workspaceExportRequest(ws, "result", downloads.base);
  const paused = await new Promise((resolve, reject) => {
    const req = get(result.file.url, (res) => {
      res.once("data", (chunk) => {
        res.pause();
        resolve({ length: chunk.length, req, res });
      });
      res.on("error", () => {});
    });
    req.on("error", reject);
  });
  const duringDownload = await core.workspaceExportRequest(ws, "start");
  if (duringDownload.status !== "downloading") throw new Error("Start interrupted an active download");
  paused.res.destroy();
  paused.req.destroy();
  await until(async () => (await core.workspaceExportRequest(ws, "status")).status === "idle");
  if (!empty()) throw new Error("Download interruption leaked output");
  const reuse = await fetch(result.file.url);
  const invalid = await fetch(`${downloads.base}invalid`);
  if (reuse.status !== 404 || invalid.status !== 404) throw new Error("Download token was reusable");
  const interruptedDownload = {
    receivedBytesBeforeClientAbort: paused.length,
    repeatStartDuringTransfer: duringDownload.status,
    oneUseTokenAfterAbort: reuse.status,
    invalidToken: invalid.status,
    managedDirectoriesRemaining: fs.readdirSync(managed).length,
  };
  console.log(
    JSON.stringify(
      {
        node: process.version,
        integrity,
        compressionCancel,
        failedRead,
        concurrentAppend,
        interruptedDownload,
        status: "passed",
      },
      null,
      2,
    ),
  );
} finally {
  await core.workspaceExportRequest(ws, "cancel");
  await downloads?.close();
  fs.rmSync(temporary, { recursive: true, force: true });
}
