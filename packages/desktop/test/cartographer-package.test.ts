import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { settings } from "../../cartographer/kaitu/settings.js";
import { mainland } from "../../cartographer/kaitu/terrain.js";
import { bundleCartographerWorker } from "../package-cartographer.mjs";

it("ships a matching native binary and CJK font, then renders in the standalone payload", async () => {
  const root = mkdtempSync(join(tmpdir(), "kaitu-canvas-payload-"));
  try {
    await expect(
      bundleCartographerWorker(join(root, "unsupported"), "dist", { platform: "darwin", arch: "universal" }),
    ).rejects.toThrow(/Unsupported/);
    await expect(
      bundleCartographerWorker(join(root, "cross"), "dist", {
        platform: process.platform === "darwin" ? "win32" : "darwin",
        arch: process.platform === "darwin" ? "x64" : "arm64",
      }),
    ).rejects.toThrow(/Unsupported/);
    expect(existsSync(join(root, "unsupported"))).toBe(false);
    expect(existsSync(join(root, "cross"))).toBe(false);
    await bundleCartographerWorker(root, "dist");
    const natives = readdirSync(join(root, "node_modules/@napi-rs"));
    expect(natives).toHaveLength(2);
    expect(natives).toContain("canvas");
    expect(natives.find((name) => name !== "canvas")).toMatch(
      new RegExp(`^canvas-${process.platform}-${process.arch}(?:-|$)`),
    );
    expect(readFileSync(join(root, "data/cartographer/fonts/OFL.txt"), "utf8")).toContain(
      "SIL OPEN FONT LICENSE",
    );
    // A loaded native DLL can remain mapped until process exit on Windows, even after worker termination.
    const result = JSON.parse(
      execFileSync(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          `
      import { Worker } from 'node:worker_threads';
      const worker = new Worker(${JSON.stringify(join(root, "dist/life-atlas-worker.js"))}, {
        execArgv: [],
        workerData: ${JSON.stringify({
          kind: "generate",
          directory: root,
          id: "synthetic",
          seed: "packaged-font-test",
          variant: 0,
          settings: settings(),
        })}});
      let progress = 0;
      try {
        const result = await new Promise((resolve, reject) => {
        worker.on("message", (message) => {
          if (message.progress) progress++;
          else if (message.error) reject(new Error(message.error));
          else resolve(message.result);
        });
        worker.once("error", reject);
        worker.once("exit", (code) => {
          if (code) reject(new Error('worker exit ' + code));
        });
        });
        console.log(JSON.stringify({...result, progress}));
      } finally { await worker.terminate(); }
    `,
        ],
        { encoding: "utf8", timeout: 30_000 },
      ),
    );
    expect(result.key).toHaveLength(24);
    expect(result.progress).toBeGreaterThan(2);
    const map = JSON.parse(readFileSync(join(root, "maps/synthetic.json"), "utf8"));
    expect(map.svg).toContain("<svg");
    expect(map.svg).not.toContain("@import");
    console.log(
      `Packaged map: ${process.platform}-${process.arch}, ${result.progress} worker progress messages, ${Buffer.byteLength(map.svg)} SVG bytes`,
    );
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}, 40_000);

it("keeps a seeded coastline reproducible while new seeds change its silhouette", () => {
  const first = mainland("00000000-0000-4000-8000-000000000001", 0, 160, 100).land;
  expect(mainland("00000000-0000-4000-8000-000000000001", 0, 160, 100).land).toEqual(first);
  const next = mainland("00000000-0000-4000-8000-000000000002", 0, 160, 100).land;
  let intersection = 0;
  let union = 0;
  for (let i = 0; i < first.length; i++) {
    if (first[i] && next[i]) intersection++;
    if (first[i] || next[i]) union++;
  }
  expect(intersection / union).toBeLessThan(0.7);
});
