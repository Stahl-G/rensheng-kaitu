#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const directory = dirname(fileURLToPath(import.meta.url));
const root = resolve(directory, "../..");
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    "dry-run": { type: "boolean", default: false },
    output: { type: "string" },
    "dsh-root": { type: "string", default: join(homedir(), "Developer/deepseek-harness-rc2") },
  },
});
if (positionals.length !== 1) {
  throw new Error(
    "用法：node packages/desktop/package-kaitu.mjs <DSH.app> [--output <Kaitu.app>] [--dry-run]",
  );
}
const source = resolve(positionals[0]);
const output = resolve(values.output ?? join(root, "dist/Kaitu.app"));
if (!source.endsWith(".app") || basename(output) !== "Kaitu.app")
  throw new Error("输入须为 .app，输出须名为 Kaitu.app");
if (output === source || relative(source, output).startsWith("..") === false) {
  throw new Error("输出不能覆盖输入应用或位于输入包内");
}
if (existsSync(output)) throw new Error(`输出已存在，请另选目录：${output}`);
const requireDsh = createRequire(join(resolve(values["dsh-root"]), "apps/desktop/package.json"));
const asar = requireDsh(
  requireDsh.resolve("@electron/asar", { paths: [requireDsh.resolve("app-builder-lib")] }),
);
const requirePlugin = createRequire(join(root, "packages/dsh-plugin/package.json"));
const archive = join(source, "Contents/Resources/app.asar");
const manifest = JSON.parse(asar.extractFile(archive, "package.json").toString());
const dshVersion = manifest.version;
if (dshVersion !== "0.2.0-rc.2") throw new Error(`仅支持 DSH 0.2.0-rc.2，输入为 ${dshVersion}`);
const kaituVersion = JSON.parse(readFileSync(join(root, "packages/cli/package.json"), "utf8")).version;
const version = `${kaituVersion}+dsh.${dshVersion}`;
if (manifest.main !== "lib/main.js") throw new Error(`未知桌面入口：${manifest.main}`);
const main = asar.extractFile(archive, manifest.main).toString();
if (!main.includes("DeepSeek Harness")) throw new Error("找不到原生菜单品牌文案，拒绝静默跳过");
const plist = join(source, "Contents/Info.plist");
const nativeExecutable = execFileSync("/usr/libexec/PlistBuddy", ["-c", "Print CFBundleExecutable", plist], {
  encoding: "utf8",
}).trim();
if (!nativeExecutable || nativeExecutable.includes("/")) throw new Error("无效的 CFBundleExecutable");

