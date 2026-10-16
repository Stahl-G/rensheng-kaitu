import { randomBytes } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { currentWorkspace, localStateRoot } from "./drive.js";
import { KaituError, ScopeError } from "./errors.js";
import { parseFrontmatter } from "./frontmatter.js";
import { maintainHistoryIgnore } from "./history.js";
import { overviewDeferred, refreshOverview } from "./overview.js";
import {
  cloudPlaceholder,
  conflictOriginal,
  isEvictedICloudFile,
  placeholderOriginal as placeholderName,
  readWorkspaceConfig,
  syncInventory,
} from "./sync-files.js";
import { isICloudPath } from "./sync-location.js";
import { ensureTaskModule } from "./tasks.js";
import { assertTimeZone } from "./time.js";

export const STATE_DIR = ".kaitu";

/** 默认数据目录：--dir > KAITU_DIR > ~/kaitu */
export function defaultRoot(env: NodeJS.ProcessEnv = process.env): string {
  return resolve(env.KAITU_DIR || currentWorkspace(env) || join(env.HOME || homedir(), "kaitu"));
}

export function stateDirectory(root: string, icloud?: boolean): string {
  const state = readWorkspaceConfig(root, icloud).state_dir;
  if (state !== undefined && (typeof state !== "string" || !isAbsolute(state))) {
    throw new KaituError("state_dir 必须是本机绝对路径", "INVALID_STATE_DIR");
  }
  if (state && !existsSync(state)) return join(localStateRoot(), basename(state));
  return state ?? join(root, STATE_DIR);
}

export function migrateHistory(root: string, icloud?: boolean): void {
  const old = join(root, ".git");
  const target = join(stateDirectory(root, icloud), "history.git");
  if (!existsSync(join(root, STATE_DIR, "config.json")) || !existsSync(old)) return;
  if (existsSync(target)) {
    throw new KaituError(`发现两个版本库，请先核对 ${old} 与 ${target}，未改动历史`, "HISTORY_MIGRATION");
  }
  try {
    mkdirSync(dirname(target), { recursive: true });
    renameSync(old, target);
  } catch (error) {
    throw new KaituError(
      `无法把版本历史从 ${old} 迁移到 ${target}：${(error as Error).message}`,
      "HISTORY_MIGRATION",
    );
  }
}

