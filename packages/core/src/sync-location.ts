import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

import { stateBinding } from "./state-binding.js";

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
  return stateBinding(root).mode;
}