const changes = new Map();
let replacements = 0;
for (const path of asar.listPackage(archive)) {
  const name = path.replace(/^\//, "");
  if (!/^(lib|renderer)\/.*\.(js|cjs|html|css|json)$/.test(name)) continue;
  const before = asar.extractFile(archive, name).toString();
  const count = before.split("DeepSeek Harness").length - 1;
  if (count) {
    changes.set(name, Buffer.from(before.replaceAll("DeepSeek Harness", "Kaitu")));
    replacements += count;
  }
}
// 保留 DSH 的版本：运行时描述符、Host 握手和 bundle 校验仍要求精确的 rc.2。
// 对用户展示的组合版本写入 Info.plist 和关于面板，不改内部 release identity。
const about = "applicationVersion: app.getVersion()";
const brandedMain = changes.get("lib/main.js").toString();
if (brandedMain.split(about).length !== 2) throw new Error("关于面板结构已变化，请核对本地 DSH 构建");
if (brandedMain.split("app.setAppLogsPath();").length !== 2)
  throw new Error("日志目录结构已变化，请核对本地 DSH 构建");
changes.set(
  "lib/main.js",
  Buffer.from(
    brandedMain
      .replace(about, `applicationVersion: ${JSON.stringify(version)}`)
      .replace("app.setAppLogsPath();", 'app.setAppLogsPath(join(process.env.DSH_HOME, "logs"));'),
  ),
);
const packagedManifest = {
  ...manifest,
  productName: "Kaitu",
  dshDesktopAppId: "ai.kaitu.app",
  main: "kaitu-bootstrap.mjs",
};
packagedManifest.dshMandatoryUpdatePolicy = undefined;
changes.set("package.json", Buffer.from(`${JSON.stringify(packagedManifest, null, 2)}\n`));
changes.set("kaitu-bootstrap.mjs", readFileSync(join(directory, "bootstrap.mjs")));

const plan = [
  `COPY ${source} → ${output}`,
  `Info.plist: Kaitu / ai.kaitu.app / ${version} / CFBundleExecutable=Kaitu / 图标与 ASAR 完整性`,
  `app.asar: ${[...changes.keys()].join(", ")}；替换 ${replacements} 处品牌文案，移除强更元数据`,
  "Resources: 移除 app-update.yml；写入 Kaitu.icns、icon.png、kaitu/dist、schemas、templates、data、package.json 与 DSH 依赖链接",
  "MacOS: Kaitu 启动包装器 → 内置 Electron 初始化 profile → 原生 DSH；所有应用状态在 ~/.kaitu-app/",
  "首次启动：读取 current-workspace.json，否则 ~/kaitu；生成品牌 patch 并默认打开开图页",
  "SIGN codesign --force --deep -s - Kaitu.app；codesign --verify --deep --strict Kaitu.app",
];
console.log(plan.join("\n"));
if (values["dry-run"]) {
  console.log("DRY-RUN：未复制、写入、签名或启动应用，也未改动用户数据。");
} else {
  if (process.platform !== "darwin" || process.arch !== "arm64") throw new Error("请在 macOS arm64 上后处理");
  const architectures = execFileSync(
    "/usr/bin/lipo",
    ["-archs", join(source, "Contents/MacOS", nativeExecutable)],
    {
      encoding: "utf8",
    },
  ).trim();
  if (architectures !== "arm64") throw new Error(`输入须为 arm64 应用，实际为 ${architectures}`);
  await packageApplication();
}

async function packageApplication() {
  const temporary = mkdtempSync(join(tmpdir(), "kaitu-package-"));
  try {
    mkdirSync(dirname(output), { recursive: true });
    execFileSync("/usr/bin/ditto", [source, output]);
    const resources = join(output, "Contents/Resources");
    const payload = join(resources, "kaitu");
    await writePayload(payload);
    await writeIcon(resources, temporary);
    await rewriteArchive(join(temporary, "app.asar"));
    cpSync(join(temporary, "app.asar"), join(resources, "app.asar"));
    // 新归档保留每个文件的 unpacked 标记与权限，不更改内置 DSH 运行时。
    if (existsSync(join(temporary, "app.asar.unpacked"))) {
      cpSync(join(temporary, "app.asar.unpacked"), join(resources, "app.asar.unpacked"), { recursive: true });
    }
    rmSync(join(resources, "app-update.yml"), { force: true });
    const outputPlist = join(output, "Contents/Info.plist");
    const set = (key, value) => {
      execFileSync("/usr/bin/plutil", ["-replace", key, "-string", value, outputPlist]);
    };
    for (const key of ["CFBundleName", "CFBundleDisplayName"]) set(key, "Kaitu");
    set("CFBundleIdentifier", "ai.kaitu.app");
    set("CFBundleShortVersionString", version);
    set("CFBundleVersion", version);
    set("CFBundleExecutable", "Kaitu");
    set("CFBundleIconFile", "Kaitu.icns");
    set("NSMicrophoneUsageDescription", "Kaitu 使用麦克风将语音转为消息草稿。");
    // 取消 dsh:// 协议声明，避免抢占原 DSH 应用的链接。
    execFileSync("/usr/bin/plutil", ["-remove", "CFBundleURLTypes", outputPlist]);
    const hash = createHash("sha256")
      .update(asar.getRawHeader(join(temporary, "app.asar")).headerString)
      .digest("hex");
    const integrity = JSON.parse(
      execFileSync("/usr/bin/plutil", ["-extract", "ElectronAsarIntegrity", "json", "-o", "-", outputPlist], {
        encoding: "utf8",
      }),
    );
    integrity["Resources/app.asar"] = { algorithm: "SHA256", hash };
    execFileSync("/usr/bin/plutil", [
      "-replace",
      "ElectronAsarIntegrity",
      "-json",
      JSON.stringify(integrity),
      outputPlist,
    ]);
    const macos = join(output, "Contents/MacOS");
    if (nativeExecutable === "Kaitu" || nativeExecutable === "DSH") throw new Error("输入已经过定制");
    renameSync(join(macos, nativeExecutable), join(macos, "DSH"));
    writeFileSync(
      join(macos, "Kaitu"),
      `#!/bin/sh
set -eu
KAITU_MACOS=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
export DSH_HOME="$HOME/.kaitu-app"
mkdir -p "$DSH_HOME/userData"
ELECTRON_RUN_AS_NODE=1 "$KAITU_MACOS/DSH" "$KAITU_MACOS/../Resources/kaitu/dist/initialize.mjs"
unset ELECTRON_RUN_AS_NODE
exec "$KAITU_MACOS/DSH" --user-data-dir="$DSH_HOME/userData" "$@"
`,
      { mode: 0o755 },
    );
    execFileSync("/usr/bin/codesign", ["--force", "--deep", "-s", "-", output], { stdio: "inherit" });
    execFileSync("/usr/bin/codesign", ["--verify", "--deep", "--strict", output], { stdio: "inherit" });
    console.log(`完成：${output}`);
  } catch (error) {
    // 输出目录由本次调用创建；失败不留下一个貌似可用的应用。
    rmSync(output, { recursive: true, force: true });
    throw error;
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

async function writePayload(payload) {
  const { build } = requirePlugin("esbuild");
  mkdirSync(join(payload, "dist"), { recursive: true });
  await build({
    entryPoints: [join(root, "packages/dsh-plugin/dist/index.js")],
    outfile: join(payload, "dist/index.js"),
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    banner: {
      js: 'import { createRequire as kaituRequire } from "node:module"; const require = kaituRequire(import.meta.url);',
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
      js: 'import { createRequire as kaituRequire } from "node:module"; const require = kaituRequire(import.meta.url);',
    },
    external: ["better-sqlite3"],
  });
  const clientPath = join(root, "packages/dsh-plugin/dist/client.js");
  const client = readFileSync(clientPath, "utf8");
  // 包内客户端复用原插件构建产物，仅在注册完主面板后增加一次默认导航。
  const tail = /\n {4}}\n {2}\}\);\n}\nreturn module\.exports;\}\}\);\s*$/;
  if (!tail.test(client)) throw new Error("开图客户端构建结构已变化，请核对默认页面插入点");
  writeFileSync(
    join(payload, "dist/client.js"),
    client.replace(tail, (match) => `\n      ctx2.layout.selectPanel(panel);${match}`),
  );
  const pluginManifest = JSON.parse(readFileSync(join(root, "packages/dsh-plugin/package.json"), "utf8"));
  writeFileSync(join(payload, "package.json"), `${JSON.stringify(pluginManifest, null, 2)}\n`);
  for (const folder of ["schemas", "templates"])
    cpSync(join(root, folder), join(payload, folder), { recursive: true });
  cpSync(join(root, "packages/core/data"), join(payload, "data"), { recursive: true });
  mkdirSync(join(payload, "node_modules"));
  symlinkSync("../../app.asar/dsh/node_modules/@deepseek-ai", join(payload, "node_modules/@deepseek-ai"));
}

