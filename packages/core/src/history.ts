import fs from "node:fs";
import { basename, isAbsolute, join, relative, sep } from "node:path";
import git, { type TreeEntry } from "isomorphic-git";
import { quarantineBankContent } from "./bank-mail.js";
import { KaituError } from "./errors.js";
import { HISTORY_MARKER } from "./history-ownership.js";
import { batchOverview, refreshOverview } from "./overview.js";
import { isUserProfile, placeholderOriginal } from "./sync-files.js";
import { isoInZone } from "./time.js";
import type { Workspace } from "./workspace.js";

/** 永远不进版本历史的路径（.gitignore 之外再兜底一次）。 */
export const NEVER_TRACK = [
  "USER.md",
  ".kaitu/user-profile.json",
  ".kaitu/organizer.json",
  ".kaitu/feishu.json",
  "phone/",
  ".kaitu/phone-actions.json",
  ".kaitu/secrets.json",
  ".kaitu/bank-mail-archive/",
  ".kaitu/github-state.json",
  ".kaitu/workspace-backup.json",
  ".kaitu/backup-conflicts/",
  ".kaitu/dsh-setup.json",
  ".kaitu/automation.json",
  ".kaitu/calendar-subscriptions.json",
  ".kaitu/news-feedback.json",
  ".kaitu/ask-workspace.json",
  ".kaitu/index.sqlite",
  ".kaitu/cache/",
  ".kaitu/history.git/",
  ".kaitu/inbox-state.json",
  ".kaitu/finance-notifications.json",
  ".kaitu/channels/",
  "inbox/agents/",
  "inbox/health/",
  "inbox/rejected/",
];

export const GITIGNORE = `.kaitu/organizer.json
USER.md
.USER.md.icloud
.kaitu/user-profile.json
.kaitu/feishu.json
phone/
.kaitu/phone-actions.json
# 开图自动生成：以下内容不进版本历史
.kaitu/secrets.json
.kaitu/bank-mail-archive/
.kaitu/github-state.json
.kaitu/workspace-backup.json
.kaitu/backup-conflicts/
.kaitu/dsh-setup.json
.kaitu/automation.json
.kaitu/calendar-subscriptions.json
.kaitu/news-feedback.json
.kaitu/ask-workspace.json
.kaitu/index.sqlite
.kaitu/index.sqlite-*
.kaitu/cache/
.kaitu/history.git/
.kaitu/inbox-state.json
.kaitu/finance-notifications.json
.kaitu/channels/
inbox/agents/
inbox/health/
inbox/processed/**/*.health*.json
inbox/processed/**/*.zip
inbox/processed/**/*.xml
inbox/rejected/
*.tmp
.DS_Store
`;

const AUTHOR = { name: "开图", email: "kaitu@localhost" };
const failedSnapshots = new WeakSet<Workspace>();

/** 只反映实际失败；正常的空版本或排队保存不算失败。 */
export function historyNeedsRetry(ws: Workspace): boolean {
  return failedSnapshots.has(ws);
}

function neverTrack(path: string): boolean {
  return (
    isUserProfile(path) ||
    /^inbox\/processed\/.*(?:\.health[^/]*\.json|\.zip|\.xml)$/i.test(path) ||
    NEVER_TRACK.some((p) => (p.endsWith("/") ? path.startsWith(p) : path === p || path.startsWith(`${p}-`)))
  );
}

export function historyDirectory(ws: Workspace): string {
  return ws.resolve(".kaitu/history.git", { internal: true });
}

export function hasHistory(ws: Workspace): boolean {
  return fs.existsSync(historyDirectory(ws));
}

export async function ensureHistory(ws: Workspace): Promise<void> {
  if (!hasHistory(ws))
    await git.init({ fs, dir: ws.root, gitdir: historyDirectory(ws), defaultBranch: "main" });
  fs.writeFileSync(join(historyDirectory(ws), HISTORY_MARKER), "kaitu\n");
  maintainHistoryIgnore(ws);
}

/** 纯 Git 建的记忆仓库（根目录有 kaitu-backup.json）：根目录 .gitignore 属于用户推到 GitHub 的仓库。 */
export function userOwnsGitignore(ws: Workspace): boolean {
  return ws.exists("kaitu-backup.json");
}

