import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { promises as fs, existsSync, rmSync } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";
import { z } from "zod";
import { writeAgentsMd } from "./agents-md.js";
import { assetsRoot } from "./assets.js";
import { rememberWorkspace } from "./drive.js";
import { KaituError } from "./errors.js";
import {
  beginGithubCliLogin,
  cancelGithubCliLogin,
  createPrivateGithubRepository,
  githubCliLoginState,
  githubCliRequest,
  githubCliStatus,
  memoryRepositoryDescription,
} from "./github-cli.js";
import { parseGithubRepo, setGithubToken } from "./github.js";
import { initWorkspace } from "./init.js";
import { normalizeLocale, readPreferences, pick as translate } from "./locale.js";
import { rememberOrganizer } from "./organizer.js";
import { batchOverview, latestDaily, refreshOverview } from "./overview.js";
import { type PhoneReceipt, phoneReceipts, writePhoneReceipts } from "./phone-receipts.js";
import { schemas } from "./schema.js";
import { isUserProfile, placeholderOriginal } from "./sync-files.js";
const pick = (zh: string, en: string) => translate(normalizeLocale(readPreferences().locale), zh, en);
import { Workspace, type WorkspaceWrite, stateDirectory } from "./workspace.js";

export type BackupFiles = Record<string, string>;
export interface BackupProgress {
  phase: "scan" | "download" | "merge" | "upload";
  completed: number;
  total?: number;
}
export interface BackupRunOptions {
  signal?: AbortSignal;
  progress?: (value: BackupProgress) => void;
}
export interface BackupRemote {
  inspect(repo: string): Promise<{ private: boolean; branch: string; description?: string | null }>;
  read(
    repo: string,
    branch: string,
    options?: BackupRunOptions,
  ): Promise<{ head: string | null; files: BackupFiles }>;
  push(
    repo: string,
    branch: string,
    head: string | null,
    files: BackupFiles,
    options?: BackupRunOptions,
  ): Promise<string>;
}
export interface BackupConnection {
  via?: "gh" | "token";
  repo: string;
  branch: string;
  private: boolean;
  enabled: boolean;
  text: boolean;
  records: boolean;
  description?: string | null;
  checkedAt: string;
}
export interface BackupConflict {
  path: string;
  reason: "file" | "record";
  ids?: string[];
  local?: string;
  remote?: string;
}
interface BackupState {
  connection?: BackupConnection;
  base: BackupFiles;
  conflicts: BackupConflict[];
  lastSync?: string;
  error?: string;
}
const stateFile = ".kaitu/workspace-backup.json";
const memoryRepositoryReadme =
  "# 开图私人记忆仓库\n\n这里保存所选的工作区文字与结构化记录，项目目标、状态和开发日志仍在 projects/，记忆仍在 memory/。\n\nAgent 先读 AGENT-README.md，再按入口读 OVERVIEW.md、项目 STATUS.md 和 log.md；写入遵守既有 inbox/agents/ 与 handoffs/ 接力约定，不覆盖已有文件。照片、视频、凭据和本机状态不在同步范围。\n";
const manifest = "kaitu-backup.json";
const states = new WeakMap<Workspace, { root: string; value: BackupState }>();
const active = new WeakMap<Workspace, Promise<void>>();
const events = new WeakMap<Workspace, EventEmitter>();
const jobs = new WeakMap<Workspace, { controller: AbortController; progress?: BackupProgress }>();
function emitter(ws: Workspace) {
  let e = events.get(ws);
  if (!e) {
    e = new EventEmitter();
    events.set(ws, e);
  }
  return e;
}
function state(ws: Workspace): BackupState {
  const cached = states.get(ws);
  if (cached?.root === ws.root) return cached.value;
  const value = ws.exists(stateFile) ? ws.readJson<BackupState>(stateFile) : { base: {}, conflicts: [] };
  states.set(ws, { root: ws.root, value });
  return value;
}
export function invalidateWorkspaceBackup(ws: Workspace): void {
  states.delete(ws);
}
function store(ws: Workspace, value: BackupState) {
  states.set(ws, { root: ws.root, value });
  ws.writeJson(stateFile, value, { internal: true, mode: 0o600 });
  emitter(ws).emit("change");
}
export function subscribeWorkspaceBackup(ws: Workspace, fn: () => void): () => void {
  emitter(ws).on("change", fn);
  return () => {
    emitter(ws).off("change", fn);
  };
}
export function workspaceBackupEnabled(ws: Workspace): boolean {
  return state(ws).connection?.enabled === true;
}

