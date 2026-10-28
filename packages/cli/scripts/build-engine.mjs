import { cpSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { bundleCartographerWorker } from "../../desktop/package-cartographer.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const { build } = createRequire(join(root, "packages/dsh-plugin/package.json"))("esbuild");
const output = join(root, "packages/cli/dist/engine");
const desktop = join(root, "packages/desktop");
mkdirSync(output, { recursive: true });
for (const [name, entry] of Object.entries({
  service: join(root, "packages/cli/runtime/service.mjs"),
  "mcp-stdio": join(root, "packages/cli/dist/local-agents/mcp-stdio.js"),
  "sdk-plugin": join(desktop, "sdk-tools.mjs"),
  "sdk-host": join(desktop, "sdk-host.mjs"),
  "sdk-web": join(desktop, "sdk-web.mjs"),
})) {
  await build({
    entryPoints: [entry],
    outfile: join(output, `${name}.mjs`),
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    external: ["@deepseek-ai/*", "better-sqlite3"],
    banner: {
      js: [
        'import { createRequire as kaituRequire } from "node:module";',
        'import { dirname as kaituDirname } from "node:path";',
        'import { fileURLToPath as kaituFileURLToPath } from "node:url";',
        "const require = kaituRequire(import.meta.url);",
        "const __filename = kaituFileURLToPath(import.meta.url);",
        "const __dirname = kaituDirname(__filename);",
      ].join("\n"),
    },
  });
}
for (const name of ["sdk-credentials", "sdk-providers", "sdk-search-settings", "sdk-rpc", "sdk-support"])
  cpSync(join(desktop, `${name}.mjs`), join(output, `${name}.mjs`));
cpSync(join(root, "packages/core/data"), join(root, "packages/cli/dist/data"), { recursive: true });

await bundleCartographerWorker(output, ".");

await build({
  entryPoints: [join(root, "packages/core/dist/home-worker.js")],
  outfile: join(output, "home-worker.js"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  external: ["better-sqlite3"],
  banner: {
    js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
  },
});
