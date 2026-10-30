import { randomBytes } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { quarantineBankNotes } from "./bank-mail.js";
import { currentWorkspace } from "./drive.js";
import { KaituError, ScopeError } from "./errors.js";
import { parseFrontmatter } from "./frontmatter.js";
import { ownsLegacyHistory } from "./history-ownership.js";
import { invalidateHistoryFile, maintainHistoryIgnore } from "./history.js";
import { invalidateNoteIndex } from "./note-search.js";
import { holdOverview, refreshOverview } from "./overview.js";
import { migrateWorkspaceState, stateBinding } from "./state-binding.js";
import {
  cloudPlaceholder,
  conflictOriginal,
  isEvictedICloudFile,
  isUserProfile,
  placeholderOriginal as placeholderName,
  syncInventory,
} from "./sync-files.js";
import { isICloudPath } from "./sync-location.js";
import { ensureTaskModule } from "./tasks.js";
import { assertTimeZone } from "./time.js";

export type WorkspaceWrite = <T>(operation: () => Promise<T>) => Promise<T>;

export const STATE_DIR = ".kaitu";

/** 默认数据目录：--dir > KAITU_DIR > 当前工作区 > 已有的 ~/kaitu（含搬去云盘后留下的迁移说明）> ~/kaitu-ai-memory */
export function defaultRoot(env: NodeJS.ProcessEnv = process.env): string {
  const home = env.HOME || homedir();
  const legacy = join(home, "kaitu");
  return resolve(
    env.KAITU_DIR || currentWorkspace(env) || (existsSync(legacy) ? legacy : join(home, "kaitu-ai-memory")),
  );
}

export function stateDirectory(root: string, icloud?: boolean): string {
  return stateBinding(root, icloud).state;
}

