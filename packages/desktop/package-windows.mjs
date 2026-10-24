#!/usr/bin/env node
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { productCopyright, withProductCopyright } from "./brand.mjs";
import { rewriteArchive } from "./package-archive.mjs";
import { writePayload } from "./package-payload.mjs";
import { readUpdateConfig } from "./update-config.mjs";

const directory = dirname(fileURLToPath(import.meta.url));
const root = resolve(directory, "../..");
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    output: { type: "string" },
    tools: { type: "string" },
    dir: { type: "boolean" },
    revision: { type: "string" },
    "update-config": { type: "string" },
    "update-public-key": { type: "string" },
  },
});
if (process.platform !== "win32" || process.arch !== "x64") throw new Error("请在 Windows x64 上打包");
if (positionals.length !== 1)
  throw new Error(
    "用法：node packages/desktop/package-windows.mjs <已解压的 DSH 目录> [--output dist/windows] [--tools 工具目录] [--dir]",
  );
const source = resolve(positionals[0]);
if (values.revision !== undefined && !/^[1-9]\d*$/.test(values.revision))
  throw new Error("安装器修订号必须是正整数");
const output = resolve(values.output || join(root, "dist/windows"));
if (existsSync(output)) throw new Error(`输出已存在，请另选目录：${output}`);
const requireTools = createRequire(
  join(resolve(values.tools || join(root, ".kaitu/windows-tools")), "package.json"),
);
const asarPath = requireTools.resolve("@electron/asar");
const asar = requireTools(asarPath);
const archive = join(source, "resources/app.asar");
const manifest = JSON.parse(asar.extractFile(archive, "package.json").toString());
const version = JSON.parse(readFileSync(join(root, "packages/cli/package.json"), "utf8")).version;
const updateConfig = readUpdateConfig({
  version,
  configFile: values["update-config"],
  publicKeyFile:
    values["update-public-key"] ??
    (!values["update-config"] ? join(directory, "update-public-key.pem") : undefined),
});
const dshVersion = "0.2.1-rc.2";
if (manifest.version !== dshVersion || manifest.main !== "lib/main.js")
  throw new Error(`输入必须是 DSH ${dshVersion} 官方 Windows 桌面包`);
const appDir = join(output, "win-unpacked");
cpSync(source, appDir, { recursive: true });
const resources = join(appDir, "resources");
const payload = join(resources, "kaitu");
await writePayload({ payload, archive, asar, payloadVersion: version, dshVersion });
cpSync(join(directory, "payload-loader.mjs"), join(resources, "kaitu-loader.mjs"));
if (updateConfig) writeFileSync(join(resources, "kaitu-update.json"), JSON.stringify(updateConfig));
rmSync(join(resources, "app-update.yml"), { force: true });

