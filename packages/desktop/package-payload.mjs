import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire, findPackageJSON } from "node:module";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { bundleCartographerWorker } from "./package-cartographer.mjs";
import { HOST_API } from "./payload-loader.mjs";
import { adaptSiwcSource } from "./siwc-compat.mjs";
const directory = dirname(fileURLToPath(import.meta.url));
const root = resolve(directory, "../..");
const nodeBanner = [
  'import { createRequire as kaituRequire } from "node:module";',
  'import { dirname as kaituDirname } from "node:path";',
  'import { fileURLToPath as kaituFileURLToPath } from "node:url";',
  "const require = kaituRequire(import.meta.url);",
  "const __filename = kaituFileURLToPath(import.meta.url);",
  "const __dirname = kaituDirname(__filename);",
].join("\n");

export async function writePayload({ payload, archive, asar, payloadVersion, dshVersion, target }) {
  const requirePlugin = createRequire(join(root, "packages/dsh-plugin/package.json"));
  const { build } = requirePlugin("esbuild");
  mkdirSync(join(payload, "dist"), { recursive: true });
  writeFileSync(
    join(payload, "payload.json"),
    JSON.stringify({ version: payloadVersion, dshVersion, hostApi: HOST_API }),
  );
  await build({
    entryPoints: [join(directory, "plugin.mjs")],
    outfile: join(payload, "dist/index.js"),
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    banner: {
      js: nodeBanner,
    },
    external: ["@deepseek-ai/*", "better-sqlite3"],
  });
  await build({
    entryPoints: [join(directory, "sdk-tools.mjs")],
    outfile: join(payload, "dist/sdk-plugin.mjs"),
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    banner: {
      js: nodeBanner,
    },
    external: ["@deepseek-ai/*", "better-sqlite3"],
  });
  await build({
    entryPoints: [join(directory, "initialize.mjs")],
    outfile: join(payload, "dist/initialize.mjs"),
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    banner: {
      js: nodeBanner,
    },
    external: ["better-sqlite3"],
  });
  await build({
    entryPoints: [join(directory, "local.mjs")],
    outfile: join(payload, "dist/local.mjs"),
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    banner: {
      js: nodeBanner,
    },
    external: ["better-sqlite3"],
  });
  await build({
    entryPoints: [join(root, "packages/cli/dist/local-agents/mcp-stdio.js")],
    outfile: join(payload, "dist/mcp-stdio.mjs"),
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    banner: { js: nodeBanner },
    external: ["better-sqlite3"],
  });
  await build({
    entryPoints: [join(root, "packages/cli/dist/main.js")],
    outfile: join(payload, "dist/cli.mjs"),
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    banner: { js: nodeBanner },
    external: ["@deepseek-ai/*", "better-sqlite3"],
  });
  // Bundle the reviewed SIWC host implementation; DSH services remain shared with the host.
  await build({
    entryPoints: [requirePlugin.resolve("dsh-plugin-chatgpt-siwc")],
    outfile: join(payload, "dist/chatgpt-siwc.mjs"),
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    banner: { js: nodeBanner },
    external: ["@deepseek-ai/*"],
    plugins: [
      {
        name: "kaitu-siwc-compatibility",
        setup(builder) {
          builder.onLoad(
            { filter: /(?:storage[\\/]state|api[\\/]controller|auth[\\/](?:index|loopback))\.js$/ },
            (args) => {
              if (!args.path.includes("dsh-plugin-chatgpt-siwc")) return;
              return { contents: adaptSiwcSource(args.path, readFileSync(args.path, "utf8")), loader: "js" };
            },
          );
        },
      },
    ],
  });
  await build({
    entryPoints: [join(directory, "sdk-host.mjs")],
    outfile: join(payload, "dist/sdk-host.mjs"),
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    banner: { js: nodeBanner },
  });
  await build({
    entryPoints: [join(root, "packages/core/dist/health-import-worker.js")],
    outfile: join(payload, "dist/health-import-worker.js"),
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    banner: { js: nodeBanner },
    external: ["better-sqlite3"],
  });
  await build({
    entryPoints: [join(directory, "sdk-web.mjs")],
    outfile: join(payload, "dist/sdk-web.mjs"),
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    banner: { js: nodeBanner },
    external: ["better-sqlite3"],
  });
  await bundleCartographerWorker(payload, "dist", target);
  mkdirSync(join(payload, "licenses"), { recursive: true });
  cpSync(join(root, "LICENSE"), join(payload, "licenses", "kaitu.txt"));
  cpSync(join(root, "THIRD_PARTY_NOTICES.md"), join(payload, "licenses", "THIRD_PARTY_NOTICES.md"));
  writeFileSync(
    join(payload, "licenses", "deepseek-harness.txt"),
    asar.extractFile(archive, join("dsh/node_modules/@deepseek-ai/dsh-brand", "LICENSE")),
  );
  const siwcEntry = pathToFileURL(requirePlugin.resolve("dsh-plugin-chatgpt-siwc")).href;
  for (const dependency of ["dsh-plugin-chatgpt-siwc", "jose", "ws", "zod"]) {
    const manifest = findPackageJSON(dependency, siwcEntry);
    if (!manifest) throw new Error(`Missing license package: ${dependency}`);
    const dir = dirname(manifest);
    const license = ["LICENSE", "LICENSE.md"].find((file) => existsSync(join(dir, file)));
    if (!license) throw new Error(`Missing license: ${dependency}`);
    const name = dependency === "dsh-plugin-chatgpt-siwc" ? "chatgpt-siwc" : `chatgpt-siwc-${dependency}`;
    cpSync(join(dir, license), join(payload, `licenses/${name}.txt`));
  }
  for (const name of ["dsh-web-search-exa", "dsh-web-search-perplexity"])
    cpSync(
      join(root, "node_modules/@deepseek-ai", name, "LICENSE"),
      join(payload, "licenses", `${name}.txt`),
    );
  for (const file of [
    "sdk-credentials.mjs",
    "sdk-providers.mjs",
    "sdk-search-settings.mjs",
    "sdk-rpc.mjs",
    "sdk-support.mjs",
  ])
    cpSync(join(directory, file), join(payload, "dist", file));
  cpSync(join(root, "packages/dsh-plugin/dist/standalone"), join(payload, "web"), { recursive: true });
  const clientPath = join(root, "packages/dsh-plugin/dist/client.js");
  const client = readFileSync(clientPath, "utf8");
  // 主面板已注册；不要依赖 bundle 尾部，地图组件会在其后附带许可证。
  const navigation = /(\n +)(ctx2\.slots\.inject\(\s*"sidebar\.panellist",)/g;
  if ([...client.matchAll(navigation)].length !== 1)
    throw new Error("开图客户端构建结构已变化，请核对默认页面插入点");
  writeFileSync(
    join(payload, "dist/client.js"),
    client.replace(
      navigation,
      (_match, indent, call) =>
        `${indent}if (new URLSearchParams(window.location.hash.slice(1)).get("kaitu-embed") !== "1") ctx2.layout.selectPanel(panel);${indent}${call}`,
    ),
  );
  const pluginManifest = JSON.parse(readFileSync(join(root, "packages/dsh-plugin/package.json"), "utf8"));
  writeFileSync(join(payload, "package.json"), `${JSON.stringify(pluginManifest, null, 2)}\n`);
  for (const folder of ["schemas", "templates"])
    cpSync(join(root, folder), join(payload, folder), { recursive: true });
  cpSync(join(root, "packages/core/data"), join(payload, "data"), { recursive: true });
  // 插件里用到的每个 DSH 入口都转接到宿主自带的同一份模块；从构建结果里找，内核新增子路径时不会漏。
  const bridges = new Map();
  for (const file of ["dist/index.js", "dist/sdk-plugin.mjs", "dist/cli.mjs", "dist/chatgpt-siwc.mjs"])
    for (const [, name, subpath] of readFileSync(join(payload, file), "utf8").matchAll(
      /from ?"(@deepseek-ai\/[\w-]+)(\/[\w-]+)?"/g,
    ))
      bridges.set(name, new Set([...(bridges.get(name) ?? []), subpath ? `.${subpath}` : "."]));
  for (const [name, subpaths] of bridges)
    await writeProtocolBridge(payload, build, name, [...subpaths], archive, asar);
}

async function writeProtocolBridge(payload, build, name, subpaths, archive, asar) {
  const packagePath = join("dsh/node_modules", name);
  const manifest = JSON.parse(asar.extractFile(archive, `${packagePath}/package.json`).toString());
  const bridge = join(payload, "node_modules", name);
  mkdirSync(bridge, { recursive: true });
  const exportsMap = {};
  for (const [index, subpath] of subpaths.entries()) {
    const declaration = manifest.exports?.[subpath];
    const target =
      typeof declaration === "string"
        ? declaration
        : (declaration?.import ?? declaration?.default ?? manifest.main);
    if (manifest.type !== "module" || typeof target !== "string")
      throw new Error(`DSH 模块入口不可用：${name}${subpath}`);
    const entryPath = join(packagePath, target);
    const { metafile } = await build({
      stdin: { contents: asar.extractFile(archive, entryPath).toString(), sourcefile: entryPath },
      format: "esm",
      write: false,
      metafile: true,
    });
    const filename = `bridge-${index}.js`;
    const specifier = JSON.stringify(
      relative(bridge, join(dirname(payload), "app.asar", entryPath))
        .split(sep)
        .join("/"),
    );
    const lines = [`export * from ${specifier};`];
    if (Object.values(metafile.outputs).some((output) => output.exports.includes("default")))
      lines.push(`export { default } from ${specifier};`);
    writeFileSync(join(bridge, filename), `${lines.join("\n")}\n`);
    exportsMap[subpath] = `./${filename}`;
  }
  writeFileSync(
    join(bridge, "package.json"),
    `${JSON.stringify({ name, version: manifest.version, type: "module", exports: exportsMap }, null, 2)}\n`,
  );
}