export function historyExcludeFile(ws: Workspace): string {
  return join(historyDirectory(ws), "info", "exclude");
}

export function maintainHistoryIgnore(ws: Workspace): void {
  if (userOwnsGitignore(ws)) {
    // 手机快照和收件箱要随仓库推上去，开图版本历史的排除规则只写进版本库自己的 info/exclude。
    fs.mkdirSync(join(historyDirectory(ws), "info"), { recursive: true });
    fs.writeFileSync(historyExcludeFile(ws), GITIGNORE);
    return;
  }
  const ignore = ws.exists(".gitignore") ? ws.scanText(".gitignore") : "";
  if (ignore === undefined) return;
  const missing = GITIGNORE.split("\n").filter(
    (line) => line && !line.startsWith("#") && !ignore.split("\n").includes(line),
  );
  if (missing.length)
    ws.writeText(".gitignore", `${ignore}${ignore.endsWith("\n") ? "" : "\n"}${missing.join("\n")}\n`);
}

async function headOid(ws: Workspace): Promise<string | null> {
  try {
    return await git.resolveRef({ fs, dir: ws.root, gitdir: historyDirectory(ws), ref: "HEAD" });
  } catch {
    return null;
  }
}

const invalidated = new WeakMap<Workspace, Map<string, symbol>>();
const savedRoots = new WeakMap<Workspace, { root: string; oid: string | null }>();

/** 文件事件比 Git 索引的整秒 stat 更精确；只让这些路径重新读取内容。 */
export function invalidateHistoryFile(ws: Workspace, file: string): void {
  const files = invalidated.get(ws) ?? new Map<string, symbol>();
  files.set(file, Symbol());
  invalidated.set(ws, files);
}

function clearInvalidated(ws: Workspace, checked: ReadonlyMap<string, symbol>): void {
  const files = invalidated.get(ws);
  for (const [file, token] of checked) {
    if (files?.get(file) === token) files.delete(file);
  }
}

function historyFs(ws: Workspace, changed: ReadonlyMap<string, symbol> = new Map()) {
  if (!ws.isICloud && !changed.size) return fs;
  const gitdir = historyDirectory(ws);
  const readFile = (async (...[path, options]: Parameters<typeof fs.promises.readFile>) => {
    if (typeof path === "string") {
      const rel = relative(ws.root, path);
      if (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)) {
        const bytes = ws.readBytes(rel);
        const encoding = typeof options === "string" ? options : options?.encoding;
        return encoding ? bytes.toString(encoding) : bytes;
      }
    }
    return fs.promises.readFile(path, options);
  }) as typeof fs.promises.readFile;
  const lstat = (async (...args: Parameters<typeof fs.promises.lstat>) => {
    const stat = await fs.promises.lstat(...args);
    const path = String(args[0]);
    // 用户目录事件不能使 Git 自己的索引失效，否则每个工作区条目都会重读整份 index。
    if (path === gitdir || path.startsWith(`${gitdir}${sep}`)) return stat;
    const file = relative(ws.root, String(args[0])).split(sep).join("/");
    let affected = changed.has(file);
    for (
      let slash = file.lastIndexOf("/");
      !affected && slash >= 0;
      slash = file.lastIndexOf("/", slash - 1)
    ) {
      affected = changed.has(file.slice(0, slash));
    }
    if (stat.isFile() && affected) {
      // statusMatrix 没有按路径禁用 stat 缓存的接口。仅在只读盘点里令时间戳失配，
      // refresh:false 防止占位时间写入索引；git.add 仍使用真实文件状态。
      stat.mtimeMs = Number.NaN;
    }
    return stat;
  }) as typeof fs.promises.lstat;
  return { ...fs, promises: { ...fs.promises, ...(ws.isICloud ? { readFile } : {}), lstat } };
}

function snapshotFile(ws: Workspace, file: string): boolean {
  if (isUserProfile(file)) return false;
  return (!ws.isICloud || !placeholderOriginal(file)) && !ws.conflictCopy(file) && !ws.isUnavailable(file);
}

