// Thin process timer around the real CLI entry; no product service is replaced.
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
const dataset = process.argv[2];
const port = { sample: 8874, large: 8875, empty: 8876 }[dataset];
if (!port) throw new Error("Synthetic dataset required");
const folder = "docs/acceptance/footprint-step1-2026-10-20/product";
mkdirSync(folder, { recursive: true });
const start = performance.now();
const child = spawn(
  process.execPath,
  [
    "packages/cli/dist/main.js",
    "ui",
    "--dir",
    `/tmp/kaitu-footprint-integration-20261020/${dataset}`,
    "--port",
    String(port),
    "--no-open",
  ],
  {
    env: { ...process.env, KAITU_LOCAL_STATE_DIR: "/tmp/kaitu-footprint-integration-state-20261020" },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let ready = false;
child.stdout.on("data", (chunk) => {
  process.stdout.write(chunk);
  if (!ready && String(chunk).includes("开图工作台：")) {
    ready = true;
    const result = { dataset, port, pid: child.pid, serverReadyMs: performance.now() - start };
    writeFileSync(resolve(folder, `server-${dataset}.json`), `${JSON.stringify(result, null, 2)}\n`);
    console.log(JSON.stringify(result));
  }
});
child.stderr.on("data", (chunk) => process.stderr.write(chunk));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("exit", (code) => process.exit(code ?? 0));
