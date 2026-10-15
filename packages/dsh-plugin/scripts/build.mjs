import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { WorkspaceTypertGenerator } from "@deepseek-ai/dsh-typert-generator";
import { build } from "esbuild";
import { transform } from "lightningcss";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const pkg = resolve(root, "packages/dsh-plugin");
// rc.2 recognizes protocol symbols only inside its workspace inventory. Give the
// published declarations a temporary workspace identity, without importing DSH source.
const analysis = mkdtempSync("/tmp/kaitu-typert-");
try {
  const analyzedPkg = resolve(analysis, "packages/dsh-plugin");
  const protocol = resolve(analysis, "packages/protocol");
  mkdirSync(analyzedPkg, { recursive: true });
  cpSync(resolve(pkg, "src"), resolve(analyzedPkg, "src"), { recursive: true });
  cpSync(resolve(pkg, "package.json"), resolve(analyzedPkg, "package.json"));
  mkdirSync(resolve(analyzedPkg, "lib"));
  writeFileSync(resolve(analyzedPkg, "lib/typert.host.d.ts"), "export declare const TYPERT: unknown;\n");
  symlinkSync(resolve(pkg, "node_modules"), resolve(analyzedPkg, "node_modules"));
  cpSync(resolve(pkg, "node_modules/@deepseek-ai/dsh-typert-protocol/lib/types"), resolve(protocol, "src"), {
    recursive: true,
  });
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
      references: [{ path: "packages/dsh-plugin" }, { path: "packages/protocol" }],
    }),
  );
  const generator = new WorkspaceTypertGenerator(analysis);
  for (const artifact of generator.generate(["@kaitu/dsh-plugin"], ["host"])) {
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
execFileSync("tsc", ["-p", "tsconfig.client.json"], { cwd: pkg, stdio: "inherit" });
await build({
  entryPoints: [resolve(pkg, "src/index.ts")],
  outfile: resolve(pkg, "dist/index.js"),
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  packages: "external",
});
const css = [];
const worker = await build({
  entryPoints: [resolve(pkg, "node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs")],
  bundle: true,
  format: "iife",
  minify: true,
  write: false,
});
await build({
  entryPoints: [resolve(pkg, "src/client/index.tsx")],
  outfile: resolve(pkg, "dist/client.js"),
  bundle: true,
  platform: "browser",
  target: "es2022",
  format: "cjs",
  jsx: "automatic",
  external: ["react", "react/*", "@deepseek-ai/cordis", "@deepseek-ai/dsh-client-ui-primitives"],
  plugins: [
    {
      name: "kaitu-css-modules",
      setup(builder) {
        builder.onLoad({ filter: /maplibre-gl-worker\.mjs$/ }, () => ({
          contents: `export default ${JSON.stringify(worker.outputFiles[0].text)}`,
          loader: "js",
        }));
        builder.onLoad({ filter: /maplibre-gl\.css$/ }, ({ path }) => {
          css.push(readFileSync(path, "utf8"));
          return { contents: "", loader: "js" };
        });
        builder.onLoad({ filter: /\.module\.css$/ }, async ({ path }) => {
          const { readFileSync } = await import("node:fs");
          const result = transform({
            filename: path,
            code: readFileSync(path),
            cssModules: { pattern: "kt_[local]_[hash]" },
          });
          css.push(result.code.toString());
          const names = Object.fromEntries(
            Object.entries(result.exports).map(([key, value]) => [key, value.name]),
          );
          return {
            contents: `export default ${JSON.stringify(names)}`,
            loader: "js",
            resolveDir: dirname(path),
          };
        });
      },
    },
  ],
  banner: {
    js: 'window.__ModuleLoader__.load({id:"@kaitu/dsh-plugin",factory:(require)=>{var module={exports:{}};var exports=module.exports;',
  },
  footer: { js: "return module.exports;}});" },
  write: false,
}).then((result) => {
  // Styles belong to this plugin's lifetime; dsh removes these tags on unload.
  const style = [
    'const style=document.createElement("style");',
    'style.dataset.plugin="@kaitu/dsh-plugin";',
    'style.dataset.pluginCss="overview";',
    `style.textContent=${JSON.stringify(css.join("\n"))};`,
    "document.head.appendChild(style);",
  ].join("");
  writeFileSync(
    resolve(pkg, "dist/client.js"),
    result.outputFiles[0].text.replace("var exports=module.exports;", `var exports=module.exports;${style}`),
  );
});
