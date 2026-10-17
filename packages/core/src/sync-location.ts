import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

import { stateBinding } from "./state-binding.js";

export type SyncMode = "local" | "icloud" | "drive";
/**
 * 资料文件夹由谁同步。只影响显示、默认目录和冲突副本识别；
 * 除 iCloud 外都按「同步文件夹」处理：资料在同步盘，版本库、密钥和索引留在本机。
 */
export const syncProviders = ["local", "icloud", "google-drive", "nutstore", "folder"] as const;
export type SyncProvider = (typeof syncProviders)[number];

export function iCloudDirectory(home = process.env.HOME || homedir()): string {
  return join(home, "Library/Mobile Documents/com~apple~CloudDocs");
}

/** 坚果云桌面端可能的同步目录（未真机核对，见 HANDOFF §6）；坚果云也能同步任意文件夹，找不到时由用户指定。 */
export function nutstoreDirectory(home = process.env.HOME || homedir()): string | null {
  for (const name of ["Nutstore Files/我的坚果云", "Nutstore Files", "我的坚果云", "坚果云", "Nutstore"]) {
    const path = join(home, name);
    try {
      if (statSync(path).isDirectory()) return path;
    } catch {}
  }
  return null;
}

const isNutstorePath = (root: string) => /(^|[\\/])(Nutstore( Files)?|我的坚果云|坚果云)([\\/]|$)/.test(root);

/** 优先读开启同步时记下的选择，其次按路径识别。 */
export function syncProvider(root: string, mode: SyncMode, state?: string): SyncProvider {
  if (mode === "local") return "local";
  if (mode === "icloud") return "icloud";
  if (state) {
    try {
      const marker = JSON.parse(readFileSync(join(state, "sync-location.json"), "utf8")) as {
        provider?: unknown;
      };
      if (syncProviders.includes(marker.provider as SyncProvider)) return marker.provider as SyncProvider;
    } catch {}
  }
  return folderProvider(root);
}

/** 只按路径判断同步盘：坚果云目录、Google Drive 目录，其他算普通同步文件夹。 */
export function folderProvider(path: string): "nutstore" | "google-drive" | "folder" {
  if (isNutstorePath(path)) return "nutstore";
  return path
    .split(/[\\/]/)
    .some((part) => /^(?:GoogleDrive(?:-|$)|My Drive$|我的云端硬盘$|我的雲端硬碟$)/i.test(part))
    ? "google-drive"
    : "folder";
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