export function migrateHistory(root: string, icloud?: boolean): void {
  const old = join(root, ".git");
  const target = join(stateDirectory(root, icloud), "history.git");
  if (!existsSync(join(root, STATE_DIR, "config.json")) || !existsSync(old)) return;
  if (!ownsLegacyHistory(old)) return;
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
  // iCloud 与 Google Drive 都可能只留占位文件；同步读占位文件会等云盘下载，卡住主进程。
  private cloud = false;
  private unread = new Set<string>();
  /** 按文件状态缓存的解析结果，见 scanParsed。 */
  private parsed = new Map<string, { stamp: string; text: string; values: Map<string, unknown> }>();
  private zone: { stamp: string; timeZone: string } | null = null;

  get isICloud(): boolean {
    return this.icloud;
  }

  get root(): string {
    return this.location;
  }

  set root(value: string) {
    this.location = value;
    const mode = stateBinding(value).mode;
    this.icloud = isICloudPath(value) || mode === "icloud";
    this.cloud = this.icloud || mode === "drive";
    this.unread.clear();
    this.parsed.clear();
    this.zone = null;
  }

  constructor(root: string, options: { maintain?: boolean; deferOverview?: boolean } = {}) {
    this.root = resolve(root);
    if (options.deferOverview) holdOverview(this);
    if (options.maintain === false) return;
    try {
      const state = stateDirectory(this.root, this.icloud);
      migrateWorkspaceState(this.root);
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
      for (const maintain of [
        ensureTaskModule,
        quarantineBankNotes,
        maintainHistoryIgnore,
        ...(options.deferOverview ? [] : [refreshOverview]),
      ]) {
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
    const parts = relative(this.root, abs).split(sep);
    const top = parts[0];
    if (parts.includes(STATE_DIR) && !opts.internal)
      throw new ScopeError(`.kaitu/ 由程序管理，不能直接写入：${rel}`);
    if (parts.includes(".git")) throw new ScopeError(`不能写入版本库目录：${rel}`);
    if (
      top === STATE_DIR &&
      abs !== join(this.root, STATE_DIR) &&
      relative(this.root, abs) !== join(STATE_DIR, "config.json")
    ) {
      const state = stateDirectory(this.root, this.icloud);
      return resolve(state, relative(join(this.root, STATE_DIR), abs));
    }
    return abs;
  }

  exists(rel: string): boolean {
    return (
      existsSync(this.resolve(rel, { internal: true })) || (this.icloud && cloudPlaceholder(this.root, rel))
    );
  }

  readBytes(rel: string): Buffer {
    const abs = this.resolve(rel, { internal: true });
    if (this.isUnavailable(rel)) throw new KaituError(`还没从云盘下载：${rel}`, "CLOUD_UNAVAILABLE");
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

  /**
   * 文件状态指纹：改名替换、追加或原地改写后都会变；不是普通文件或读不到时为 null。
   * 刚改过（2 秒内）的文件也返回 null：时间戳精度低的文件系统上，紧接着的同长度原地改写可能不改变状态。
   */
  private stableStamp(rel: string): string | null {
    try {
      const stat = statSync(this.resolve(rel, { internal: true }));
      if (!stat.isFile() || Date.now() - stat.mtimeMs < 2000) return null;
      return `${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
    } catch {
      return null;
    }
  }

  /**
   * 读文件并解析；文件没变时直接用上次的结果，不再读和解析。跳过的文件与 scanText 相同。
   * 结果会被之后的请求共用，调用方不能修改（解析函数可以冻结它）。解析出错不缓存，下次照样报错。
   */
  scanParsed<T>(
    rel: string,
    kind: string,
    parse:
      | ((text: string) => T)
      | { read: (text: string, read: <V>(kind: string, parse: (text: string) => V) => V) => T },
  ): T | undefined {
    if (this.conflictCopy(rel) || placeholderName(rel)) return;
    const stamp = this.stableStamp(rel);
    const previous = this.parsed.get(rel);
    const hit = stamp && previous?.stamp === stamp ? previous : undefined;
    if (hit?.values.has(kind)) return hit.values.get(kind) as T;
    // Different projections may parse the same document, but share its unchanged source text.
    const text = hit?.text ?? this.scanText(rel);
    if (text === undefined) {
      this.parsed.delete(rel);
      return;
    }
    const values = hit?.values ?? new Map<string, unknown>();
    // A derived view can reuse an intermediate parse of this exact source text.
    const read = <V>(kind: string, parse: (text: string) => V): V => {
      if (values.has(kind)) return values.get(kind) as V;
      const value = parse(text);
      values.set(kind, value);
      return value;
    };
    const value = read(kind, (text) => (typeof parse === "function" ? parse(text) : parse.read(text, read)));
    if (stamp) {
      this.parsed.set(rel, { stamp, text, values });
    } else this.parsed.delete(rel);
    return value;
  }

  isUnavailable(rel: string): boolean {
    if (!this.cloud || (rel.startsWith(".kaitu/") && rel !== ".kaitu/config.json")) return false;
    const pending = isEvictedICloudFile(this.resolve(rel, { internal: true }));
    if (pending) this.unread.add(rel);
    else this.unread.delete(rel);
    return pending;
  }

  pendingDownloads(): string[] {
    return [...this.unread].filter((file) => !isUserProfile(file) && this.isUnavailable(file));
  }

  unavailableFiles(prefix = ""): string[] {
    if (!this.cloud) return [];
    const absolute = resolve(this.root, prefix);
    if (isAbsolute(prefix) || !isInside(this.root, absolute))
      throw new ScopeError(`路径超出工作区：${prefix}`);
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
      throw new KaituError(`还没从云盘下载：${unavailable.join("、")}`, "CLOUD_UNAVAILABLE");
  }

  private protectWrite(rel: string): void {
    if (this.isUnavailable(rel)) throw new KaituError(`还没从云盘下载：${rel}`, "CLOUD_UNAVAILABLE");
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
    invalidateNoteIndex(this, rel);
    invalidateHistoryFile(this, relative(this.root, abs).split(sep).join("/"));
  }

  writeJson(rel: string, value: unknown, opts: { internal?: boolean; mode?: number } = {}): void {
    this.writeText(rel, `${JSON.stringify(value, null, 2)}\n`, opts);
  }

  appendLine(rel: string, line: string): void {
    const abs = this.resolve(rel);
    this.protectWrite(rel);
    mkdirSync(dirname(abs), { recursive: true });
    appendFileSync(abs, `${line}\n`);
    invalidateNoteIndex(this, rel);
    invalidateHistoryFile(this, relative(this.root, abs).split(sep).join("/"));
  }

  /** 用户时区：me/rules.md 的 timezone，缺省用系统时区。rules.md 没变时不重新读取。 */
  timeZone(): string {
    if (this.exists("me/rules.md")) {
      const stamp = this.stableStamp("me/rules.md");
      if (stamp && this.zone?.stamp === stamp) return this.zone.timeZone;
      const tz = parseFrontmatter<{ timezone?: unknown }>(this.readText("me/rules.md")).data.timezone;
      if (typeof tz === "string" && tz) {
        assertTimeZone(tz);
        this.zone = stamp ? { stamp, timeZone: tz } : null;
        return tz;
      }
    }
    this.zone = null;
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  }
}