export function workspaceBackupStatus(ws: Workspace) {
  const s = state(ws);
  return {
    connection: s.connection ?? null,
    running: active.has(ws),
    progress: jobs.get(ws)?.progress ?? null,
    lastSync: s.lastSync ?? null,
    error: s.error ?? null,
    conflicts: s.conflicts,
    tokenConfigured: !!token(ws),
    ghLogin: githubCliLoginState(),
  };
}
function token(ws: Workspace): string {
  return ws.exists(".kaitu/secrets.json")
    ? String(ws.readJson<Record<string, unknown>>(".kaitu/secrets.json").github_token ?? "")
    : "";
}
function selected(path: string, c: Pick<BackupConnection, "text" | "records">): boolean {
  if (isUserProfile(path)) return false;
  if (path === manifest) return true;
  const parts = path.split("/");
  if (parts.some((p) => !p || p === ".." || p.startsWith(".") || p === "node_modules") || path.includes("\\"))
    return false;
  if (
    /(?:secrets?|credentials?|tokens?|auth|api[-_]?keys?|passwords?|\.pem|\.key)(?:[.\-_]|$)/i.test(
      parts.at(-1) as string,
    )
  )
    return false;
  if (parts[0] === "phone") return /^phone\/(today|week|map|library|receipts)\.json$/.test(path);
  if (parts[0] === "inbox")
    return /^inbox\/(agents\/[^/]+\.(?:md|jsonl?|txt)|health\/[^/]+\.health\.json|notes\/.+\.md)$/.test(path);
  return (c.text && /\.(md|txt)$/i.test(path)) || (c.records && /\.(jsonl?|ya?ml|csv|ics|toml)$/i.test(path));
}
async function localFiles(
  ws: Workspace,
  c: BackupConnection,
  options: BackupRunOptions,
): Promise<BackupFiles> {
  let completed = 0;
  options.progress?.({ phase: "scan", completed });
  const files: BackupFiles = {};
  const basePaths = Object.keys(state(ws).base);
  const internal = relative(ws.root, stateDirectory(ws.root, ws.isICloud)).split(sep).join("/");
  const walk = async (prefix: string) => {
    options.signal?.throwIfAborted();
    for (const e of await fs.readdir(join(ws.root, prefix), { withFileTypes: true })) {
      options.signal?.throwIfAborted();
      const path = prefix ? `${prefix}/${e.name}` : e.name;
      const pending = placeholderOriginal(path)?.split(sep).join("/");
      if (pending && (selected(pending, c) || basePaths.some((path) => path.startsWith(`${pending}/`))))
        throw new KaituError(
          pick(
            `请先从 iCloud 下载：${pending}，本轮备份已暂停`,
            `Download from iCloud first: ${pending}. This backup is paused.`,
          ),
          "CLOUD_UNAVAILABLE",
        );
      if (
        e.isSymbolicLink() ||
        e.name.startsWith(".") ||
        e.name === "node_modules" ||
        (prefix === "inbox" && !["agents", "health", "notes"].includes(e.name))
      )
        continue;
      if (path === internal) continue;
      if (e.isDirectory()) await walk(path);
      else if (e.isFile() && selected(path, c)) {
        files[path] = await fs.readFile(ws.resolve(path), { encoding: "utf8", signal: options.signal });
        options.progress?.({ phase: "scan", completed: ++completed });
      }
    }
  };
  await walk("");
  files[manifest] = manifestText(c);
  return files;
}
/**
 * kaitu-backup.json 不是工作区里的实体文件：本机按连接范围生成，远端写的是仓库里有哪些范围。
 * 比较只看范围，不参与三方合并，也不会成为冲突。
 */
function manifestText(scope: { text: boolean; records: boolean }) {
  return JSON.stringify({ format: "kaitu-workspace", version: 1, text: scope.text, records: scope.records });
}
function manifestScope(text?: string) {
  try {
    const value = JSON.parse(text ?? "");
    return value?.format === "kaitu-workspace"
      ? { text: value.text === true, records: value.records === true }
      : null;
  } catch {
    return null;
  }
}
const withoutManifest = (files: BackupFiles) =>
  Object.fromEntries(Object.entries(files).filter(([path]) => path !== manifest));
