import childProcess from "node:child_process";
import { type Dirent, existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { KaituError } from "./errors.js";

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

export function cloudPlaceholder(root: string, file: string): boolean {
  return existsSync(join(root, dirname(file), `.${basename(file)}.icloud`));
}

export function placeholderOriginal(file: string): string | undefined {
  const name = basename(file);
  if (!name.startsWith(".") || !name.endsWith(".icloud")) return;
  return join(dirname(file), name.slice(1, -7));
}

export function syncInventory(root: string) {
  const files: string[] = [];
  const conflicts: string[] = [];
  const unavailable: string[] = [];
  function walk(dir: string) {
    let entries: Dirent[];
    try {
      entries = readdirSync(join(root, dir), { withFileTypes: true });
    } catch {
      unavailable.push(dir);
      return;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink() || [".git", ".kaitu", "node_modules"].includes(entry.name)) continue;
      const file = dir ? `${dir}/${entry.name}` : entry.name;
      const placeholder = placeholderOriginal(file);
      if (placeholder) unavailable.push(placeholder);
      else if (conflictOriginal(root, file)) conflicts.push(file);
      else if (entry.isDirectory()) walk(file);
      else if (entry.isFile()) files.push(file);
    }
  }
  walk("");
  return { files, conflicts, unavailable };
}

const cache = new Map<string, { stamp: string; bytes?: Buffer; error?: KaituError; retryAt?: number }>();

export function cacheWrittenFile(path: string, content: string | Uint8Array): void {
  const bytes = Buffer.from(content);
  if (bytes.length > 1024 * 1024) return;
  const stat = lstatSync(path);
  if (cache.size > 256) cache.clear();
  cache.set(path, { stamp: `${stat.mtimeMs}:${stat.ctimeMs}:${stat.size}`, bytes });
}

export function readCloudFile(path: string): Buffer {
  let stamp = "";
  try {
    if (cloudPlaceholder(dirname(path), basename(path))) throw new Error("iCloud 占位文件");
    const stat = lstatSync(path);
    stamp = `${stat.mtimeMs}:${stat.ctimeMs}:${stat.size}`;
    const previous = cache.get(path);
    if (previous?.stamp === stamp) {
      if (previous.bytes) return previous.bytes;
      if (previous.error && Date.now() < (previous.retryAt ?? 0)) throw previous.error;
    }
    if (!stat.isFile()) throw new Error("不是普通文件");
    const bytes = childProcess.execFileSync("/bin/cat", [path], {
      timeout: 2000,
      maxBuffer: Number.MAX_SAFE_INTEGER,
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (cache.size > 256) cache.clear();
    if (bytes.length <= 1024 * 1024) cache.set(path, { stamp, bytes });
    return bytes;
  } catch (error) {
    if (error instanceof KaituError) throw error;
    const unavailable = new KaituError(`还没从 iCloud 下载：${path}`, "CLOUD_UNAVAILABLE");
    cache.set(path, { stamp, error: unavailable, retryAt: Date.now() + 5000 });
    throw unavailable;
  }
}

export function readWorkspaceConfig(root: string): Record<string, unknown> {
  const path = join(root, ".kaitu/config.json");
  if (!existsSync(path) && !cloudPlaceholder(root, ".kaitu/config.json")) return {};
  const text =
    process.platform === "darwin" ? readCloudFile(path).toString("utf8") : readFileSync(path, "utf8");
  return JSON.parse(text);
}
