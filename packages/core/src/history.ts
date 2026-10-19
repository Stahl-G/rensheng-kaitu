import fs from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";
import git from "isomorphic-git";
import { quarantineBankContent } from "./bank-mail.js";
import { KaituError } from "./errors.js";
import { HISTORY_MARKER } from "./history-ownership.js";
import { batchOverview, refreshOverview } from "./overview.js";
import { placeholderOriginal } from "./sync-files.js";
import { isoInZone } from "./time.js";
import { type Workspace, stateDirectory } from "./workspace.js";

/** 永远不进版本历史的路径（.gitignore 之外再兜底一次）。 */
export const NEVER_TRACK = [
  ".kaitu/organizer.json",
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
  ".kaitu/feishu/",
  "inbox/agents/",
  "inbox/health/",
  "inbox/rejected/",
];

export const GITIGNORE = `.kaitu/organizer.json
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
.kaitu/feishu/
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

function neverTrack(path: string): boolean {
  return (
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

export function maintainHistoryIgnore(ws: Workspace): void {
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
    const gitdir = historyDirectory(ws);
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
  return (!ws.isICloud || !placeholderOriginal(file)) && !ws.conflictCopy(file) && !ws.isUnavailable(file);
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
  const files = matrix
    .filter(
      ([file, head, workdir, stage]) =>
        file !== "OVERVIEW.md" &&
        !file.startsWith("inbox/") &&
        !neverTrack(file) &&
        !(head === 1 && workdir === 1 && stage === 1),
    )
    .map(([file]) => file);
  if (!files.length) clearInvalidated(ws, changedFiles);
  return files;
}

const deferred = new WeakMap<Workspace, (message: string) => void>();

/** 界面进程里存版本交给后台：写入后立刻返回，版本稍后补存。 */
export function deferSnapshots(ws: Workspace, schedule: (message: string) => void): void {
  deferred.set(ws, schedule);
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
  await schedule(message);
  return null;
}

/** 立刻存版本，不经过后台。 */
export async function snapshotNow(ws: Workspace, message: string, now = new Date()): Promise<string | null> {
  refreshOverview(ws, now);
  try {
    return await saveSnapshot(ws, message, now);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (error instanceof KaituError && error.code === "CLOUD_UNAVAILABLE") return null;
    if (!["EPERM", "EACCES", "EROFS", "ENOSPC"].includes(code ?? "")) throw error;
    console.warn("数据已保存，版本稍后由开图补存（运行 kaitu ui 或 kaitu snapshot）");
    return null;
  }
}

async function saveSnapshot(ws: Workspace, message: string, now: Date): Promise<string | null> {
  await ensureHistory(ws);
  const dir = ws.root;
  const io = historyFs(ws);
  const changedFiles = new Map(invalidated.get(ws));
  const matrix = await git.statusMatrix({
    fs: historyFs(ws, changedFiles),
    refresh: !changedFiles.size,
    dir,
    gitdir: historyDirectory(ws),
    filter: (file) => snapshotFile(ws, file),
  });
  let changed = 0;
  for (const [filepath, head, workdir, stage] of matrix) {
    if (neverTrack(filepath)) {
      if (head !== 0 || stage !== 0) {
        await git.remove({ fs, dir, gitdir: historyDirectory(ws), filepath });
        changed++;
      }
      continue;
    }
    if (head === 1 && workdir === 1 && stage === 1) continue;
    if (workdir === 0) await git.remove({ fs, dir, gitdir: historyDirectory(ws), filepath });
    else await git.add({ fs: io, dir, gitdir: historyDirectory(ws), filepath });
    changed++;
  }
  if (changed === 0) {
    clearInvalidated(ws, changedFiles);
    return null;
  }
  const timestamp = Math.floor(now.getTime() / 1000);
  const oid = await git.commit({
    fs,
    dir,
    gitdir: historyDirectory(ws),
    message,
    author: { ...AUTHOR, timestamp, timezoneOffset: now.getTimezoneOffset() },
  });
  clearInvalidated(ws, changedFiles);
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
const previews = new WeakMap<Workspace, Version[]>();

/** 预览只读取已有提交的元数据；不复制历史对象或在原位置创建版本库。 */
export async function phoneHistoryMetadata(root: string, state: string) {
  const gitdir = join(state, "history.git");
  let versions: { oid: string; message: string; timestamp: number }[] = [];
  if (fs.existsSync(gitdir)) {
    try {
      versions = (await git.log({ fs, dir: root, gitdir, depth: 100 })).map(({ oid, commit }) => ({
        oid,
        message: commit.message.trim(),
        timestamp: commit.author.timestamp,
      }));
    } catch (error) {
      if ((error as { code?: string }).code !== "NotFoundError") throw error;
    }
  }
  return { versions, root, gitdir };
}

export async function previewSnapshots(
  ws: Workspace,
  metadata: Awaited<ReturnType<typeof phoneHistoryMetadata>>,
  processingInbox: boolean,
) {
  // 只在临时副本建立当前输入的基线；不复制原历史对象。后续沿用正式 Git 规则判断是否真有新版本。
  if (processingInbox) await snapshotNow(ws, "手机预览基线");
  const entries = metadata.versions.map(({ oid, message, timestamp }) => ({
    oid,
    short: oid.slice(0, 7),
    message,
    time: isoInZone(new Date(timestamp * 1000), ws.timeZone()),
  }));
  previews.set(ws, entries);
  let originalDirty: boolean | undefined;
  deferSnapshots(ws, async (message) => {
    // 只有需要保存版本时才只读盘点原位置，空收件箱预览不做这项工作。
    if (originalDirty === undefined) {
      originalDirty = metadata.versions.length === 0;
      if (!originalDirty) {
        const matrix = await git.statusMatrix({
          fs,
          dir: metadata.root,
          gitdir: metadata.gitdir,
          refresh: false,
        });
        originalDirty = matrix.some(([file, head, workdir, stage]) =>
          neverTrack(file) ? head !== 0 || stage !== 0 : !(head === 1 && workdir === 1 && stage === 1),
        );
      }
    }
    const version = await snapshotNow(ws, message);
    if (!version && !originalDirty) return;
    originalDirty = false;
    entries.unshift({
      oid: "preview",
      short: "preview",
      message,
      time: isoInZone(new Date(Math.floor(Date.now() / 1000) * 1000), ws.timeZone()),
    });
  });
  return entries;
}

/** 版本列表，新的在前；给了 path 只列改动过它的版本。 */
export async function history(
  ws: Workspace,
  opts: { path?: string; limit?: number } = {},
): Promise<Version[]> {
  const preview = previews.get(ws);
  if (preview) return preview.slice(0, opts.limit ?? preview.length);
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
    throw new KaituError(`还没从 iCloud 下载：${unavailable.join("、")}`, "CLOUD_UNAVAILABLE");
  await saveSnapshot(ws, "恢复前自动保存", opts.now ?? new Date());
  if (await headOid(ws))
    currentFiles = (await git.listFiles({ fs, dir, gitdir: historyDirectory(ws), ref: "HEAD" })).filter(
      (file) => under(prefix, file),
    );

  let changed = 0;
  for (const f of currentFiles) {
    if (!ws.conflictCopy(f) && !targetFiles.has(f) && !neverTrack(f)) {
      fs.rmSync(ws.resolve(f, { internal: true }), { force: true });
      changed++;
    }
  }
  for (const f of targetFiles) {
    if (ws.conflictCopy(f) || neverTrack(f) || ["OVERVIEW.md", "AGENT-README.md", "ORGANIZER.md"].includes(f))
      continue;
    const { blob } = await git.readBlob({ fs, dir, gitdir: historyDirectory(ws), oid: target, filepath: f });
    if (quarantineBankContent(ws, f, blob)) {
      fs.rmSync(ws.resolve(f), { force: true });
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