function sameFiles(a: BackupFiles, b: BackupFiles) {
  return Object.keys(a).length === Object.keys(b).length && Object.keys(a).every((key) => a[key] === b[key]);
}
function recordRows(text?: string): Record<string, unknown>[] | null {
  try {
    const rows = (text ?? "")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    return rows.every((r) => typeof r.id === "string" && (r.rev === undefined || typeof r.rev === "number"))
      ? rows
      : null;
  } catch {
    return null;
  }
}
function latest(files: BackupFiles) {
  const rows = new Map<string, { json: string; paths: Set<string> }>();
  const revisions = new Map<string, number>();
  for (const [path, text] of Object.entries(files)) {
    if (!path.endsWith(".jsonl")) continue;
    for (const row of recordRows(text) ?? []) {
      const id = row.id as string;
      const rev = (row.rev as number | undefined) ?? 1;
      const prev = rows.get(id);
      const paths = prev?.paths ?? new Set<string>();
      paths.add(path);
      if (rev >= (revisions.get(id) ?? -1)) {
        rows.set(id, { json: JSON.stringify(row), paths });
        revisions.set(id, rev);
      }
    }
  }
  return rows;
}
export function mergeBackup(base: BackupFiles, local: BackupFiles, remote: BackupFiles) {
  const conflicts: BackupConflict[] = [];
  const result: BackupFiles = {};
  const b = latest(base);
  const l = latest(local);
  const r = latest(remote);
  const blocked = new Map<string, string[]>();
  for (const id of new Set([...b.keys(), ...l.keys(), ...r.keys()])) {
    const lv = l.get(id);
    const rv = r.get(id);
    if (lv?.json !== rv?.json && lv?.json !== b.get(id)?.json && rv?.json !== b.get(id)?.json) {
      for (const path of new Set([...(b.get(id)?.paths ?? []), ...(lv?.paths ?? []), ...(rv?.paths ?? [])]))
        blocked.set(path, [...(blocked.get(path) ?? []), id]);
    }
  }
  for (const path of new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)])) {
    const bv = base[path];
    const lv = local[path];
    const rv = remote[path];
    if (blocked.has(path)) {
      conflicts.push({ path, reason: "record", ids: blocked.get(path), local: lv, remote: rv });
      continue;
    }
    let value: string | undefined;
    if (lv === rv || rv === bv) value = lv;
    else if (lv === bv) value = rv;
    else if (path.endsWith(".jsonl")) {
      const lr = recordRows(lv);
      const rr = recordRows(rv);
      const br = recordRows(bv);
      if (lr && rr && br) {
        const rows = (items: Record<string, unknown>[]) =>
          new Map(items.map((row) => [`${row.id}:${row.rev ?? 1}`, JSON.stringify(row)]));
        const before = rows(br);
        const left = rows(lr);
        const right = rows(rr);
        const merged: string[] = [];
        let collision = false;
        for (const key of new Set([...before.keys(), ...left.keys(), ...right.keys()])) {
          const original = before.get(key);
          const a = left.get(key);
          const b = right.get(key);
          if (a === b || b === original) {
            if (a !== undefined) merged.push(a);
          } else if (a === original) {
            if (b !== undefined) merged.push(b);
          } else collision = true;
        }
        if (collision) conflicts.push({ path, reason: "record", local: lv, remote: rv });
        else value = merged.length ? `${merged.join("\n")}\n` : "";
      } else conflicts.push({ path, reason: "file", local: lv, remote: rv });
    } else conflicts.push({ path, reason: "file", local: lv, remote: rv });
    if (value !== undefined) result[path] = value;
  }
  return { files: result, conflicts };
}

