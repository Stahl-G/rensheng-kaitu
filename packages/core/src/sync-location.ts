import { existsSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { readWorkspaceConfig } from "./sync-files.js";

export type SyncMode = "local" | "icloud" | "drive";

export function iCloudDirectory(home = process.env.HOME || homedir()): string {
  return join(home, "Library/Mobile Documents/com~apple~CloudDocs");
}

function real(path: string): string {
  return existsSync(path) ? realpathSync(path) : resolve(path);
}

export function syncMode(root: string, home = process.env.HOME || homedir()): SyncMode {
  const { state_dir: state } = readWorkspaceConfig(root);
  if (!state) return "local";
  const path = real(root);
  const cloud = real(iCloudDirectory(home));
  const rel = relative(cloud, path);
  if (rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))) return "icloud";
  const drive = relative(real(join(home, "Library/CloudStorage")), path).split(sep);
  if (drive[0]?.startsWith("GoogleDrive-") && drive.length > 1) return "drive";
  const marker = join(String(state), "sync-location.json");
  if (existsSync(marker)) {
    const { mode } = JSON.parse(readFileSync(marker, "utf8"));
    if (mode === "icloud" || mode === "drive") return mode;
  }
  return "drive";
}
