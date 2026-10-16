import childProcess from "node:child_process";
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { KaituError } from "./errors.js";
import { isICloudPath } from "./sync-location.js";

export function conflictOriginal(root: string, file: string): string | undefined {
  const name = basename(file);
  const original = name.replace(
    / (?:\d+|\(\d+\)|\(conflict(?:ed)?(?: copy)?[^)]*\)|\[conflict(?:ed)?(?: copy)?[^\]]*\])(?=(?:\.[^/]*)?$)/i,
    "",
  );
  if (original === name) return;
  const path = join(dirname(file), original);
  return existsSync(join(root, path)) || cloudPlaceholder(root, path) ? path : undefined;
}

function fileStat(path: string) {
  try {
    return lstatSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return;
  }
}

export function cloudPlaceholder(root: string, file: string): boolean {
  return !!fileStat(join(root, dirname(file), `.${basename(file)}.icloud`));
}

const downloads = new Map<string, number>();
let lastPruned = 0;

export function requestICloudDownload(path: string): void {
  const now = Date.now();
  const previous = downloads.get(path);
  if (previous !== undefined && now - previous < 30000) return;
  if (now - lastPruned >= 30000) {
    for (const [file, requested] of downloads) if (now - requested >= 30000) downloads.delete(file);
    lastPruned = now;
  }
  downloads.set(path, now);
  try {
    const child = childProcess.spawn("brctl", ["download", path], { detached: true, stdio: "ignore" });
    child.on("error", () => {});
    child.unref();
  } catch {}
}

export function isEvictedICloudFile(path: string): boolean {
  const stat = fileStat(path);
  const evicted =
    !!(stat?.isFile() && stat.size > 0 && stat.blocks === 0) ||
    cloudPlaceholder(dirname(path), basename(path));
  if (evicted) requestICloudDownload(path);
  return evicted;
}

export function assertCloudDownloaded(path: string): void {
  if (isEvictedICloudFile(path)) throw new KaituError(`还没从 iCloud 下载：${path}`, "CLOUD_UNAVAILABLE");
}

export function placeholderOriginal(file: string): string | undefined {
  const name = basename(file);
  if (!name.startsWith(".") || !name.endsWith(".icloud")) return;
  return join(dirname(file), name.slice(1, -7));
}

export function syncInventory(root: string, prefix = "", icloud = false) {
  const files: string[] = [];
  const conflicts: string[] = [];
  const unavailable: string[] = [];
  function walk(file: string) {
    const placeholder = placeholderOriginal(file);
    if (placeholder) {
      if (icloud && !conflictOriginal(root, placeholder) && isEvictedICloudFile(join(root, placeholder)))
        unavailable.push(placeholder);
      return;
    }
    if (file && conflictOriginal(root, file)) {
      conflicts.push(file);
      return;
    }
    if (icloud && isEvictedICloudFile(join(root, file))) {
      unavailable.push(file);
      return;
    }
    const stat = fileStat(join(root, file));
    if (!stat || stat.isSymbolicLink()) return;
    if (!stat.isDirectory()) {
      if (stat.isFile()) files.push(file);
      return;
    }
    for (const entry of readdirSync(join(root, file), { withFileTypes: true })) {
      if (entry.isSymbolicLink() || [".git", ".kaitu", "node_modules"].includes(entry.name)) continue;
      walk(file ? `${file}/${entry.name}` : entry.name);
    }
  }
  walk(prefix);
  return { files, conflicts, unavailable: [...new Set(unavailable)] };
}

export function readWorkspaceConfig(root: string, icloud = isICloudPath(root)): Record<string, unknown> {
  const path = join(root, ".kaitu/config.json");
  if (icloud) assertCloudDownloaded(path);
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {};
}
