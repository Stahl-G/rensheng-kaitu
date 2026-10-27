import { cpSync, mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** Native N-API canvas stays external to esbuild; ship the installed platform binary with the worker. */
export async function bundleCartographerWorker(destination, workerDirectory = "dist") {
  const requirePlugin = createRequire(join(root, "packages/dsh-plugin/package.json"));
  const { build } = requirePlugin("esbuild");
  await build({
    entryPoints: [join(root, "packages/core/dist/life-atlas-worker.js")],
    outfile: join(destination, workerDirectory, "life-atlas-worker.js"),
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    banner: {
      js: 'import { createRequire as kaituRequire } from "node:module"; const require = kaituRequire(import.meta.url);',
    },
    external: ["@napi-rs/canvas"],
  });
  const requireAtlas = createRequire(join(root, "packages/cartographer/package.json"));
  const canvasManifest = requireAtlas.resolve("@napi-rs/canvas/package.json");
  const canvas = JSON.parse(readFileSync(canvasManifest, "utf8"));
  const requireCanvas = createRequire(canvasManifest);
  const nativePackages = Object.keys(canvas.optionalDependencies).filter((name) => {
    try {
      requireCanvas.resolve(`${name}/package.json`);
      return true;
    } catch {
      return false;
    }
  });
  if (!nativePackages.length) throw new Error("Cartographer native canvas binary is missing");
  for (const name of ["@napi-rs/canvas", ...nativePackages]) {
    const source = dirname(requireCanvas.resolve(`${name}/package.json`));
    const target = join(destination, "node_modules", name);
    mkdirSync(dirname(target), { recursive: true });
    cpSync(source, target, { recursive: true });
  }
  mkdirSync(join(destination, "licenses"), { recursive: true });
  cpSync(join(root, "packages/cartographer/LICENSE"), join(destination, "licenses/cartographer.txt"));
  cpSync(
    join(root, "packages/cartographer/UPSTREAM.json"),
    join(destination, "licenses/cartographer-source.json"),
  );
  cpSync(join(dirname(canvasManifest), "LICENSE"), join(destination, "licenses/canvas.txt"));
}
