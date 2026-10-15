import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderDshPatch } from "../cli/dist/dsh.js";
import { initWorkspace } from "../core/dist/index.js";

// 构建后位于 Resources/kaitu/dist/initialize.mjs，只在应用启动时写入本机状态。
const resources = dirname(dirname(fileURLToPath(import.meta.url)));
const home = homedir();
const state = join(home, ".kaitu-app");
const pointer = join(home, "Library/Application Support/kaitu/current-workspace.json");
let workspace = join(home, "kaitu");
if (existsSync(pointer)) {
  const root = JSON.parse(readFileSync(pointer, "utf8")).root;
  if (typeof root === "string" && existsSync(join(root, ".kaitu/config.json"))) workspace = root;
}
if (!existsSync(join(workspace, ".kaitu/config.json"))) {
  await initWorkspace(workspace, { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone });
}
const profile = join(state, "profiles/desktop");
mkdirSync(profile, { recursive: true, mode: 0o700 });
const patch = join(profile, "cordis.patch.yml");
const before = existsSync(patch) ? readFileSync(patch, "utf8") : "[]\n";
const plugin = join(resources, "dist/index.js");
let after = renderDshPatch(before, { home: state, workspace, plugin });
// DSH 桌面版固定监听 19387；Kaitu 换一个端口，才能和已安装的 DeepSeek Harness 同时运行。
// 只在用户没自己配置 webserver 时加，配置与 DSH bundle 默认值一致，仅端口不同。
if (!/["\s]id["]?\s*:\s*["']?webserver\b/.test(after)) {
  const config = {
    host: "127.0.0.1",
    port: 19487,
    compression: "gzip",
    compressionLevel: 1,
    compressionThresholdBytes: 1024,
  };
  after = after.trimStart().startsWith("[")
    ? after.replace("[", `[\n${JSON.stringify({ id: "webserver", config })},`)
    : `- id: webserver\n  config: ${JSON.stringify(config)}\n${after}`;
}
if (after !== before) {
  const temporary = `${patch}.${process.pid}.tmp`;
  writeFileSync(temporary, after, { mode: 0o600 });
  renameSync(temporary, patch);
}
