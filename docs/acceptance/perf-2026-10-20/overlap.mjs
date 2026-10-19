import { spawnSync } from "node:child_process";
// Independent HTTP client thread keeps sending while the server saves real Git versions.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";

if (!isMainThread) {
  parentPort.on("message", async (phase) => {
    const rows = [];
    for (let round = 0; round < (phase === "idle" ? 3 : 8); round++) {
      for (const [method, args] of [
        ["capture", [`V2 overlap ${phase} ${round}`]],
        [
          "completeNext",
          [
            `projects/synthetic-${(phase === "idle" ? 10 : 20) + round}/STATUS.md`,
            `next-${(phase === "idle" ? 10 : 20) + round}`,
          ],
        ],
        ["overview", []],
        ["health", []],
        ["findWorkspaceFiles", ["synthetic-1999"]],
      ]) {
        const at = performance.timeOrigin + performance.now();
        const response = await fetch(`${workerData.origin}/api/product/${method}`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Kaitu": "1", Origin: workerData.origin },
          body: JSON.stringify(args),
        });
        const body = await response.json();
        if (!response.ok) throw new Error(JSON.stringify(body));
        if (
          method === "findWorkspaceFiles" &&
          !body.some((entry) => entry.path.endsWith("synthetic-1999.md"))
        )
          throw new Error("search missed final synthetic note");
        rows.push({
          phase,
          round,
          method,
          at,
          ms: performance.timeOrigin + performance.now() - at,
          path: method === "capture" ? body.path : undefined,
        });
      }
    }
    parentPort.postMessage({ phase, rows });
  });
} else {
  const [repo, fixture, output] = process.argv.slice(2);
  if (!fixture?.startsWith(`${os.tmpdir()}/`)) throw new Error("temporary fixture required");
  fs.mkdirSync(output, { recursive: true });
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "kaitu-v2-overlap-"));
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
  fs.cpSync(fixture, process.env.KAITU_DIR, { recursive: true });
  await delay(2100);
  const core = await import(pathToFileURL(path.join(repo, "packages/core/dist/index.js")).href);
  const { startUi } = await import(pathToFileURL(path.join(repo, "packages/cli/dist/ui/server.js")).href);
  const ws = new core.Workspace(process.env.KAITU_DIR, { deferOverview: true });
  const ui = await startUi(ws, { port: 0, open: false });
  const worker = new Worker(new URL(import.meta.url), { workerData: { origin: ui.url } });
  const result = {
    at: new Date().toISOString(),
    repo,
    base,
    head: spawnSync("git", ["-C", repo, "rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim(),
    productPatch: spawnSync(
      "git",
      [
        "-C",
        repo,
        "diff",
        "--",
        "packages/core/src/phone-snapshots.ts",
        "packages/core/src/history.ts",
        "packages/cli/src/ui/server.ts",
      ],
      { encoding: "utf8" },
    ).stdout,
    node: process.version,
    platform: `${os.platform()} ${os.release()} ${os.arch()}`,
    cpu: os.cpus()[0].model,
    samples: [],
    timeline: [],
  };
  const writeSync = fs.writeFileSync;
  const writeAsync = fs.promises.writeFile;
  fs.writeFileSync = (file, ...args) => {
    const value = writeSync(file, ...args);
    if (String(file).endsWith("/kaitu-internal-history")) {
      result.timeline.push({ event: "save-start", at: performance.timeOrigin + performance.now() });
    }
    return value;
  };
  fs.promises.writeFile = async (file, ...args) => {
    const value = await writeAsync(file, ...args);
    if (String(file).endsWith("/history.git/refs/heads/main")) {
      result.timeline.push({ event: "ref-written", at: performance.timeOrigin + performance.now() });
    }
    return value;
  };
  function phase(name) {
    return new Promise((resolve, reject) => {
      worker.once("message", (data) => {
        result.samples.push(...data.rows);
        fs.writeFileSync(path.join(output, "progress.json"), JSON.stringify(result, null, 2));
        resolve();
      });
      worker.once("error", reject);
      worker.postMessage(name);
    });
  }
  try {
    // Settle actual startup scanning before comparing idle and active-save requests.
    await delay(1500);
    await phase("idle");
    // Keep sending before, during and after the unchanged 2-second save window.
    // Starting at the history marker alone would miss synchronous overview work before that marker.
    await phase("continuous");
    const captures = result.samples.filter((row) => row.method === "capture");
    const deadline = performance.now() + 15000;
    while (performance.now() < deadline) {
      const version = (await core.history(ws, { limit: 1 }))[0];
      if (
        version &&
        captures.every((row) => {
          const read = spawnSync(
            "git",
            [
              "--git-dir",
              ws.resolve(".kaitu/history.git", { internal: true }),
              "show",
              `${version.oid}:${row.path}`,
            ],
            { encoding: "utf8" },
          );
          return read.status === 0 && read.stdout.includes(`V2 overlap ${row.phase} ${row.round}`);
        })
      ) {
        result.verifiedVersion = version.oid;
        break;
      }
      await delay(100);
    }
    if (!result.verifiedVersion) throw new Error("subsequent captures missing from real Git version");
  } catch (error) {
    result.failure = String(error);
    throw error;
  } finally {
    fs.writeFileSync = writeSync;
    fs.promises.writeFile = writeAsync;
    await worker.terminate();
    await ui.close();
    fs.writeFileSync(path.join(output, "overlap.json"), `${JSON.stringify(result, null, 2)}\n`);
  }
  console.log(JSON.stringify(result));
}