/** GitHub Git Data API：凭据复用现有 secrets.json，所有本机状态排除在备份之外。 */
export function githubBackupRemote(
  ws?: Workspace,
  via = ws ? state(ws).connection?.via : "gh",
): BackupRemote {
  let previous: { head: string; tree: string; files: BackupFiles } | undefined;
  const request = async (
    repo: string,
    path: string,
    method = "GET",
    body?: unknown,
    signal?: AbortSignal,
  ) => {
    signal?.throwIfAborted();
    if (via === "gh") return githubCliRequest(repo, path, method, body, signal);
    const credential = ws ? token(ws) : "";
    const response = await fetch(`https://api.github.com/repos/${repo}${path}`, {
      method,
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000),
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "kaitu",
        ...(credential ? { Authorization: `Bearer ${credential}` } : {}),
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if ([404, 409].includes(response.status) && path.startsWith("/git/ref/")) return null;
    if (!response.ok)
      throw new Error(
        [401, 403, 404].includes(response.status)
          ? pick(
              "GitHub 授权失败，请检查仓库权限和 token",
              "GitHub authorization failed; check repository access and token",
            )
          : pick("GitHub 同步失败，请稍后重试", "GitHub sync failed; try again later"),
      );
    return response.json();
  };
  return {
    async inspect(repo) {
      const info = await request(repo, "");
      return {
        private: info.private === true,
        branch: info.default_branch,
        description: info.description ?? null,
      };
    },
    async read(repo, branch, options = {}) {
      const requestRead = (path: string) => request(repo, path, "GET", undefined, options.signal);
      options.progress?.({ phase: "download", completed: 0 });
      const ref = await requestRead(`/git/ref/heads/${encodeURIComponent(branch)}`);
      if (!ref) return { head: null, files: {} };
      const commit = await requestRead(`/git/commits/${ref.object.sha}`);
      const tree = await requestRead(`/git/trees/${commit.tree.sha}?recursive=1`);
      if (tree.truncated)
        throw new Error(
          pick("仓库过大，请使用专门的开图备份仓库", "Use a dedicated repository for this workspace backup"),
        );
      const files: BackupFiles = {};
      const entries = tree.tree.filter(
        (e: { type: string; mode: string; path: string }) =>
          e.type === "blob" && e.mode === "100644" && selected(e.path, { text: true, records: true }),
      );
      let completed = 0;
      options.progress?.({ phase: "download", completed, total: entries.length });
      for (let i = 0; i < entries.length; i += 8)
        await Promise.all(
          entries.slice(i, i + 8).map(async (e: { path: string; sha: string }) => {
            options.signal?.throwIfAborted();
            const cache = `.kaitu/cache/github-blobs/${e.sha}`;
            if (ws?.exists(cache)) files[e.path] = ws.readText(cache);
            else {
              const blob = await requestRead(`/git/blobs/${e.sha}`);
              const content = Buffer.from(blob.content, "base64").toString("utf8");
              ws?.writeText(cache, content, { internal: true });
              files[e.path] = content;
            }
            options.progress?.({ phase: "download", completed: ++completed, total: entries.length });
          }),
        );
      if (!files[manifest] || JSON.parse(files[manifest] as string).format !== "kaitu-workspace")
        throw new Error(
          pick(
            "这个仓库不是开图备份，请使用空仓库或已有开图备份",
            "Choose an empty repository or an existing Kaitu backup",
          ),
        );
      previous = { head: ref.object.sha, tree: commit.tree.sha, files };
      return { head: ref.object.sha as string, files };
    },
    async push(repo, branch, expectedHead, files, options = {}) {
      const requestWrite = (path: string, method: string, body: unknown) =>
        request(repo, path, method, body, options.signal);
      options.progress?.({ phase: "upload", completed: 0 });
      let head = expectedHead;
      if (!head) {
        const initial = await requestWrite(`/contents/${manifest}`, "PUT", {
          message: "初始化开图备份",
          branch,
          content: Buffer.from(files[manifest] as string).toString("base64"),
        });
        head = initial.commit.sha;
        previous = {
          head: head as string,
          tree: initial.commit.tree.sha,
          files: { [manifest]: files[manifest] as string },
        };
      }
      const entries: Record<string, unknown>[] = Object.entries(files)
        .filter(([path, text]) => previous?.files[path] !== text)
        .map(([path, content]) => ({ path, mode: "100644", type: "blob", content }));
      for (const path of Object.keys(previous?.files ?? {}))
        if (!(path in files)) entries.push({ path, mode: "100644", type: "blob", sha: null });
      const tree = await requestWrite("/git/trees", "POST", { base_tree: previous?.tree, tree: entries });
      const commit = await requestWrite("/git/commits", "POST", {
        message: "开图工作区同步",
        tree: tree.sha,
        parents: head ? [head] : [],
      });
      await requestWrite(`/git/refs/heads/${encodeURIComponent(branch)}`, "PATCH", {
        sha: commit.sha,
        force: false,
      });
      options.progress?.({ phase: "upload", completed: entries.length, total: entries.length });
      return commit.sha as string;
    },
  };
}

function backupSelection(ws: Workspace, input: { text?: boolean; records?: boolean }) {
  const previous = state(ws).connection;
  const text = input.text ?? previous?.text;
  const records = input.records ?? previous?.records;
  if (text === undefined || records === undefined)
    throw new KaituError(
      pick(
        "请明确选择文字和记录范围：--text / --no-text 与 --records / --no-records",
        "Choose both scopes explicitly: --text / --no-text and --records / --no-records",
      ),
      "BACKUP_SCOPE_REQUIRED",
    );
  return { text, records };
}

export async function connectWorkspaceBackup(
  ws: Workspace,
  input: unknown,
  providedRemote?: BackupRemote,
  write: WorkspaceWrite = (operation) => operation(),
) {
  const args = z
    .object({
      repo: z.string(),
      via: z.enum(["gh", "token"]).default("token"),
      text: z.boolean().optional(),
      records: z.boolean().optional(),
      allowPublic: z.boolean().default(false),
    })
    .parse(input);
  const repo = parseGithubRepo(args.repo);
  const { selection, remote } = await write(async () => {
    if (active.has(ws)) throw new KaituError("请等待本次同步完成", "BACKUP_BUSY");
    return {
      selection: backupSelection(ws, args),
      remote: providedRemote ?? githubBackupRemote(ws, args.via),
    };
  });
  const info = await remote.inspect(repo);
  const connection = {
    via: args.via,
    repo,
    ...info,
    enabled: info.private || args.allowPublic,
    ...selection,
    checkedAt: new Date().toISOString(),
  };
  return write(async () => {
    if (active.has(ws)) throw new KaituError("请等待本次同步完成", "BACKUP_BUSY");
    const previous = state(ws);
    store(ws, {
      ...previous,
      connection,
      base: previous.connection?.repo === repo ? previous.base : {},
      conflicts: [],
      error: undefined,
    });
    refreshOverview(ws);
    return workspaceBackupStatus(ws);
  });
}
function remoteReceipts(text: string): PhoneReceipt[] {
  try {
    const value = JSON.parse(text) as { items: PhoneReceipt[] };
    return schemas().builtin("phone-receipts.schema.json")(value) ? value.items : [];
  } catch {
    return [];
  }
}
export async function syncWorkspaceBackup(ws: Workspace, remote = githubBackupRemote(ws)): Promise<void> {
  if (active.has(ws)) return active.get(ws);
  const s = state(ws);
  // 旧版会把 kaitu-backup.json 记成冲突；它按范围生成，留着只会挡住同步。
  if (s.conflicts.some((c) => c.path === manifest))
    s.conflicts = s.conflicts.filter((c) => c.path !== manifest);
  if (!s.connection?.enabled || s.conflicts.length) return;
  const controller = new AbortController();
  const job: { controller: AbortController; progress?: BackupProgress } = { controller };
  jobs.set(ws, job);
  const options: BackupRunOptions = {
    signal: controller.signal,
    progress: (value) => {
      job.progress = value;
    },
  };
  const run = async () => {
    const c = s.connection as BackupConnection;
    try {
      refreshOverview(ws);
      const local = await localFiles(ws, c, options);
      const other = await remote.read(c.repo, c.branch, options);
      controller.signal.throwIfAborted();
      options.progress?.({ phase: "merge", completed: 0 });
      if (!other.head && Object.keys(s.base).length) throw new Error("Remote branch unavailable");
      const incoming = Object.fromEntries(Object.entries(other.files).filter(([path]) => selected(path, c)));
      // phone 由本机生成；远端删除不会清掉本机快照，也不会写回远端修改。
      const phoneFromLocal = (files: BackupFiles) => {
        const result = withoutManifest(incoming);
        for (const path of new Set([...Object.keys(incoming), ...Object.keys(files)])) {
          if (!path.startsWith("phone/")) continue;
          if (files[path] === undefined) delete result[path];
          else result[path] = files[path] as string;
        }
        return result;
      };
      const base = Object.fromEntries(
        Object.entries(s.base).filter(([path]) => path !== manifest && selected(path, c)),
      );
      // 先确认没有冲突再动本机：有冲突时回执和整理员状态都不提前写入。
      const check = mergeBackup(base, withoutManifest(local), phoneFromLocal(local));
      if (check.conflicts.length) {
        store(ws, { ...s, conflicts: check.conflicts, error: undefined });
        return;
      }
      const known = new Set(phoneReceipts(ws).map((r) => `${r.kind}:${r.ref}`));
      const added = incoming["phone/receipts.json"]
        ? remoteReceipts(incoming["phone/receipts.json"]).filter((r) => !known.has(`${r.kind}:${r.ref}`))
        : [];
      rememberOrganizer(ws, incoming["phone/today.json"], added, latestDaily(ws));
      // 云端整理员写的回执，本机没有的先并进来；其余 phone 文件仍以本机为准。
      if (added.length && writePhoneReceipts(ws, added))
        local["phone/receipts.json"] = ws.readText("phone/receipts.json");
      const merged = mergeBackup(base, withoutManifest(local), phoneFromLocal(local));
      // 远端清单记的是仓库里有哪些范围：保留远端已有的范围，本机连接范围不变。
      const remoteScope = manifestScope(incoming[manifest]);
      const scope = {
        text: c.text || remoteScope?.text === true,
        records: c.records || remoteScope?.records === true,
      };
      merged.files[manifest] =
        remoteScope && remoteScope.text === scope.text && remoteScope.records === scope.records
          ? (incoming[manifest] as string)
          : manifestText(scope);
      const changes = [...new Set([...Object.keys(local), ...Object.keys(merged.files)])].filter(
        (path) => path !== manifest && local[path] !== merged.files[path],
      );
      // 网络期间作者可能继续写：这次结果留待下轮，不覆盖刚保存的内容。
      if (changes.some((path) => (ws.exists(path) ? ws.readText(path) : undefined) !== local[path])) return;
      controller.signal.throwIfAborted();
      const applyChanges = async () => {
        for (const path of changes) {
          if (merged.files[path] === undefined) rmSync(ws.resolve(path));
          else ws.writeText(path, merged.files[path] as string);
        }
        rememberOrganizer(ws, undefined, [], latestDaily(ws));
      };
      // Apply incoming files together, then refresh the derived overview once.
      if (changes.length) await batchOverview(ws, applyChanges);
      else await applyChanges();
      if (!sameFiles(merged.files, incoming)) {
        const outgoing = { ...other.files, ...merged.files };
        for (const path of Object.keys(incoming)) if (!(path in merged.files)) delete outgoing[path];
        await remote.push(c.repo, c.branch, other.head, outgoing, options);
        controller.signal.throwIfAborted();
      }
      store(ws, {
        ...s,
        base: withoutManifest(merged.files),
        conflicts: [],
        lastSync: new Date().toISOString(),
        error: undefined,
      });
    } catch (error) {
      store(ws, {
        ...s,
        error: controller.signal.aborted
          ? pick("同步已取消，可随时重试", "Sync cancelled; retry when ready")
          : error instanceof KaituError &&
              ["CLOUD_UNAVAILABLE", "GH_REQUEST", "GH_MISSING"].includes(error.code)
            ? error.message
            : pick(
                "同步未完成：请检查网络、GitHub 授权或远端新修改。本地资料已保留，可重试。",
                "Sync incomplete: check network, GitHub access or newer remote changes. Local data is kept; retry when ready.",
              ),
      });
    }
  };
  const promise = Promise.resolve()
    .then(run)
    .finally(() => {
      active.delete(ws);
      jobs.delete(ws);
      emitter(ws).emit("change");
    });
  active.set(ws, promise);
  emitter(ws).emit("change");
  return promise;
}
export function cancelWorkspaceBackup(ws: Workspace) {
  jobs.get(ws)?.controller.abort();
  return workspaceBackupStatus(ws);
}
export function requestWorkspaceBackup(ws: Workspace) {
  void syncWorkspaceBackup(ws);
  return workspaceBackupStatus(ws);
}

export function workspaceBackupPrompts(
  ws: Workspace,
  repository: string,
  selection: { text?: boolean; records?: boolean } = {},
) {
  const repo = parseGithubRepo(repository);
  const text = selection.text ?? state(ws).connection?.text ?? false;
  const records = selection.records ?? state(ws).connection?.records ?? false;
  const flags = `${text ? "--text" : "--no-text"} ${records ? "--records" : "--no-records"}`;
  const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
  const packaged = join(assetsRoot(), "dist/cli.mjs");
  const entry = existsSync(packaged) ? packaged : join(assetsRoot(), "packages/cli/dist/main.js");
  const kaitu = existsSync(entry)
    ? `ELECTRON_RUN_AS_NODE=1 ${quote(process.execPath)} ${quote(entry)}`
    : "kaitu";
  const dir = quote(ws.root);
  return {
    command: existsSync(entry)
      ? { executable: process.execPath, args: [entry], env: { ELECTRON_RUN_AS_NODE: "1" } }
      : null,
    create: [
      `请把我的开图资料接到私有 GitHub 仓库 ${repo}。下面的 kaitu 指 ${kaitu}。`,
      `1. kaitu backup connect ${repo} --create --via gh ${flags} --dir ${dir}`,
      `2. kaitu backup status --dir ${dir}，确认是私有仓库、已同步。`,
      `3. 在我的代码项目目录里运行 kaitu project memory --from <代码目录> --install --dir ${dir}，装上项目技能。`,
      "之后按项目技能读写项目状态和日志。",
    ].join("\n"),
    connect: [
      `请在这台设备接上我的开图私有仓库 ${repo}。`,
      `1. kaitu backup restore ${repo} --to <新目录> --via gh`,
      `2. kaitu backup connect ${repo} --via gh ${flags} --dir <新目录>`,
      "3. 读 AGENT-README.md 和 OVERVIEW.md，告诉我现在的项目和下一步。",
    ].join("\n"),
  };
}
export function disconnectWorkspaceBackup(ws: Workspace) {
  if (active.has(ws)) throw new Error(pick("请等待本次同步完成", "Wait for the current sync to finish"));
  const s = state(ws);
  s.connection = undefined;
  s.error = undefined;
  store(ws, s);
  return workspaceBackupStatus(ws);
}
export function resolveWorkspaceBackup(ws: Workspace, path: string, choice: "local" | "remote") {
  const s = state(ws);
  const conflict = s.conflicts.find((c) => c.path === path);
  if (!conflict)
    throw new KaituError(
      pick("找不到待处理的冲突，请刷新", "Conflict not found; refresh the list"),
      "CONFLICT",
    );
  // 清单按连接范围生成，本机没有这个文件：不读写磁盘，用户范围保持不变。
  if (path === manifest) {
    s.conflicts = s.conflicts.filter((c) => c.path !== path);
    store(ws, s);
    return workspaceBackupStatus(ws);
  }
  const current = ws.exists(path) ? ws.readText(path) : undefined;
  if (current !== conflict.local) {
    conflict.local = current;
    store(ws, s);
    throw new KaituError(
      pick(
        "本机文件又有修改，已更新对照内容，请重新选择",
        "The local file changed; review the updated comparison and choose again",
      ),
      "CONFLICT",
    );
  }
  // 两份原文保留在本机历史文件，作者选择后也能回看。
  ws.writeJson(`.kaitu/backup-conflicts/${randomUUID()}.json`, conflict, { internal: true, mode: 0o600 });
  if (choice === "remote") {
    if (conflict.remote === undefined) rmSync(ws.resolve(path), { force: true });
    else ws.writeText(path, conflict.remote);
  }
  if (conflict.remote === undefined) delete s.base[path];
  else s.base[path] = conflict.remote;
  s.conflicts = s.conflicts.filter((c) => c.path !== path);
  store(ws, s);
  if (choice === "remote") refreshOverview(ws);
  return workspaceBackupStatus(ws);
}
export async function restoreWorkspaceBackup(
  root: string,
  credentials: Workspace | undefined,
  input: unknown,
  providedRemote?: BackupRemote,
) {
  const args = z
    .object({
      repo: z.string(),
      via: z.enum(["gh", "token"]).default("token"),
      allowPublic: z.boolean().default(false),
    })
    .parse(input);
  if (args.via === "token" && !credentials && !providedRemote)
    throw new KaituError("token 恢复需要用 --dir 指向存有凭据的原工作区", "BAD_ARGS");
  const remote = providedRemote ?? githubBackupRemote(credentials, args.via);
  const repo = parseGithubRepo(args.repo);
  const info = await remote.inspect(repo);
  if (!info.private && !args.allowPublic)
    throw new Error(
      pick(
        "这是公开仓库，尚未启用上传；请选私有仓库或明确允许公开同步",
        "This repository is public; choose a private repository or explicitly allow public sync",
      ),
    );
  const data = await remote.read(repo, info.branch);
  if (!data.files[manifest]) throw new Error(pick("仓库中没有开图备份", "No Kaitu backup found"));
  const selection = z
    .object({
      format: z.literal("kaitu-workspace"),
      version: z.literal(1),
      text: z.boolean(),
      records: z.boolean(),
    })
    .parse(JSON.parse(data.files[manifest] as string));
  const ws = await initWorkspace(root);
  for (const [path, text] of Object.entries(data.files))
    if (path !== manifest && selected(path, selection)) ws.writeText(path, text);
  // 用纯 Git 模板建的仓库带的是简版入口，恢复后换回本机工作区的完整入口。
  writeAgentsMd(ws);
  const credential = args.via === "token" && credentials ? token(credentials) : "";
  if (credential) setGithubToken(ws, credential);
  store(ws, {
    connection: {
      via: args.via,
      repo,
      ...info,
      enabled: true,
      text: selection.text,
      records: selection.records,
      checkedAt: new Date().toISOString(),
    },
    base: data.files,
    conflicts: [],
    lastSync: new Date().toISOString(),
  });
  refreshOverview(ws);
  return { root: ws.root };
}
export function startWorkspaceBackup(ws: Workspace, notify: () => void = () => {}, intervalMs = 60000) {
  const off = subscribeWorkspaceBackup(ws, notify);
  const timer = setInterval(() => {
    void syncWorkspaceBackup(ws);
  }, intervalMs);
  timer.unref();
  void syncWorkspaceBackup(ws);
  return () => {
    clearInterval(timer);
    off();
  };
}

export async function workspaceBackupRequest(
  ws: Workspace,
  operation: string,
  input: unknown = {},
  write: WorkspaceWrite = (action) => action(),
) {
  const args = z
    .object({
      repo: z.string().optional(),
      via: z.enum(["gh", "token"]).optional(),
      token: z.string().optional(),
      text: z.boolean().optional(),
      records: z.boolean().optional(),
      allowPublic: z.boolean().optional(),
      root: z.string().optional(),
      path: z.string().optional(),
      choice: z.enum(["local", "remote"]).optional(),
    })
    .parse(input);
  switch (operation) {
    case "prompts":
      return workspaceBackupPrompts(
        ws,
        args.repo ?? state(ws).connection?.repo ?? "your-account/kaitu-ai-memory",
        args,
      );
    case "gh-status":
      return githubCliStatus();
    case "gh-login":
      beginGithubCliLogin(() => emitter(ws).emit("change"));
      return workspaceBackupStatus(ws);
    case "gh-login-cancel":
      cancelGithubCliLogin();
      return workspaceBackupStatus(ws);
    case "create": {
      if (!args.repo) throw new KaituError("请填写新仓库名称", "BAD_ARGS");
      await write(async () => {
        backupSelection(ws, args);
        if (active.has(ws)) throw new KaituError("请等待本次同步完成", "BACKUP_BUSY");
      });
      await createPrivateGithubRepository(args.repo);
      await write(async () => {
        if (!ws.exists("README.md")) ws.writeText("README.md", memoryRepositoryReadme);
      });
      const status = await connectWorkspaceBackup(ws, { ...args, via: "gh" }, undefined, write);
      if (!status.connection?.private) throw new KaituError("仓库不是私有仓库，尚未开启同步", "GH_REQUEST");
      return write(async () => requestWorkspaceBackup(ws));
    }
    case "status":
      return workspaceBackupStatus(ws);
    case "connect": {
      if (args.token) await write(async () => setGithubToken(ws, args.token as string));
      const status = await connectWorkspaceBackup(ws, args, undefined, write);
      return write(async () =>
        status.connection?.enabled ? requestWorkspaceBackup(ws) : workspaceBackupStatus(ws),
      );
    }
    case "sync":
      return requestWorkspaceBackup(ws);
    case "cancel":
      return cancelWorkspaceBackup(ws);
    case "disconnect":
      return disconnectWorkspaceBackup(ws);
    case "resolve": {
      if (!args.path || !args.choice)
        throw new Error(pick("请选择冲突文件和保留版本", "Choose a file and version"));
      return resolveWorkspaceBackup(ws, args.path, args.choice);
    }
    case "initialize":
    case "activate": {
      if (active.has(ws))
        throw new KaituError(
          pick("请等待本次同步完成", "Wait for the current sync to finish"),
          "BACKUP_BUSY",
        );
      if (!args.root || !isAbsolute(args.root))
        throw new KaituError(
          pick("请选择资料文件夹的完整路径", "Choose an absolute workspace folder path"),
          "BAD_ARGS",
        );
      if (operation === "initialize") {
        if (
          existsSync(args.root) &&
          (!(await fs.stat(args.root)).isDirectory() ||
            (await fs.readdir(args.root)).some((name) => name !== ".DS_Store"))
        )
          throw new KaituError(
            pick("请选择空文件夹来新建空白工作区", "Choose an empty folder to create a blank workspace"),
            "NOT_EMPTY",
          );
        const initialized = await initWorkspace(args.root, {
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        });
        return { root: initialized.root };
      }
      const opened = new Workspace(args.root);
      if (!opened.exists(".kaitu/config.json"))
        throw new KaituError(
          pick(
            "这个文件夹还没有开图资料。请使用「新建空白工作区」。",
            "This folder has no Kaitu workspace. Use Create a blank workspace.",
          ),
          "NOT_INITIALIZED",
        );
      // 先读取目标状态；损坏的备份或凭据文件不能把当前工作区切走。
      const status = workspaceBackupStatus(opened);
      const previous = ws.root;
      try {
        ws.root = opened.root;
        rememberWorkspace(opened.root);
      } catch (error) {
        ws.root = previous;
        throw error;
      }
      return status;
    }
    case "restore": {
      if (!args.root) throw new Error(pick("请选择一个新的恢复目录", "Choose a new restore folder"));
      if (args.token) setGithubToken(ws, args.token);
      return restoreWorkspaceBackup(args.root, ws, args);
    }
    default:
      throw new Error(pick("未知的备份操作", "Unknown backup action"));
  }
}