async function writeIcon(resources, temporary) {
  const sharp = requireDsh("sharp");
  const mark = readFileSync(join(root, "docs/design/kaitu-mark.svg"), "utf8")
    .replace(/<svg[^>]*>/, "")
    .replace("</svg>", "")
    .replaceAll("currentColor", "#FFFFFF")
    .replaceAll('stroke-width="1.8"', 'stroke-width="1.6"')
    .replace('r="2.1"', 'r="2"')
    .replace("#3D6FE0", "#7FA2F0");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
<rect x="64" y="64" width="896" height="896" rx="224" fill="#1F1E1D"/>
<g transform="translate(227 227) scale(23.75)">${mark}</g></svg>`;
  const png = join(resources, "icon.png");
  await sharp(Buffer.from(svg)).png().toFile(png);
  const iconset = join(temporary, "Kaitu.iconset");
  mkdirSync(iconset);
  for (const size of [16, 32, 128, 256, 512]) {
    for (const scale of [1, 2]) {
      execFileSync(
        "/usr/bin/sips",
        [
          "-z",
          String(size * scale),
          String(size * scale),
          png,
          "--out",
          join(iconset, `icon_${size}x${size}${scale === 2 ? "@2x" : ""}.png`),
        ],
        { stdio: "ignore" },
      );
    }
  }
  execFileSync("/usr/bin/iconutil", ["-c", "icns", iconset, "-o", join(resources, "Kaitu.icns")]);
}

async function rewriteArchive(destination) {
  const streams = [];
  const visit = (files, parent = "", parentUnpacked = false) => {
    for (const [name, entry] of Object.entries(files)) {
      const path = parent ? `${parent}/${name}` : name;
      const unpacked = parentUnpacked || entry.unpacked === true;
      if (entry.files) {
        streams.push({ path, type: "directory", unpacked });
        visit(entry.files, path, unpacked);
      } else if (entry.link) {
        streams.push({
          path,
          type: "link",
          unpacked,
          symlink: relative(dirname(path), entry.link),
          stat: { mode: 0o777 },
        });
      } else {
        const replacement = changes.get(path);
        streams.push({
          path,
          type: "file",
          unpacked,
          stat: { size: replacement?.length ?? entry.size, mode: entry.executable ? 0o755 : 0o644 },
          streamGenerator: () => Readable.from([replacement ?? asar.extractFile(archive, path)]),
        });
        changes.delete(path);
      }
    }
  };
  visit(asar.getRawHeader(archive).header.files);
  for (const [path, body] of changes) {
    streams.push({
      path,
      type: "file",
      unpacked: false,
      stat: { size: body.length, mode: 0o644 },
      streamGenerator: () => Readable.from([body]),
    });
  }
  await asar.createPackageFromStreams(destination, streams);
}
