import { spawnSync } from "node:child_process";
import fs from "node:fs";
// Real POSIX permission failure; default 2s save / 30s retry windows, no fake Git or clock.
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";

const [repo, output] = process.argv.slice(2);
if (process.platform === "win32") throw new Error("POSIX permission probe requires POSIX filesystem");
fs.mkdirSync(output, { recursive: true });
const base = fs.mkdtempSync(path.join(os.tmpdir(), "kaitu-v2-raw-retry-"));
for (const key of [
  "HOME",
  "KAITU_DIR",
  "KAITU_APP_HOME",
  "KAITU_LOCAL_STATE_DIR",
  "XDG_STATE_HOME",
  "LOCALAPPDATA",
]) {
  process.env[key] = path.join(base, key);
  fs.mkdirSync(process.env[key], { recursive: true });
}
const core = await import(pathToFileURL(path.join(repo, "packages/core/dist/index.js")).href);
const { startUi } = await import(pathToFileURL(path.join(repo, "packages/cli/dist/ui/server.js")).href);
const git = createRequire(path.join(repo, "packages/core/package.json"))("isomorphic-git");
const ws = await core.initWorkspace(process.env.KAITU_DIR, { timeZone: "Asia/Bangkok" });
let ui = await startUi(ws, { port: 0, open: false });
const result = {
  at: new Date().toISOString(),
  base,
  repo,
  node: process.version,
  head: spawnSync("git", ["-C", repo, "rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim(),
  productPatch: spawnSync(
    "git",
    ["-C", repo, "diff", "HEAD", "--", "packages/core/src/history.ts", "packages/cli/src/ui/server.ts"],
    { encoding: "utf8" },
  ).stdout,
  configuredDelays: "startUi defaults: versionDelayMs=2000, snapshotDelayMs=30000",
  phases: [],
  warnings: [],
  filesystemErrors: [],
};
const now = () => performance.timeOrigin + performance.now();
const warn = console.warn;
console.warn = (...args) => {
  result.warnings.push({ at: now(), message: args.map(String).join(" ") });
  warn(...args);
};
const writeFile = fs.promises.writeFile;
fs.promises.writeFile = async (...args) => {
  try {
    return await writeFile(...args);
  } catch (error) {
    result.filesystemErrors.push({ at: now(), code: error.code, path: String(args[0]) });
    throw error;
  }
};
async function waitFor(check) {
  const until = performance.now() + 45000;
  while (performance.now() < until) {
    const value = await check();
    if (value) return value;
    await delay(50);
  }
  throw new Error("real background recovery did not complete within probe bound");
}
async function versionText(file) {
  const oid = (await core.history(ws, { limit: 1 }))[0]?.oid;
  try {
    const { blob } = await git.readBlob({
      fs,
      dir: ws.root,
      gitdir: core.historyDirectory(ws),
      oid,
      filepath: file,
    });
    return { oid, text: Buffer.from(blob).toString() };
  } catch {
    return undefined;
  }
}
try {
  for (const recovery of ["timer", "close"]) {
    const origin = ui.url;
    const response = await fetch(`${origin}/api/product/capture`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Kaitu": "1", Origin: origin },
      body: JSON.stringify([`V2真实权限恢复 ${recovery}`]),
    });
    if (!response.ok) throw new Error(await response.text());
    const saved = await response.json();
    const text = ws.readText(saved.path);
    const { oid } = await git.hashBlob({ object: Buffer.from(text) });
    const objects = path.join(core.historyDirectory(ws), "objects", oid.slice(0, 2));
    fs.mkdirSync(objects, { recursive: true });
    const mode = fs.statSync(objects).mode & 0o777;
    const before = (await core.history(ws, { limit: 1 }))[0]?.oid;
    const warningCount = result.warnings.length;
    const phase = { recovery, path: saved.path, before, bytes: Buffer.byteLength(text) };
    result.phases.push(phase);
    try {
      fs.chmodSync(objects, 0o555);
      await waitFor(
        () =>
          result.warnings.length > warningCount &&
          result.filesystemErrors.some((e) => e.path.startsWith(objects) && e.code === "EACCES"),
      );
      phase.failedAt = now();
      if ((await core.history(ws, { limit: 1 }))[0]?.oid !== before || (await versionText(saved.path)))
        throw new Error("failed save unexpectedly advanced head");
      if (ws.readText(saved.path) !== text) throw new Error("raw note bytes changed after failure");
      fs.chmodSync(objects, mode);
      phase.restoredAt = now();
      if (recovery === "close") {
        await ui.close();
        ui = undefined;
      }
      const actual = await waitFor(async () => {
        const value = await versionText(saved.path);
        return value?.text === text ? value : undefined;
      });
      phase.verifiedAt = now();
      phase.waitAfterRestoreMs = phase.verifiedAt - phase.restoredAt;
      phase.version = actual.oid;
      phase.gitText = actual.text;
      if (
        core.inboxNotes(ws).filter((note) => note.content.includes(`V2真实权限恢复 ${recovery}`)).length !== 1
      )
        throw new Error("recovery duplicated the raw note");
    } finally {
      fs.chmodSync(objects, mode);
    }
  }
} catch (error) {
  result.failure = String(error);
  throw error;
} finally {
  console.warn = warn;
  fs.promises.writeFile = writeFile;
  await ui?.close();
  fs.writeFileSync(path.join(output, "raw-note-retry.json"), `${JSON.stringify(result, null, 2)}\n`);
}
console.log(JSON.stringify(result.phases));
