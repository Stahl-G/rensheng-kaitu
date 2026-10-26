import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderDshPatch } from "../cli/dist/dsh.js";
import { desktopPaths } from "./environment.mjs";

// 构建后位于 Resources/kaitu/dist/initialize.mjs，只在应用启动时写入本机状态。
// 不碰资料文件夹：它可能在云盘里，打开和新建都放到窗口出来以后（local.mjs）。
const resources = dirname(dirname(fileURLToPath(import.meta.url)));
const { state, workspace, port } = desktopPaths();
const profile = join(state, "profiles/desktop");
mkdirSync(profile, { recursive: true, mode: 0o700 });
const patch = join(profile, "cordis.patch.yml");
const before = existsSync(patch) ? readFileSync(patch, "utf8") : "[]\n";
const plugin = join(resources, "dist/index.js");
let after = renderDshPatch(before, { home: state, workspace, plugin, standalone: true });
// DSH 桌面版固定监听 19387；Kaitu 换一个端口，才能和已安装的 DeepSeek Harness 同时运行。
// 只在用户没自己配置 webserver 时加，配置与 DSH bundle 默认值一致，仅端口不同。
if (!/["\s]id["]?\s*:\s*["']?webserver\b/.test(after)) {
  const config = {
    host: "127.0.0.1",
    port,
    compression: "gzip",
    compressionLevel: 1,
    compressionThresholdBytes: 1024,
  };
  const flowArray = /^((?:\s*#[^\n]*(?:\n|$))*\s*)\[/;
  after = flowArray.test(after)
    ? after.replace(flowArray, `$1[\n${JSON.stringify({ id: "webserver", config })},`)
    : `- id: webserver\n  config: ${JSON.stringify(config)}\n${after}`;
}
if (after !== before) {
  const temporary = `${patch}.${process.pid}.tmp`;
  writeFileSync(temporary, after, { mode: 0o600 });
  renameSync(temporary, patch);
}
