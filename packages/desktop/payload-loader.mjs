// This loader ships with the signed host, never in an independently updated payload.
import {
  existsSync,
  readFileSync,
  readlinkSync,
  renameSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const HOST_API = 1;
export const DSH_VERSION = "0.2.1-rc.2";

export function updateRoot(state) {
  return join(state, "updates", `dsh-${DSH_VERSION}-host-${HOST_API}`);
}

export function selection(state) {
  const file = join(updateRoot(state), "active.json");
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : { current: null, previous: null };
}

export function activate(state, current, previous) {
  const file = join(updateRoot(state), "active.json");
  writeFileSync(`${file}.tmp`, JSON.stringify({ current, previous }), { mode: 0o600 });
  renameSync(`${file}.tmp`, file);
}

export function selectPayload(state, resources) {
  const version = selection(state).current;
  if (version === null) return join(resources, "kaitu");
  if (typeof version !== "string" || !/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(version))
    throw new Error("开图功能包版本无效");
  const payload = join(updateRoot(state), version);
  const metadata = JSON.parse(readFileSync(join(payload, "payload.json"), "utf8"));
  if (metadata.version !== version || metadata.dshVersion !== DSH_VERSION || metadata.hostApi !== HOST_API)
    throw new Error("开图功能包与当前内核不兼容");
  const modules = join(payload, "node_modules");
  const bundledModules = join(resources, "kaitu/node_modules");
  if (readlinkSync(modules) !== bundledModules) {
    unlinkSync(modules);
    symlinkSync(bundledModules, modules, process.platform === "win32" ? "junction" : "dir");
  }
  return payload;
}

export function rollback(state) {
  const { current, previous } = selection(state);
  if (current === null) throw new Error("已经在使用随应用安装的版本");
  activate(state, previous, null);
}

// The native launcher runs this before Electron starts; initialize the selected payload too.
if (process.env.ELECTRON_RUN_AS_NODE === "1" && process.argv[1] === fileURLToPath(import.meta.url)) {
  const state = process.env.KAITU_APP_HOME || join(homedir(), ".kaitu-app");
  const resources = dirname(fileURLToPath(import.meta.url));
  process.env.KAITU_HOST_RESOURCES = resources;
  try {
    const payload =
      process.env.KAITU_EMBEDDED_AI === "1" && process.env.KAITU_PARENT_PAYLOAD
        ? process.env.KAITU_PARENT_PAYLOAD
        : selectPayload(state, resources);
    await import(pathToFileURL(join(payload, "dist/initialize.mjs")).href);
  } catch (error) {
    // Let the fixed Electron bootstrap present recovery instead of silently failing in the launcher.
    console.error("Kaitu initialization:", error);
  }
}