function pendingFiles(matrix: Awaited<ReturnType<typeof git.statusMatrix>>, includeInbox = false): string[] {
  return matrix
    .filter(
      ([file, head, workdir, stage]) =>
        file !== "OVERVIEW.md" &&
        (includeInbox || !file.startsWith("inbox/")) &&
        !neverTrack(file) &&
        !(head === 1 && workdir === 1 && stage === 1),
    )
    .map(([file]) => file);
}

/** 单文件 status 直接查路径；statusMatrix 即使限路径也会先读取相邻目录。 */
async function changedStatus(
  ws: Workspace,
  files: readonly string[],
  io: ReturnType<typeof historyFs>,
  cache: object,
): Promise<Awaited<ReturnType<typeof git.statusMatrix>> | undefined> {
  const gitdir = historyDirectory(ws);
  const tracked = await git.listFiles({ fs: io, dir: ws.root, gitdir, cache });
  const paths = [...new Set(files.filter((file) => !neverTrack(file)))];
  for (const file of paths) {
    // 目录创建/删除/替换沿用完整盘点，保留树与文件互换、符号链接的 Git 语义。
    if (tracked.some((path) => path.startsWith(`${file}/`))) return;
    try {
      const stat = await fs.promises.lstat(join(ws.root, file));
      if (!stat.isFile()) return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  const matrix: Awaited<ReturnType<typeof git.statusMatrix>> = [];
  // 索引已由 Git 读取；敏感路径仍全部移出，不能因缩小工作树查询而漏掉它们。
  for (const file of tracked) if (neverTrack(file)) matrix.push([file, 0, 0, 1]);
  for (const file of paths) {
    if (!snapshotFile(ws, file)) continue;
    const status = await git.status({ fs: io, dir: ws.root, gitdir, filepath: file, cache, refresh: false });
    if (status === "ignored" || status === "absent") continue;
    if (status === "unmodified") matrix.push([file, 1, 1, 1]);
    else if (["deleted", "*deleted", "*absent"].includes(status)) matrix.push([file, 1, 0, 1]);
    else matrix.push([file, 1, 2, 1]);
  }
  return matrix;
}

export async function pendingWorkspaceFiles(ws: Workspace): Promise<string[]> {
  await ensureHistory(ws);
  const changedFiles = new Map(invalidated.get(ws));
  const matrix = await git.statusMatrix({
    fs: historyFs(ws, changedFiles),
    refresh: !changedFiles.size,
    dir: ws.root,
    gitdir: historyDirectory(ws),
    filter: (file) => snapshotFile(ws, file),
  });
  const files = pendingFiles(matrix);
  if (!files.length) clearInvalidated(ws, changedFiles);
  return files;
}

const deferred = new WeakMap<Workspace, (message: string) => void>();

/** 常驻进程里存版本交给后台；返回的函数恢复此前的调度。 */
export function deferSnapshots(ws: Workspace, schedule: (message: string) => void): () => void {
  const previous = deferred.get(ws);
  deferred.set(ws, schedule);
  return () => {
    if (previous) deferred.set(ws, previous);
    else deferred.delete(ws);
  };
}

/** 把工作区当前状态记为一个版本；没有改动时返回 null。 */
const batchDepth = new WeakMap<Workspace, number>();

export async function batchSnapshot<T>(
  ws: Workspace,
  message: string | (() => string),
  operation: () => Promise<T>,
): Promise<T> {
  batchDepth.set(ws, (batchDepth.get(ws) ?? 0) + 1);
  let result: T;
  try {
    result = await batchOverview(ws, operation);
  } finally {
    batchDepth.set(ws, (batchDepth.get(ws) ?? 1) - 1);
  }
  await snapshot(ws, typeof message === "function" ? message() : message);
  return result;
}

export async function snapshot(ws: Workspace, message: string, now = new Date()): Promise<string | null> {
  if (batchDepth.get(ws)) return null;
  const schedule = deferred.get(ws);
  if (!schedule) return snapshotNow(ws, message, now);
  schedule(message);
  return null;
}

type SnapshotMessage = string | ((files: readonly string[], hasPendingFiles: boolean) => string | null);

function unavailableHistoryWrite(error: unknown): boolean {
  if (error instanceof git.Errors.MultipleGitError)
    return error.errors.length > 0 && error.errors.every(unavailableHistoryWrite);
  return ["EPERM", "EACCES", "EROFS", "ENOSPC"].includes(
    (error as NodeJS.ErrnoException | undefined)?.code ?? "",
  );
}

const indexTrees = new WeakMap<
  Workspace,
  { root: string; entries: Map<string, { content: string; oid: string }> }
>();

/** Git 树对象不可变；完整读取当前索引，只让变化的目录重新生成对象。 */
async function indexTree(ws: Workspace, cache: object): Promise<string> {
  const previous = indexTrees.get(ws);
  const entries = new Map<string, { content: string; oid: string }>();
  const dir = ws.root;
  const gitdir = historyDirectory(ws);
  const root = await git.walk({
    fs,
    dir,
    gitdir,
    cache,
    trees: [git.STAGE()],
    map: async (file, [stage]) => {
      if (!stage) return;
      const type = await stage.type();
      return {
        file,
        path: basename(file),
        mode: type === "tree" ? "040000" : (await stage.mode()).toString(8),
        type,
        oid: type === "tree" ? "" : await stage.oid(),
      };
    },
    reduce: async (parent, children) => {
      if (parent.type !== "tree") return parent;
      const tree: TreeEntry[] = children.map(({ file: _file, ...entry }) => entry);
      const content = JSON.stringify(tree);
      const cached = previous?.root === dir ? previous.entries.get(parent.file) : undefined;
      const oid = cached?.content === content ? cached.oid : await git.writeTree({ fs, dir, gitdir, tree });
      entries.set(parent.file, { content, oid });
      return { ...parent, oid };
    },
  });
  indexTrees.set(ws, { root: dir, entries });
  return root.oid;
}

/** 立刻存版本；可用本次盘点生成说明，返回 null 则跳过本次提交。 */
export async function snapshotNow(
  ws: Workspace,
  message: SnapshotMessage,
  now = new Date(),
  options: { changedOnly?: boolean } = {},
): Promise<string | null> {
  try {
    refreshOverview(ws, now);
    const version = await saveSnapshot(ws, message, now, options);
    if (version || (failedSnapshots.has(ws) && !(await pendingWorkspaceFiles(ws)).length))
      failedSnapshots.delete(ws);
    return version;
  } catch (error) {
    failedSnapshots.add(ws);
    if (error instanceof KaituError && error.code === "CLOUD_UNAVAILABLE") return null;
    if (!unavailableHistoryWrite(error)) throw error;
    console.warn("数据已保存，版本稍后由开图补存（运行 kaitu ui 或 kaitu snapshot）");
    return null;
  }
}

async function saveSnapshot(
  ws: Workspace,
  message: SnapshotMessage,
  now: Date,
  options: { changedOnly?: boolean } = {},
): Promise<string | null> {
  await ensureHistory(ws);
  const dir = ws.root;
  const io = historyFs(ws);
  // 本轮共享 Git 对象与索引解析，不跨版本缓存工作区状态。
  const cache = {};
  const head = await headOid(ws);
  const saved = savedRoots.get(ws);
  const current = saved?.root === ws.root && saved.oid === head;
  if (!current) indexTrees.delete(ws);
  const changedFiles = new Map(invalidated.get(ws));
  // 只供已建立文件监听的后台保存使用。入口写入和监听共用失效记录；启动、
  // 换目录、未知事件和 ignore 规则变化仍完整盘点。恢复等边界调用保持默认。
  const filepaths =
    options.changedOnly &&
    current &&
    changedFiles.size > 0 &&
    [...changedFiles.keys()].every(
      (file) =>
        file !== "工作区" &&
        file !== "." &&
        !file.startsWith("../") &&
        file.split("/").at(-1) !== ".gitignore",
    )
      ? [...changedFiles.keys(), "OVERVIEW.md"]
      : undefined;
  const statusFs = historyFs(ws, changedFiles);
  const matrix =
    (filepaths && (await changedStatus(ws, filepaths, statusFs, cache))) ??
    (await git.statusMatrix({
      cache,
      fs: statusFs,
      refresh: !changedFiles.size,
      dir,
      gitdir: historyDirectory(ws),
      filter: (file) => snapshotFile(ws, file),
    }));
  let description: string;
  if (typeof message === "function") {
    const files = pendingFiles(matrix);
    // 同一份状态查询：显式原文保存也要区分实际待存内容与已经落入上一版本的 no-op。
    const result = message(files, files.length > 0 || pendingFiles(matrix, true).length > 0);
    if (result === null) {
      // 暂不提交的外部收件箱仍是脏文件，下次显式保存原文时要一并入版本。
      if (!pendingFiles(matrix, true).length) {
        clearInvalidated(ws, changedFiles);
        savedRoots.set(ws, { root: ws.root, oid: head });
      }
      return null;
    }
    description = result;
  } else description = message;
  const additions: string[] = [];
  const removals: string[] = [];
  for (const [filepath, head, workdir, stage] of matrix) {
    if (neverTrack(filepath)) {
      if (head !== 0 || stage !== 0) {
        removals.push(filepath);
      }
      continue;
    }
    if (head === 1 && workdir === 1 && stage === 1) continue;
    if (workdir === 0) removals.push(filepath);
    else additions.push(filepath);
  }
  if (!additions.length && !removals.length) {
    clearInvalidated(ws, changedFiles);
    savedRoots.set(ws, { root: ws.root, oid: head });
    return null;
  }
  if (removals.length) await git.remove({ fs, dir, gitdir: historyDirectory(ws), filepath: removals, cache });
  // git.add 支持多路径，但会并行打开该数组里的文件；小批限制文件句柄，同时避免逐文件重写全索引。
  for (let i = 0; i < additions.length; i += 32)
    await git.add({ fs: io, dir, gitdir: historyDirectory(ws), filepath: additions.slice(i, i + 32), cache });
  const timestamp = Math.floor(now.getTime() / 1000);
  const oid = await git.commit({
    cache,
    fs,
    dir,
    gitdir: historyDirectory(ws),
    tree: await indexTree(ws, cache),
    message: description,
    author: { ...AUTHOR, timestamp, timezoneOffset: now.getTimezoneOffset() },
  });
  clearInvalidated(ws, changedFiles);
  savedRoots.set(ws, { root: ws.root, oid });
  return oid;
}

export interface Version {
  oid: string;
  short: string;
  message: string;
  /** 用户时区的 ISO 8601 */
  time: string;
}

/** 版本列表只在 HEAD 变化时改变：按 HEAD、条数、路径和时区缓存，不必每次重读提交对象。 */
const logs = new WeakMap<Workspace, Map<string, readonly Version[]>>();

/** 版本列表，新的在前；给了 path 只列改动过它的版本。 */
export async function history(
  ws: Workspace,
  opts: { path?: string; limit?: number } = {},
): Promise<Version[]> {
  const head = hasHistory(ws) ? await headOid(ws) : null;
  if (!head) return [];
  const filepath = opts.path?.replace(/\/+$/, "") || undefined;
  const key = `${head}\0${opts.limit ?? ""}\0${filepath ?? ""}\0${ws.timeZone()}`;
  const cached = logs.get(ws)?.get(key);
  if (cached) return [...cached];
  const versions = await readLog(ws, filepath, opts.limit);
  const map = logs.get(ws) ?? new Map<string, readonly Version[]>();
  if (map.size > 20) map.clear();
  map.set(key, Object.freeze(versions.map((version) => Object.freeze(version))));
  logs.set(ws, map);
  return versions;
}

async function readLog(
  ws: Workspace,
  filepath: string | undefined,
  limit: number | undefined,
): Promise<Version[]> {
  let entries: Awaited<ReturnType<typeof git.log>>;
  try {
    entries = await git.log({ fs, dir: ws.root, gitdir: historyDirectory(ws), depth: limit, filepath });
  } catch (e) {
    if ((e as { code?: string }).code === "NotFoundError") return [];
    throw e;
  }
  const tz = ws.timeZone();
  return entries.map((e) => ({
    oid: e.oid,
    short: e.oid.slice(0, 7),
    message: e.commit.message.trim(),
    time: isoInZone(new Date(e.commit.author.timestamp * 1000), tz),
  }));
}

async function resolveVersion(ws: Workspace, version: string): Promise<string> {
  try {
    return await git.expandOid({ fs, dir: ws.root, gitdir: historyDirectory(ws), oid: version });
  } catch {
    throw new KaituError(`找不到版本 ${version}`, "NOT_FOUND");
  }
}

function under(prefix: string, file: string): boolean {
  return !prefix || file === prefix || file.startsWith(`${prefix}/`);
}

/**
 * 恢复到某个版本（整个工作区或其中一个路径）。
 * 先把当前状态存一个版本，再改写文件并生成「恢复」版本，所以恢复本身也能撤销。
 */
export async function restore(
  ws: Workspace,
  version: string,
  opts: { path?: string; now?: Date } = {},
): Promise<{ oid: string | null; changed: number }> {
  if (!hasHistory(ws)) throw new KaituError("工作区还没有版本历史", "NO_HISTORY");
  const target = await resolveVersion(ws, version);
  const prefix = (opts.path ?? "").replace(/^\.\/?/, "").replace(/\/+$/, "");
  const dir = ws.root;
  const head = await headOid(ws);
  const targetFiles = new Set(
    (await git.listFiles({ fs, dir, gitdir: historyDirectory(ws), ref: target })).filter((f) =>
      under(prefix, f),
    ),
  );
  let currentFiles = head
    ? (await git.listFiles({ fs, dir, gitdir: historyDirectory(ws), ref: head })).filter((f) =>
        under(prefix, f),
      )
    : [];
  if (prefix && targetFiles.size === 0 && currentFiles.length === 0) {
    throw new KaituError(`版本 ${version.slice(0, 7)} 中没有 ${prefix}`, "NOT_FOUND");
  }

  const unavailable = [...new Set([...targetFiles, ...currentFiles])].filter(
    (file) =>
      !neverTrack(file) &&
      !ws.conflictCopy(file) &&
      !["OVERVIEW.md", "AGENT-README.md", "ORGANIZER.md"].includes(file) &&
      ws.isUnavailable(file),
  );
  if (unavailable.length)
    throw new KaituError(`还没从云盘下载：${unavailable.join("、")}`, "CLOUD_UNAVAILABLE");
  await saveSnapshot(ws, "恢复前自动保存", opts.now ?? new Date());
  if (await headOid(ws))
    currentFiles = (await git.listFiles({ fs, dir, gitdir: historyDirectory(ws), ref: "HEAD" })).filter(
      (file) => under(prefix, file),
    );

  let changed = 0;
  for (const f of currentFiles) {
    if (!ws.conflictCopy(f) && !targetFiles.has(f) && !neverTrack(f)) {
      fs.rmSync(ws.resolve(f, { internal: true }), { force: true });
      invalidateHistoryFile(ws, f);
      changed++;
    }
  }
  for (const f of targetFiles) {
    if (ws.conflictCopy(f) || neverTrack(f) || ["OVERVIEW.md", "AGENT-README.md", "ORGANIZER.md"].includes(f))
      continue;
    const { blob } = await git.readBlob({ fs, dir, gitdir: historyDirectory(ws), oid: target, filepath: f });
    if (quarantineBankContent(ws, f, blob)) {
      fs.rmSync(ws.resolve(f), { force: true });
      invalidateHistoryFile(ws, f);
      continue;
    }
    const abs = ws.resolve(f, { internal: true });
    if (fs.existsSync(abs) && Buffer.compare(fs.readFileSync(abs), Buffer.from(blob)) === 0) continue;
    if (f === ".kaitu/config.json") {
      const current = ws.readJson<{ state_dir?: string }>(f);
      const config = JSON.parse(Buffer.from(blob).toString("utf8"));
      if (current.state_dir) config.state_dir = current.state_dir;
      else config.state_dir = undefined;
      ws.writeJson(f, config, { internal: true });
    } else ws.writeText(f, blob, { internal: true });
    changed++;
  }

  const { commit } = await git.readCommit({ fs, dir, gitdir: historyDirectory(ws), oid: target });
  const what = prefix ? `${prefix} ` : "";
  const oid = await snapshot(
    ws,
    `恢复${what}到版本 ${target.slice(0, 7)}（${commit.message.trim()}）`,
    opts.now,
  );
  return { oid, changed };
}

export async function isTracked(ws: Workspace, path: string): Promise<boolean> {
  const head = await headOid(ws);
  if (!head) return false;
  return (await git.listFiles({ fs, dir: ws.root, gitdir: historyDirectory(ws), ref: head })).includes(path);
}
