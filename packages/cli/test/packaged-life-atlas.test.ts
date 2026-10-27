import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { clonedWorkspace } from "../../core/test/helpers.js";

it("the packaged CLI/Web entry reads modules and generates a map through its shipped worker", async () => {
  const repo = fileURLToPath(new URL("../../..", import.meta.url));
  const root = mkdtempSync(join(tmpdir(), "kaitu-web-map-"));
  const output = join(root, "package");
  let child: ReturnType<typeof spawn> | undefined;
  try {
    const ws = await clonedWorkspace(undefined, join(root, "workspace"));
    execFileSync(process.execPath, [join(repo, "scripts/package-web.mjs"), output], { cwd: repo });
    const manifest = JSON.parse(readFileSync(join(output, "package.json"), "utf8"));
    expect(manifest.dependencies["@napi-rs/canvas"]).toBe("1.0.9");
    // Link each declared dependency to its real package directory. An outer node_modules junction
    // leaves pnpm's relative links ambiguous when Windows puts checkout and temp on different drives.
    for (const name of Object.keys(manifest.dependencies)) {
      const source = ["packages/cli", "packages/dsh-plugin", "packages/cartographer", "."]
        .map((base) => join(repo, base, "node_modules", name))
        .find((path) => existsSync(join(path, "package.json")));
      if (!source) throw new Error(`Missing installed test dependency: ${name}`);
      const target = join(output, "node_modules", name);
      mkdirSync(dirname(target), { recursive: true });
      symlinkSync(realpathSync(source), target, "junction");
    }
    child = spawn(
      process.execPath,
      [join(output, "dist/cli/main.js"), "ui", "--dir", ws.root, "--port", "0", "--no-open"],
      {
        cwd: output,
        env: { ...process.env, KAITU_LOCAL_STATE_DIR: join(root, "state") },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let log = "";
    child.stdout?.on("data", (chunk) => {
      log += chunk;
    });
    child.stderr?.on("data", (chunk) => {
      log += chunk;
    });
    await expect
      .poll(
        () => {
          if (child?.exitCode !== null) throw new Error(log);
          return log.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
        },
        { timeout: 15_000 },
      )
      .toBeTruthy();
    const url = log.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0] as string;
    const call = async (method: string, args: unknown[] = []) => {
      const response = await fetch(`${url}/api/product/${method}`, {
        method: "POST",
        headers: { "X-Kaitu": "1", Origin: url },
        body: JSON.stringify(args),
      });
      const result = await response.json();
      expect(response.status, result.error).toBe(200);
      return result;
    };
    await expect
      .poll(
        async () => {
          const state = await call("lifeAtlas");
          if (state.error) throw new Error(state.error);
          return state.loading;
        },
        { timeout: 15_000 },
      )
      .toBe(false);
    const initial = await call("lifeAtlas");
    expect(initial.modules.length).toBeGreaterThan(0);
    await call("lifeAtlasGenerate", [{ domains: [initial.modules[0].id] }]);
    await expect
      .poll(
        async () => {
          const state = await call("lifeAtlas");
          if (state.error) throw new Error(state.error);
          return state.running;
        },
        { timeout: 30_000 },
      )
      .toBe(false);
    const generated = await call("lifeAtlas");
    expect(generated.active).toBeTruthy();
    expect(generated.resource.svg).toContain("<svg");
    console.log(
      `Packaged CLI/Web map: ${process.platform}-${process.arch}, ${Buffer.byteLength(generated.resource.svg)} SVG bytes`,
    );
  } finally {
    if (child && child.exitCode === null) {
      const exited = once(child, "exit");
      child.kill();
      await exited;
    }
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}, 90_000);
