import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import { expect, it } from "vitest";
import { settings } from "../../cartographer/kaitu/settings.js";
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
    await bundleCartographerWorker(root, "dist", { platform: process.platform, arch: process.arch });
    const natives = readdirSync(join(root, "node_modules/@napi-rs"));
    expect(natives).toEqual([
      "canvas",
      process.platform === "darwin" ? "canvas-darwin-arm64" : "canvas-win32-x64-msvc",
    ]);
    expect(readFileSync(join(root, "data/cartographer/fonts/OFL.txt"), "utf8")).toContain(
      "SIL OPEN FONT LICENSE",
    );
    const worker = new Worker(join(root, "dist/life-atlas-worker.js"), {
      workerData: {
        kind: "generate",
        directory: root,
        id: "synthetic",
        seed: "packaged-font-test",
        variant: 0,
        settings: settings(),
      },
    });
    let progress = 0;
    try {
      const result = await new Promise<{ key: string }>((resolve, reject) => {
        worker.on("message", (message) => {
          if (message.progress) progress++;
          else if (message.error) reject(new Error(message.error));
          else resolve(message.result);
        });
        worker.once("error", reject);
        worker.once("exit", (code) => {
          if (code) reject(new Error(`worker exit ${code}`));
        });
      });
      expect(result.key).toHaveLength(24);
      expect(progress).toBeGreaterThan(2);
      const map = JSON.parse(readFileSync(join(root, "maps/synthetic.json"), "utf8"));
      expect(map.svg).toContain("<svg");
      expect(map.svg).not.toContain("@import");
      console.log(
        `Packaged map: ${process.platform}-${process.arch}, ${progress} worker progress messages, ${Buffer.byteLength(map.svg)} SVG bytes`,
      );
    } finally {
      await worker.terminate();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 40_000);
