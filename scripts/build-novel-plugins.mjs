import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const require = createRequire(new URL("../packages/novel-plugin/package.json", import.meta.url));
const { WorkspaceTypertGenerator } = await import(require.resolve("@deepseek-ai/dsh-typert-generator"));
const { build } = require("esbuild");
const { transform } = require("lightningcss");

const root = fileURLToPath(new URL("..", import.meta.url));
const folder = process.argv[2];
const pkg = resolve(root, "packages", folder);
const packageName = JSON.parse(readFileSync(resolve(pkg, "package.json"), "utf8")).name;
// rc.2 recognizes protocol symbols only inside its workspace inventory. Give the
// published declarations a temporary workspace identity, without importing DSH source.
const analysis = mkdtempSync("/tmp/kaitu-typert-");
if (folder === "novel-plugin")
  try {
    const analyzedPkg = resolve(analysis, `packages/${folder}`);
    const protocol = resolve(analysis, "packages/protocol");
    mkdirSync(analyzedPkg, { recursive: true });
    cpSync(resolve(pkg, "src"), resolve(analyzedPkg, "src"), { recursive: true });
    cpSync(resolve(pkg, "package.json"), resolve(analyzedPkg, "package.json"));
    mkdirSync(resolve(analyzedPkg, "lib"));
    writeFileSync(resolve(analyzedPkg, "lib/typert.host.d.ts"), "export declare const TYPERT: unknown;\n");
    symlinkSync(resolve(pkg, "node_modules"), resolve(analyzedPkg, "node_modules"));
    cpSync(
      resolve(pkg, "node_modules/@deepseek-ai/dsh-typert-protocol/lib/types"),
      resolve(protocol, "src"),
      {
        recursive: true,
      },
    );
    writeFileSync(
      resolve(protocol, "package.json"),
      JSON.stringify({ name: "@deepseek-ai/dsh-typert-protocol", exports: { ".": "./src/index.d.ts" } }),
    );
    symlinkSync(resolve(pkg, "node_modules"), resolve(protocol, "node_modules"));
    const options = JSON.parse(readFileSync(resolve(root, "tsconfig.base.json"), "utf8"));
    options.compilerOptions.types = ["node"];
    options.compilerOptions.paths = {
      "@deepseek-ai/dsh-typert-protocol": [resolve(protocol, "src/index.d.ts")],
    };
    writeFileSync(resolve(analysis, "tsconfig.base.json"), JSON.stringify(options));
    symlinkSync(resolve(root, "node_modules"), resolve(analysis, "node_modules"));
    for (const dir of [analyzedPkg, protocol]) {
      writeFileSync(
        resolve(dir, "tsconfig.json"),
        JSON.stringify({
          extends: "../../tsconfig.base.json",
          include: ["src/**/*.ts"],
          exclude: ["src/client"],
        }),
      );
    }
    writeFileSync(
      resolve(analysis, "tsconfig.host.json"),
      JSON.stringify({
        extends: "./tsconfig.base.json",
        files: [],
        references: [{ path: `packages/${folder}` }, { path: "packages/protocol" }],
      }),
    );
    const generator = new WorkspaceTypertGenerator(analysis);
    for (const artifact of generator.generate([packageName], ["host"])) {
      const base = resolve(pkg, "lib");
      mkdirSync(base, { recursive: true });
      writeFileSync(resolve(base, "typert.host.js"), artifact.js);
      writeFileSync(resolve(base, "typert.host.d.ts"), artifact.dts);
      if (artifact.remote) {
        writeFileSync(resolve(base, "typert.remote-client.js"), artifact.remote.js);
        writeFileSync(resolve(base, "typert.remote-client.d.ts"), artifact.remote.dts);
      }
    }
  } finally {
    rmSync(analysis, { recursive: true, force: true });
  }
execFileSync("tsc", ["-p", "tsconfig.json"], { cwd: pkg, stdio: "inherit" });
if (folder === "novel-plugin")
  execFileSync("tsc", ["-p", "tsconfig.client.json"], { cwd: pkg, stdio: "inherit" });
const hostBundle = await build({
  metafile: true,
  entryPoints: [resolve(pkg, "src/index.ts")],
  outfile: resolve(pkg, "dist/index.js"),
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  external: ["@deepseek-ai/cordis", "@deepseek-ai/dsh-typert-protocol"],
  banner: {
    js: 'import { createRequire as __kaituCreateRequire } from "node:module"; const require=__kaituCreateRequire(import.meta.url);',
  },
});

writeFileSync(resolve(pkg, "dist/metafile.json"), JSON.stringify(hostBundle.metafile));

if (folder !== "novel-plugin") rmSync(analysis, { recursive: true, force: true });

if (folder === "novel-plugin") {
  const css = [];
  const output = await build({
    entryPoints: [resolve(pkg, "src/client/index.tsx")],
    bundle: true,
    platform: "browser",
    format: "cjs",
    jsx: "automatic",
    write: false,
    target: "es2022",
    external: ["react", "react/*", "@deepseek-ai/cordis"],
    plugins: [
      {
        name: "novel-css",
        setup(b) {
          b.onLoad({ filter: /\.module\.css$/ }, ({ path }) => {
            const r = transform({
              filename: path,
              code: readFileSync(path),
              cssModules: { pattern: "kn_[local]_[hash]" },
            });
            css.push(r.code.toString());
            return {
              contents: `export default ${JSON.stringify(Object.fromEntries(Object.entries(r.exports).map(([k, v]) => [k, v.name])))}`,
              loader: "js",
              resolveDir: dirname(path),
            };
          });
        },
      },
    ],
    banner: {
      js: `window.__ModuleLoader__.load({id:${JSON.stringify(packageName)},factory:(require)=>{var module={exports:{}};var exports=module.exports;`,
    },
    footer: { js: "return module.exports;}});" },
  });
  writeFileSync(
    resolve(pkg, "dist/client.js"),
    output.outputFiles[0].text.replace(
      "var exports=module.exports;",
      `var exports=module.exports;window.__kaituNovelStyles=${JSON.stringify(css.join("\n"))};`,
    ),
  );
  // CSS lifetime follows Cordis apply/dispose, including hot reload.
  writeFileSync(resolve(pkg, "dist/styles.json"), JSON.stringify(css.join("\n")));
}
