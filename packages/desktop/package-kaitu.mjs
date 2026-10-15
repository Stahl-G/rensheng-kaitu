#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const directory = dirname(fileURLToPath(import.meta.url));
const root = resolve(directory, "../..");
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    "dry-run": { type: "boolean", default: false },
    dmg: { type: "boolean", default: false },
    output: { type: "string" },
    "dsh-root": { type: "string", default: join(homedir(), "Developer/deepseek-harness-rc2") },
  },
});
if (positionals.length !== 1) {
  throw new Error(
    "用法：node packages/desktop/package-kaitu.mjs <DSH.app> [--output <Kaitu.app>] [--dmg] [--dry-run]",
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
if (!existsSync(source)) throw new Error(`输入不存在：${source}`);
const identity = process.env.KAITU_SIGN_IDENTITY?.trim();
const notaryProfile = process.env.KAITU_NOTARY_PROFILE?.trim();
if (identity && !identity.startsWith("Developer ID Application: "))
  throw new Error("KAITU_SIGN_IDENTITY 须为完整的 Developer ID Application 证书名");
if (notaryProfile && !identity) throw new Error("KAITU_NOTARY_PROFILE 需要同时设置 KAITU_SIGN_IDENTITY");
const dmg = join(dirname(output), "Kaitu.dmg");
if (values.dmg && existsSync(dmg)) throw new Error(`输出已存在，请另选目录：${dmg}`);
const kaituVersion = JSON.parse(readFileSync(join(root, "packages/cli/package.json"), "utf8")).version;
const version = `${kaituVersion}+dsh.0.2.0-rc.2`;
const plan = [
  `COPY ${source} → ${output}；校验 DSH 0.2.0-rc.2 / arm64 / 主入口`,
  `Info.plist: Kaitu / ai.kaitu.app / ${version} / CFBundleExecutable=Kaitu / 图标与 ASAR 完整性`,
  "Frameworks: 按实际 helper 应用重命名 Kaitu Helper…、可执行文件与 plist，统一 ai.kaitu.app.helper… 标识",
  "app.asar: 替换桌面品牌与关于版本；加入独立 userData bootstrap，移除强更元数据与 dsh:// 协议",
  "Resources: 移除 app-update.yml；从 SVG 生成 PNG / ICNS；内置插件、初始化器、schemas、templates、data 与 DSH 协议转接包",
  "MacOS: xcrun clang 构建原生 Kaitu 启动入口 → Electron Node 初始化 profile → 原生 DSH",
  "首次启动：读取 current-workspace.json，否则 ~/kaitu；共用 CLI patch（含定时任务、插件市场）；默认开图工作区与开图页",
  "数据目录：DSH_HOME、Electron userData / 日志 / 崩溃记录均在 ~/.kaitu-app/",
  identity
    ? `SIGN ${identity}：逐层签名 Electron / 内置 Mach-O / 应用，hardened runtime + DSH entitlements + timestamp`
    : "SIGN codesign --force --deep -s - Kaitu.app（ad-hoc）",
  "VERIFY codesign --verify --deep --strict Kaitu.app",
  ...(notaryProfile
    ? [
        `NOTARY ditto ZIP → xcrun notarytool submit --keychain-profile ${notaryProfile} --wait（检查 Accepted）`,
        "STAPLE xcrun stapler staple / validate Kaitu.app",
      ]
    : []),
  ...(values.dmg
    ? [
        `DMG hdiutil makehybrid + convert：Kaitu.app + Applications 链接 → ${dmg}`,
        ...(identity
          ? ["SIGN codesign --sign Developer-ID --timestamp Kaitu.dmg；codesign --verify Kaitu.dmg"]
          : []),
        ...(notaryProfile
          ? ["NOTARY submit Kaitu.dmg --wait（检查 Accepted）；STAPLE staple / validate Kaitu.dmg"]
          : []),
      ]
    : []),
];
console.log(plan.join("\n"));
if (values["dry-run"]) {
  console.log("DRY-RUN：仅列步骤，未读取应用内容、复制、写入、签名或提交公证。");
  process.exit(0);
}
const requireDsh = createRequire(join(resolve(values["dsh-root"]), "apps/desktop/package.json"));
const asarPath = requireDsh.resolve("@electron/asar", { paths: [requireDsh.resolve("app-builder-lib")] });
const asar = requireDsh(asarPath);
const requirePlugin = createRequire(join(root, "packages/dsh-plugin/package.json"));
const archive = join(source, "Contents/Resources/app.asar");
const manifest = JSON.parse(asar.extractFile(archive, "package.json").toString());
const dshVersion = manifest.version;
if (dshVersion !== "0.2.0-rc.2") throw new Error(`仅支持 DSH 0.2.0-rc.2，输入为 ${dshVersion}`);
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
// 欢迎页：DSH 标语换成「Powered by DSH 版本」，顶部标志换成开图标志。
const poweredBy = `Powered by DSH ${dshVersion}`;
const slogans = ["'组装无限可能，共探智能上限'", "'Build potential. Explore intelligence.'"];
for (const slogan of slogans) {
  if (brandedMain.split(slogan).length !== 2) throw new Error(`欢迎页标语结构已变化：${slogan}`);
}
changes.set(
  "lib/main.js",
  Buffer.from(
    slogans
      .reduce((text, slogan) => text.replace(slogan, JSON.stringify(poweredBy)), brandedMain)
      .replace(about, `applicationVersion: ${JSON.stringify(version)}`)
      .replace("app.setAppLogsPath();", 'app.setAppLogsPath(join(process.env.DSH_HOME, "logs"));'),
  ),
);
changes.set("renderer/assets/welcome-brand.svg", Buffer.from(welcomeBrand()));
const packagedManifest = {
  ...manifest,
  productName: "Kaitu",
  dshDesktopAppId: "ai.kaitu.app",
  main: "kaitu-bootstrap.mjs",
};
packagedManifest.dshMandatoryUpdatePolicy = undefined;
changes.set("package.json", Buffer.from(`${JSON.stringify(packagedManifest, null, 2)}\n`));
changes.set("kaitu-bootstrap.mjs", readFileSync(join(directory, "bootstrap.mjs")));

console.log(`app.asar: ${[...changes.keys()].join(", ")}；替换 ${replacements} 处品牌文案`);
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

async function packageApplication() {
  const temporary = mkdtempSync(join(tmpdir(), "kaitu-package-"));
  try {
    mkdirSync(dirname(output), { recursive: true });
    execFileSync("/usr/bin/ditto", [source, output]);
    const resources = join(output, "Contents/Resources");
    const payload = join(resources, "kaitu");
    await writePayload(payload);
    await writeIcon(resources);
    await rewriteArchive(join(temporary, "app.asar"));
    cpSync(join(temporary, "app.asar"), join(resources, "app.asar"));
    // 新归档保留每个文件的 unpacked 标记与权限，不更改内置 DSH 运行时。
    if (existsSync(join(temporary, "app.asar.unpacked"))) {
      cpSync(join(temporary, "app.asar.unpacked"), join(resources, "app.asar.unpacked"), { recursive: true });
    }
    verifyArchive(join(resources, "app.asar"));
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
    const { ElectronAsarIntegrity: integrity } = JSON.parse(
      execFileSync("/usr/bin/plutil", ["-convert", "json", "-o", "-", outputPlist], {
        encoding: "utf8",
      }),
    );
    if (integrity) {
      const hash = createHash("sha256")
        .update(asar.getRawHeader(join(resources, "app.asar")).headerString)
        .digest("hex");
      integrity["Resources/app.asar"] = { algorithm: "SHA256", hash };
      execFileSync("/usr/bin/plutil", [
        "-replace",
        "ElectronAsarIntegrity",
        "-json",
        JSON.stringify(integrity),
        outputPlist,
      ]);
      console.log(`ElectronAsarIntegrity: SHA256 ${hash}`);
    }
    const macos = join(output, "Contents/MacOS");
    if (nativeExecutable === "Kaitu" || nativeExecutable === "DSH") throw new Error("输入已经过定制");
    renameSync(join(macos, nativeExecutable), join(macos, "DSH"));
    execFileSync(
      "/usr/bin/xcrun",
      [
        "clang",
        "-arch",
        "arm64",
        "-mmacosx-version-min=12.0",
        "-Wall",
        "-Wextra",
        "-Werror",
        join(directory, "launcher.c"),
        "-o",
        join(macos, "Kaitu"),
      ],
      { stdio: "inherit" },
    );
    renameHelpers();
    await signApplication(temporary);
    execFileSync("/usr/bin/codesign", ["--verify", "--deep", "--strict", output], { stdio: "inherit" });
    if (notaryProfile) {
      const zip = join(temporary, "Kaitu.zip");
      execFileSync("/usr/bin/ditto", ["-c", "-k", "--keepParent", output, zip]);
      notarize(zip, output);
    }
    if (values.dmg) createDmg(temporary);
    console.log(`完成：${output}`);
  } catch (error) {
    // 输出目录由本次调用创建；失败不留下一个貌似可用的应用。
    rmSync(output, { recursive: true, force: true });
    throw error;
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

function renameHelpers() {
  const frameworks = join(output, "Contents/Frameworks");
  let foundBase = false;
  // Electron v44 OverrideChildProcessPath / GetApplicationName 使用主应用 CFBundleName，
  // 拼出 <name> Helper[ (类型)].app/Contents/MacOS/<name> Helper[ (类型)]。
  // 来源：electron/electron v44.0.0 shell/app/electron_main_delegate_mac.mm、shell/common/application_info_mac.mm。
  for (const entry of readdirSync(frameworks, { withFileTypes: true })) {
    const match = /^.+ Helper( \(([^)]+)\))?\.app$/.exec(entry.name);
    if (!entry.isDirectory() || !match) continue;
    const name = `Kaitu Helper${match[1] ?? ""}`;
    const helper = join(frameworks, entry.name);
    const plist = join(helper, "Contents/Info.plist");
    const executable = execFileSync("/usr/libexec/PlistBuddy", ["-c", "Print CFBundleExecutable", plist], {
      encoding: "utf8",
    }).trim();
    if (!executable || executable.includes("/"))
      throw new Error(`无效的 helper CFBundleExecutable：${entry.name}`);
    renameSync(join(helper, "Contents/MacOS", executable), join(helper, "Contents/MacOS", name));
    const identifier = `ai.kaitu.app.helper${match[2] ? `.${match[2].toLowerCase()}` : ""}`;
    for (const [key, value] of Object.entries({
      CFBundleName: name,
      CFBundleDisplayName: name,
      CFBundleExecutable: name,
      CFBundleIdentifier: identifier,
    })) {
      execFileSync("/usr/bin/plutil", ["-replace", key, "-string", value, plist]);
    }
    renameSync(helper, join(frameworks, `${name}.app`));
    if (!match[1]) foundBase = true;
    console.log(`Helper: ${entry.name} → ${name}.app (${identifier})`);
  }
  if (!foundBase) throw new Error("输入应用缺少基础 Helper.app");
}

async function signApplication(temporary) {
  if (!identity) {
    execFileSync("/usr/bin/codesign", ["--force", "--deep", "-s", "-", output], { stdio: "inherit" });
    return;
  }
  const { signAsync } = requireDsh(
    requireDsh.resolve("@electron/osx-sign", { paths: [requireDsh.resolve("app-builder-lib")] }),
  );
  const settings = join(resolve(values["dsh-root"]), "apps/desktop/scripts");
  const empty = join(temporary, "empty-entitlements.plist");
  writeFileSync(empty, '<?xml version="1.0"?><plist version="1.0"><dict/></plist>\n');
  await signAsync({
    app: output,
    identity,
    platform: "darwin",
    type: "distribution",
    preAutoEntitlements: false,
    // 与 DSH 的两层配置一致：Electron 需要 JIT、动态库与录音权限；
    // 内置运行时仅 Node / LibreOffice 需要 JIT，其余原生文件无额外权限。
    optionsForFile: (file) => {
      const runtime = /\/Contents\/Resources\/(?:runtime\/|app\.asar\.unpacked\/dsh\/)/.test(file);
      const jit =
        /\/dependencies\/node\/bin\/node$/.test(file) ||
        /\/libreoffice-kit-darwin-arm64\/bin\/libreoffice-kit$/.test(file);
      return {
        hardenedRuntime: true,
        entitlements: runtime
          ? jit
            ? join(settings, "jit-entitlements.plist")
            : empty
          : join(settings, "macos-entitlements.plist"),
      };
    },
  });
}

function notarize(artifact, target) {
  const result = JSON.parse(
    execFileSync(
      "/usr/bin/xcrun",
      [
        "notarytool",
        "submit",
        artifact,
        "--keychain-profile",
        notaryProfile,
        "--wait",
        "--output-format",
        "json",
      ],
      { encoding: "utf8", timeout: 60 * 60 * 1000 },
    ),
  );
  if (result.status !== "Accepted") {
    throw new Error(
      `公证失败：${result.status}；用 xcrun notarytool log ${result.id} --keychain-profile <profile> 查看原因`,
    );
  }
  for (const action of ["staple", "validate"]) {
    execFileSync("/usr/bin/xcrun", ["stapler", action, target], { stdio: "inherit" });
  }
}

function createDmg(temporary) {
  const staging = join(temporary, "dmg");
  mkdirSync(staging);
  execFileSync("/usr/bin/ditto", [output, join(staging, "Kaitu.app")]);
  symlinkSync("/Applications", join(staging, "Applications"));
  const hybrid = join(temporary, "Kaitu-hybrid.dmg");
  const image = join(temporary, "Kaitu.dmg");
  // 不挂载临时磁盘设备，也能生成保留应用与符号链接的 HFS+ 映像。
  execFileSync(
    "/usr/bin/hdiutil",
    ["makehybrid", "-hfs", "-hfs-volume-name", "Kaitu", "-o", hybrid, staging],
    { stdio: "inherit" },
  );
  execFileSync("/usr/bin/hdiutil", ["convert", hybrid, "-format", "UDZO", "-o", image], { stdio: "inherit" });
  if (identity) {
    execFileSync("/usr/bin/codesign", ["--force", "--sign", identity, "--timestamp", image], {
      stdio: "inherit",
    });
    execFileSync("/usr/bin/codesign", ["--verify", "--strict", image], { stdio: "inherit" });
  }
  if (notaryProfile) notarize(image, image);
  renameSync(image, dmg);
  console.log(`完成：${dmg}`);
}

async function writePayload(payload) {
  const { build } = requirePlugin("esbuild");
  mkdirSync(join(payload, "dist"), { recursive: true });
  await build({
    entryPoints: [join(directory, "plugin.mjs")],
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
  // 主面板已注册；不要依赖 bundle 尾部，地图组件会在其后附带许可证。
  const navigation = /(\n +)(ctx2\.slots\.inject\(\s*"sidebar\.panellist",)/g;
  if ([...client.matchAll(navigation)].length !== 1)
    throw new Error("开图客户端构建结构已变化，请核对默认页面插入点");
  writeFileSync(
    join(payload, "dist/client.js"),
    client.replace(
      navigation,
      (_match, indent, call) => `${indent}ctx2.layout.selectPanel(panel);${indent}${call}`,
    ),
  );
  const pluginManifest = JSON.parse(readFileSync(join(root, "packages/dsh-plugin/package.json"), "utf8"));
  writeFileSync(join(payload, "package.json"), `${JSON.stringify(pluginManifest, null, 2)}\n`);
  for (const folder of ["schemas", "templates"])
    cpSync(join(root, folder), join(payload, folder), { recursive: true });
  cpSync(join(root, "packages/core/data"), join(payload, "data"), { recursive: true });
  await writeProtocolBridge(payload, build);
}

async function writeProtocolBridge(payload, build) {
  const name = "@deepseek-ai/dsh-typert-protocol";
  const packagePath = `dsh/node_modules/${name}`;
  const protocol = JSON.parse(asar.extractFile(archive, `${packagePath}/package.json`).toString());
  const entry = protocol.exports?.["."];
  const target = typeof entry === "string" ? entry : (entry?.import ?? entry?.default ?? protocol.main);
  if (protocol.type !== "module" || typeof target !== "string") {
    throw new Error("未知的 DSH typert-protocol 模块类型或入口");
  }
  const entryPath = join(packagePath, target);
  const { metafile } = await build({
    stdin: { contents: asar.extractFile(archive, entryPath).toString(), sourcefile: entryPath },
    format: "esm",
    write: false,
    metafile: true,
  });
  const bridge = join(payload, "node_modules", name);
  const specifier = JSON.stringify(relative(bridge, join(dirname(payload), "app.asar", entryPath)));
  // 只转发到 DSH 的规范入口，Remote 与注册表复用同一模块实例。
  const exports = [`export * from ${specifier};`];
  if (Object.values(metafile.outputs).some((output) => output.exports.includes("default"))) {
    exports.push(`export { default } from ${specifier};`);
  }
  mkdirSync(bridge, { recursive: true });
  writeFileSync(
    join(bridge, "package.json"),
    `${JSON.stringify({ name, version: protocol.version, type: protocol.type, main: "index.js", exports: "./index.js" }, null, 2)}\n`,
  );
  writeFileSync(join(bridge, "index.js"), `${exports.join("\n")}\n`);
}

function welcomeBrand() {
  const mark = readFileSync(join(root, "docs/design/kaitu-mark.svg"), "utf8")
    .replace(/<svg[^>]*>/, "")
    .replace("</svg>", "");
  return `<svg width="472" height="40" viewBox="0 0 472 40" fill="none" xmlns="http://www.w3.org/2000/svg">
<style>
  :root { color: #0f1115; }
  @media (prefers-color-scheme: dark) { :root { color: #f9fafb; } }
  text { font: 600 30px -apple-system, "SF Pro Display", "PingFang SC", sans-serif; letter-spacing: -0.5px; }
</style>
<g transform="translate(176 1) scale(1.58)">${mark}</g>
<text x="222" y="31" fill="currentColor">Kaitu</text>
</svg>
`;
}

async function writeIcon(resources) {
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
  // 直接写 ICNS 的 PNG 图块，避免依赖 iconutil 的编码流程。
  const chunks = [];
  for (const [tag, size] of [
    ["icp4", 16],
    ["ic11", 32],
    ["icp5", 32],
    ["ic12", 64],
    ["ic07", 128],
    ["ic13", 256],
    ["ic08", 256],
    ["ic14", 512],
    ["ic09", 512],
    ["ic10", 1024],
  ]) {
    const image = await sharp(png).resize(size, size).png().toBuffer();
    const header = Buffer.alloc(8);
    header.write(tag);
    header.writeUInt32BE(image.length + 8, 4);
    chunks.push(header, image);
  }
  const body = Buffer.concat(chunks);
  const header = Buffer.alloc(8);
  header.write("icns");
  header.writeUInt32BE(body.length + 8, 4);
  writeFileSync(join(resources, "Kaitu.icns"), Buffer.concat([header, body]));
}

async function rewriteArchive(destination) {
  const extracted = join(dirname(destination), "extracted");
  asar.extractAll(archive, extracted);
  const unpack = [];
  const unpackDotFiles = [];
  const unpackDir = [];
  const escapeGlob = (path) => path.replace(/[\\*?[\]{}()!+@]/g, "\\$&");
  const visit = (entry, path = "", parentUnpacked = false) => {
    const unpacked = parentUnpacked || entry.unpacked === true;
    if (entry.files) {
      if (entry.unpacked) unpackDir.push(escapeGlob(path));
      const start = unpack.length;
      const children = Object.entries(entry.files).map(([name, child]) =>
        visit(child, path ? `${path}/${name}` : name, unpacked),
      );
      const allUnpacked = children.length > 0 && children.every(Boolean);
      // 将整棵 unpacked 子树合并为一个 glob，避免为每个文件展开巨大匹配式。
      if (path && allUnpacked) {
        unpack.splice(start, unpack.length - start, `${escapeGlob(join(extracted, path))}/**`);
      }
      return allUnpacked;
    }
    if (unpacked) {
      unpack.push(escapeGlob(join(extracted, path)));
      // asar 的 unpack glob 默认不匹配点文件，须为这些原件保留精确路径。
      if (path.split("/").some((part) => part.startsWith("."))) {
        unpackDotFiles.push(escapeGlob(join(extracted, path)));
      }
      // extractAll 仅恢复 header 的 executable 标记；unpacked 原件的权限来自磁盘。
      if (!entry.link) chmodSync(join(extracted, path), statSync(join(`${archive}.unpacked`, path)).mode);
    }
    return unpacked;
  };
  visit(asar.getRawHeader(archive).header);
  for (const [path, body] of changes) {
    mkdirSync(dirname(join(extracted, path)), { recursive: true });
    writeFileSync(join(extracted, path), body);
  }
  const pattern = (paths) => (paths.length > 1 ? `{${paths.join(",")}}` : paths[0]);
  // asar 3.4.1 的 Promise 在输出流 finish 前返回；子进程退出后才复制归档，确保尾部落盘。
  execFileSync(
    process.execPath,
    [
      join(directory, "repack-asar.mjs"),
      asarPath,
      extracted,
      destination,
      JSON.stringify({ unpack: pattern([...unpack, ...unpackDotFiles]), unpackDir: pattern(unpackDir) }),
    ],
    { stdio: "inherit" },
  );
}

function verifyArchive(destination) {
  asar.uncache(destination);
  for (const [path, expected] of changes) {
    const actual = asar.extractFile(destination, path);
    if (!actual.equals(expected)) throw new Error(`ASAR 内容自检失败：${path}`);
    console.log(`ASAR 内容自检通过：${path} (${actual.length} bytes)`);
  }
  for (const path of asar.listPackage(archive)) {
    const name = path.replace(/^\//, "");
    const before = asar.statFile(archive, name, false);
    const after = asar.statFile(destination, name, false);
    if (Boolean(before.unpacked) !== Boolean(after.unpacked)) {
      throw new Error(`ASAR unpacked 状态自检失败：${path}`);
    }
  }
  console.log(`ASAR 自检通过：${changes.size} 个新增或修改文件逐字节一致，原包 unpacked 状态一致`);
}
