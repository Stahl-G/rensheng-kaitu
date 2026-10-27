import { chmodSync, cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(process.argv[2] ?? join(root, "dist/web-release"));
const { build } = createRequire(join(root, "packages/dsh-plugin/package.json"))("esbuild");
const cli = JSON.parse(readFileSync(join(root, "packages/cli/package.json"), "utf8"));
const plugin = JSON.parse(readFileSync(join(root, "packages/dsh-plugin/package.json"), "utf8"));
mkdirSync(join(output, "dist/cli"), { recursive: true });
const banner = [
  'import { createRequire as kaituRequire } from "node:module";',
  'import { dirname as kaituDirname } from "node:path";',
  'import { fileURLToPath as kaituFileURLToPath } from "node:url";',
  "const require = kaituRequire(import.meta.url);",
  "const __filename = kaituFileURLToPath(import.meta.url);",
  "const __dirname = kaituDirname(__filename);",
].join("\n");
for (const [entry, target] of [
  ["packages/cli/src/main.ts", "dist/cli/main.js"],
  ["packages/core/src/health-import-worker.ts", "dist/cli/health-import-worker.js"],
]) {
  await build({
    entryPoints: [join(root, entry)],
    outfile: join(output, target),
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    external: ["@deepseek-ai/*", "better-sqlite3"],
    banner: { js: banner },
  });
}
const pluginDist = join(output, "dsh-plugin/dist");
mkdirSync(pluginDist, { recursive: true });
await build({
  entryPoints: [join(root, "packages/dsh-plugin/src/index.ts")],
  outfile: join(pluginDist, "index.js"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  external: ["@deepseek-ai/*", "better-sqlite3"],
  banner: { js: banner },
});
cpSync(join(root, "packages/dsh-plugin/dist/client.js"), join(pluginDist, "client.js"));
const pluginImports = new Set(
  [
    ...readFileSync(join(pluginDist, "index.js"), "utf8").matchAll(
      /(?:from\s*|import\s*\(\s*)["'](@deepseek-ai\/[\w-]+)/g,
    ),
  ].map(([, name]) => name),
);
cpSync(join(output, "dist/cli/health-import-worker.js"), join(output, "dist/health-import-worker.js"));
for (const [source, target] of [
  ["packages/cli/dist/engine", "dist/engine"],
  ["packages/core/data", "dist/data"],
  ["packages/dsh-plugin/dist/standalone", "web"],
  ["schemas", "schemas"],
  ["templates", "templates"],
  ["LICENSE", "LICENSE"],
  ["THIRD_PARTY_NOTICES.md", "THIRD_PARTY_NOTICES.md"],
])
  cpSync(join(root, source), join(output, target), { recursive: true });
cpSync(join(output, "dist/cli/health-import-worker.js"), join(output, "dist/engine/health-import-worker.js"));
const dependencies = Object.fromEntries(
  Object.entries(cli.dependencies).filter(
    ([name]) => name.startsWith("@deepseek-ai/") || name === "@vscode/ripgrep",
  ),
);
// npm omits nested node_modules from packed files; installation supplies the host's native binding.
dependencies["@napi-rs/canvas"] = JSON.parse(
  readFileSync(join(root, "packages/cartographer/package.json"), "utf8"),
).dependencies["@napi-rs/canvas"];
for (const name of pluginImports) {
  const version = plugin.dependencies[name] ?? cli.dependencies[name];
  if (!version) throw new Error(`插件 bundle 引用了未声明的依赖：${name}`);
  dependencies[name] = version;
}
for (const name of ["dsh-web-search-exa", "dsh-web-search-perplexity"])
  dependencies[`@deepseek-ai/${name}`] = "0.2.1-rc.3";
const pluginPackage = {
  name: plugin.name,
  version: cli.version,
  type: plugin.type,
  main: plugin.main,
  exports: Object.fromEntries(
    [".", "./client"].map((name) => [name, { default: plugin.exports[name].default }]),
  ),
  dsh: plugin.dsh,
};
writeFileSync(join(output, "dsh-plugin/package.json"), `${JSON.stringify(pluginPackage, null, 2)}\n`);
writeFileSync(
  join(output, "package.json"),
  `${JSON.stringify(
    {
      name: cli.name,
      version: cli.version,
      description: cli.description,
      license: cli.license,
      type: "module",
      bin: { kaitu: "dist/cli/main.js" },
      engines: { node: "^22.19.0 || >=24" },
      files: ["dist", "dsh-plugin", "web", "schemas", "templates", "THIRD_PARTY_NOTICES.md"],
      dependencies,
    },
    null,
    2,
  )}\n`,
);
cpSync(join(root, "docs/web.md"), join(output, "README.md"));
chmodSync(join(output, "dist/cli/main.js"), 0o755);
console.log(`CLI/Web 安装包目录：${output}`);
