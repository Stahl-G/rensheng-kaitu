import { existsSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

export type SyncMode = "local" | "icloud" | "drive";

export function iCloudDirectory(home = process.env.HOME || homedir()): string {
  return join(home, "Library/Mobile Documents/com~apple~CloudDocs");
}

function real(path: string): string {
  return existsSync(path) ? realpathSync(path) : resolve(path);
}

export function isICloudPath(root: string, home = process.env.HOME || homedir()): boolean {
  if (process.platform !== "darwin") return false;
  const rel = relative(real(iCloudDirectory(home)), real(root));
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

export function syncMode(root: string, home = process.env.HOME || homedir()): SyncMode {
  if (isICloudPath(root, home)) return "icloud";
  const config = join(root, ".kaitu/config.json");
  const state = existsSync(config) ? JSON.parse(readFileSync(config, "utf8")).state_dir : undefined;
  if (!state) return "local";
  const path = real(root);
  const drive = relative(real(join(home, "Library/CloudStorage")), path).split(sep);
  if (drive[0]?.startsWith("GoogleDrive-") && drive.length > 1) return "drive";
  const marker = join(String(state), "sync-location.json");
  if (existsSync(marker)) {
    const { mode } = JSON.parse(readFileSync(marker, "utf8"));
    if (mode === "icloud" || mode === "drive") return mode;
  }
  return "drive";
}