function isSymlink(p: string): boolean {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

function isInside(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

/**
 * 工作区：所有读写都经过这里，保证不会写出 root。
 * `.kaitu/` 只允许程序内部通过 { internal: true } 写入。
 */
export class Workspace {
  private location = "";
  private icloud = false;
  private unread = new Set<string>();

  get isICloud(): boolean {
    return this.icloud;
  }

  get root(): string {
    return this.location;
  }

  set root(value: string) {
    this.location = value;
    this.icloud = isICloudPath(value);
    this.unread.clear();
  }

  constructor(root: string, options: { maintain?: boolean } = {}) {
    this.root = resolve(root);
    if (options.maintain === false) return;
    try {
      const state = stateDirectory(this.root, this.icloud);
      if (state !== join(this.root, STATE_DIR) && !existsSync(state)) {
        mkdirSync(state, { recursive: true });
        writeFileSync(join(state, "secrets.json"), "{}\n", { mode: 0o600 });
      }
      migrateHistory(this.root, this.icloud);
    } catch (error) {
      if (!(error instanceof KaituError) || error.code !== "CLOUD_UNAVAILABLE") throw error;
      return;
    }
    if (this.exists(".kaitu/config.json")) {
      for (const maintain of [ensureTaskModule, maintainHistoryIgnore, refreshOverview]) {
        try {
          maintain(this);
        } catch (error) {
          if (!(error instanceof KaituError) || error.code !== "CLOUD_UNAVAILABLE") throw error;
        }
      }
    }
  }

  /** 把相对路径解析为绝对路径，并检查是否在工作区内（含符号链接逃逸）。 */
  resolve(rel: string, opts: { internal?: boolean } = {}): string {
    if (isAbsolute(rel)) throw new ScopeError(`只接受工作区内的相对路径：${rel}`);
    const abs = resolve(this.root, rel);
    if (!isInside(this.root, abs)) throw new ScopeError(`路径超出工作区：${rel}`);
    const top = relative(this.root, abs).split(sep)[0];
    if (top === STATE_DIR && !opts.internal) throw new ScopeError(`.kaitu/ 由程序管理，不能直接写入：${rel}`);
    if (top === ".git") throw new ScopeError(`不能写入版本库目录：${rel}`);
    this.assertNoSymlinkEscape(abs);
    if (
      top === STATE_DIR &&
      abs !== join(this.root, STATE_DIR) &&
      relative(this.root, abs) !== join(STATE_DIR, "config.json")
    ) {
      const state = stateDirectory(this.root, this.icloud);
      const target = resolve(state, relative(join(this.root, STATE_DIR), abs));
      this.assertNoSymlinkEscapeAt(state, target);
      return target;
    }
    return abs;
  }

  /** 从目标向上找到第一个已存在的路径，确认其真实位置仍在工作区内。 */
  private assertNoSymlinkEscape(abs: string): void {
    this.assertNoSymlinkEscapeAt(this.root, abs);
  }

  private assertNoSymlinkEscapeAt(root: string, abs: string): void {
    if (!existsSync(root)) return;
    const realRoot = realpathSync(root);
    let probe = abs;
    while (!existsSync(probe) && !isSymlink(probe)) {
      const parent = dirname(probe);
      if (parent === probe) return;
      probe = parent;
    }
    const real = isSymlink(probe) && !existsSync(probe) ? null : realpathSync(probe);
    if (real === null || !isInside(realRoot, real)) {
      throw new ScopeError(`路径经符号链接指向工作区外：${relative(this.root, abs)}`);
    }
  }

  exists(rel: string): boolean {
    return (
      existsSync(this.resolve(rel, { internal: true })) || (this.icloud && cloudPlaceholder(this.root, rel))
    );
  }

  readBytes(rel: string): Buffer {
    const abs = this.resolve(rel, { internal: true });
    if (this.isUnavailable(rel)) throw new KaituError(`还没从 iCloud 下载：${rel}`, "CLOUD_UNAVAILABLE");
    return readFileSync(abs);
  }

  readText(rel: string): string {
    return this.readBytes(rel).toString("utf8");
  }

  conflictCopy(rel: string): boolean {
    let path = rel;
    while (path !== ".") {
      if (conflictOriginal(this.root, path)) return true;
      const parent = dirname(path);
      if (parent === path) break;
      path = parent;
    }
    return false;
  }

  scanText(rel: string): string | undefined {
    if (this.conflictCopy(rel) || placeholderName(rel)) return;
    try {
      return this.readText(rel);
    } catch (error) {
      if (!(error instanceof KaituError) || error.code !== "CLOUD_UNAVAILABLE") throw error;
      return;
    }
  }

  isUnavailable(rel: string): boolean {
    if (!this.icloud || (rel.startsWith(".kaitu/") && rel !== ".kaitu/config.json")) return false;
    const pending = isEvictedICloudFile(this.resolve(rel, { internal: true }));
    if (pending) this.unread.add(rel);
    else this.unread.delete(rel);
    return pending;
  }

  pendingDownloads(): string[] {
    return [...this.unread].filter((file) => this.isUnavailable(file));
  }

  unavailableFiles(prefix = ""): string[] {
    if (!this.icloud) return [];
    const absolute = resolve(this.root, prefix);
    if (isAbsolute(prefix) || !isInside(this.root, absolute))
      throw new ScopeError(`路径超出工作区：${prefix}`);
    this.assertNoSymlinkEscape(absolute);
    const scope = relative(this.root, absolute);
    if (scope === ".kaitu" || scope.startsWith(".kaitu/"))
      return (scope === ".kaitu" || scope === ".kaitu/config.json") &&
        this.isUnavailable(".kaitu/config.json")
        ? [".kaitu/config.json"]
        : [];
    const unavailable = syncInventory(this.root, scope, true).unavailable;
    if (!scope && this.isUnavailable(".kaitu/config.json")) unavailable.push(".kaitu/config.json");
    return [...new Set(unavailable)].sort();
  }

  assertDownloaded(prefix = ""): void {
    const unavailable = this.unavailableFiles(prefix);
    if (unavailable.length)
      throw new KaituError(`还没从 iCloud 下载：${unavailable.join("、")}`, "CLOUD_UNAVAILABLE");
  }

  private protectWrite(rel: string): void {
    if (this.isUnavailable(rel)) throw new KaituError(`还没从 iCloud 下载：${rel}`, "CLOUD_UNAVAILABLE");
  }

  readJson<T = unknown>(rel: string): T {
    return JSON.parse(this.readText(rel)) as T;
  }

  /** 原子写入：先写临时文件再改名。 */
  writeText(
    rel: string,
    content: string | Uint8Array,
    opts: { internal?: boolean; mode?: number } = {},
  ): void {
    const abs = this.resolve(rel, opts);
    this.protectWrite(rel);
    mkdirSync(dirname(abs), { recursive: true });
    const tmp = `${abs}.${randomBytes(4).toString("hex")}.tmp`;
    writeFileSync(tmp, content, { mode: opts.mode ?? 0o644 });
    renameSync(tmp, abs);
    this.refreshAfterWrite(rel);
  }

  writeJson(rel: string, value: unknown, opts: { internal?: boolean; mode?: number } = {}): void {
    this.writeText(rel, `${JSON.stringify(value, null, 2)}\n`, opts);
  }

  appendLine(rel: string, line: string): void {
    const abs = this.resolve(rel);
    this.protectWrite(rel);
    mkdirSync(dirname(abs), { recursive: true });
    appendFileSync(abs, `${line}\n`);
    this.refreshAfterWrite(rel);
  }

  private refreshAfterWrite(rel: string): void {
    if (
      overviewDeferred(this) ||
      rel.startsWith(".kaitu/") ||
      ["AGENT-README.md", "ORGANIZER.md", "OVERVIEW.md"].includes(rel) ||
      !this.exists("OVERVIEW.md")
    )
      return;
    refreshOverview(this);
  }

  /** 用户时区：me/rules.md 的 timezone，缺省用系统时区。 */
  timeZone(): string {
    if (this.exists("me/rules.md")) {
      const tz = parseFrontmatter<{ timezone?: unknown }>(this.readText("me/rules.md")).data.timezone;
      if (typeof tz === "string" && tz) {
        assertTimeZone(tz);
        return tz;
      }
    }
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  }
}