const changes = new Map();
for (const path of asar.listPackage(archive)) {
  const name = path.replaceAll("\\", "/").replace(/^\//, "");
  if (!/^(lib|renderer)\/.*\.(js|cjs|html|css|json)$/.test(name)) continue;
  const text = asar.extractFile(archive, join(name)).toString();
  if (text.includes("DeepSeek Harness"))
    changes.set(name, Buffer.from(text.replaceAll("DeepSeek Harness", "人生开图")));
}
let main = withProductCopyright(changes.get("lib/main.js").toString());
const hostReady = "hostUrl = ready.url;";
if (main.split(hostReady).length !== 2) throw new Error("宿主就绪结构已变化，请核对固定 DSH 构建");
main = main.replace(hostReady, `${hostReady}\napp.emit("kaitu:host-ready", ready.url);`);
if (!main.includes("function quitWithoutConfirmation()")) throw new Error("DSH 退出入口已变化");
changes.set(
  "lib/main.js",
  Buffer.from(
    `${main.replace("app.setAppLogsPath();", 'app.setAppLogsPath(join(process.env.DSH_HOME, "logs"));')}\napp.on("kaitu:quit", quitWithoutConfirmation);\n`,
  ),
);
changes.set("kaitu-bootstrap.mjs", readFileSync(join(directory, "bootstrap.mjs")));
changes.set("kaitu-environment.mjs", readFileSync(join(directory, "environment.mjs")));
const packaged = {
  ...manifest,
  productName: "人生开图",
  dshDesktopAppId: "ai.kaitu.app",
  main: "kaitu-bootstrap.mjs",
};
packaged.dshMandatoryUpdatePolicy = undefined;
changes.set("package.json", Buffer.from(`${JSON.stringify(packaged, null, 2)}\n`));
const temporary = join(output, "repack");
mkdirSync(temporary);
const rebuilt = join(temporary, "app.asar");
await rewriteArchive({ destination: rebuilt, archive, asar, asarPath, changes });
asar.uncache(rebuilt);
for (const [name, expected] of changes) {
  if (!asar.extractFile(rebuilt, join(name)).equals(expected)) throw new Error(`ASAR 校验失败：${name}`);
}
for (const path of asar.listPackage(archive)) {
  const name = path.replace(/^[/\\]/, "");
  if (
    Boolean(asar.statFile(archive, name, false).unpacked) !==
    Boolean(asar.statFile(rebuilt, name, false).unpacked)
  )
    throw new Error(`ASAR 原生文件解包状态不一致：${name}`);
}
cpSync(rebuilt, join(resources, "app.asar"));
cpSync(`${rebuilt}.unpacked`, join(resources, "app.asar.unpacked"), { recursive: true });
rmSync(temporary, { recursive: true });

// Windows ICO accepts PNG image entries. Use the same product mark as the Mac app.
const sharp = requireTools("sharp");
const mark = readFileSync(join(root, "docs/design/kaitu-mark.svg"), "utf8")
  .replace(/<svg[^>]*>/, "")
  .replace("</svg>", "");
const png = await sharp(
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect x="16" y="16" width="224" height="224" rx="56" fill="#FCFCFB"/><g transform="translate(43 43) scale(3.55)">${mark}</g></svg>`,
  ),
)
  .png()
  .toBuffer();
writeFileSync(join(resources, "icon.png"), png);
const header = Buffer.alloc(22);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(1, 4);
header.writeUInt16LE(1, 10);
header.writeUInt16LE(32, 12);
header.writeUInt32LE(png.length, 14);
header.writeUInt32LE(22, 18);
const icon = join(resources, "Kaitu.ico");
writeFileSync(icon, Buffer.concat([header, png]));
// DSH's Windows tray and quit dialog read this separate resource at runtime.
cpSync(icon, join(resources, "tray.ico"));
const exe = join(appDir, "Kaitu.exe");
renameSync(join(appDir, "DeepSeek Harness.exe"), exe);
await requireTools("rcedit")(exe, {
  icon,
  "version-string": {
    ProductName: "人生开图",
    FileDescription: "人生开图",
    CompanyName: "Kaitu",
    LegalCopyright: productCopyright,
    OriginalFilename: "Kaitu.exe",
    ProductVersion: version,
  },
  "file-version": version.split("-")[0],
  "product-version": version.split("-")[0],
});
writeFileSync(
  join(output, "build.json"),
  JSON.stringify(
    { version, dshVersion, platform: "win32", arch: "x64", signed: false, revision: values.revision },
    null,
    2,
  ),
);
if (!values.dir) {
  const projectDir = join(output, "installer-project");
  mkdirSync(projectDir);
  writeFileSync(
    join(projectDir, "package.json"),
    JSON.stringify({
      name: "rensheng-kaitu",
      version,
      description: "人生开图",
      author: "Kaitu",
      license: "MIT",
      main: "kaitu-bootstrap.mjs",
    }),
  );
  const { build, Platform, Arch } = requireTools("electron-builder");
  await build({
    projectDir,
    prepackaged: appDir,
    targets: Platform.WINDOWS.createTarget(["nsis"], Arch.x64),
    publish: "never",
    config: {
      appId: "ai.kaitu.app",
      productName: "人生开图",
      copyright: productCopyright,
      artifactName: values.revision
        ? `Kaitu-Setup-\${version}-windows.${values.revision}-x64.\${ext}`
        : "Kaitu-Setup-${version}-x64.${ext}",
      directories: { output },
      publish: null,
      electronVersion: readFileSync(join(appDir, "version"), "utf8").trim(),
      win: { icon, executableName: "Kaitu", signAndEditExecutable: false },
      nsis: {
        oneClick: true,
        perMachine: false,
        allowElevation: false,
        runAfterFinish: true,
        deleteAppDataOnUninstall: false,
        shortcutName: "人生开图",
        installerIcon: icon,
        uninstallerIcon: icon,
        installerLanguages: ["zh_CN", "en_US"],
      },
    },
  });
}
console.log(`Windows ${version} 已生成：${output}`);
