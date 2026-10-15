import fs from "node:fs";
import { join } from "node:path";
import git from "isomorphic-git";
import { KaituError } from "./errors.js";
import { isoInZone } from "./time.js";
import type { Workspace } from "./workspace.js";

/** 永远不进版本历史的路径（.gitignore 之外再兜底一次）。 */
export const NEVER_TRACK = [".kaitu/secrets.json", ".kaitu/index.sqlite", ".kaitu/cache/"];

export const GITIGNORE = `# 开图自动生成：以下内容不进版本历史
.kaitu/secrets.json
.kaitu/index.sqlite
.kaitu/index.sqlite-*
.kaitu/cache/
*.tmp
.DS_Store
`;

const AUTHOR = { name: "开图", email: "kaitu@localhost" };

function neverTrack(path: string): boolean {
  return NEVER_TRACK.some((p) =>
    p.endsWith("/") ? path.startsWith(p) : path === p || path.startsWith(`${p}-`),
  );
}

export function hasHistory(ws: Workspace): boolean {
  return fs.existsSync(join(ws.root, ".git"));
}

export async function ensureHistory(ws: Workspace): Promise<void> {
  if (!hasHistory(ws)) await git.init({ fs, dir: ws.root, defaultBranch: "main" });
  if (!ws.exists(".gitignore")) ws.writeText(".gitignore", GITIGNORE);
}

async function headOid(ws: Workspace): Promise<string | null> {
  try {
    return await git.resolveRef({ fs, dir: ws.root, ref: "HEAD" });
  } catch {
    return null;
  }
}

/** 把工作区当前状态记为一个版本；没有改动时返回 null。 */
export async function snapshot(ws: Workspace, message: string, now = new Date()): Promise<string | null> {
  await ensureHistory(ws);
  const dir = ws.root;
  const matrix = await git.statusMatrix({ fs, dir });
  let changed = 0;
  for (const [filepath, head, workdir, stage] of matrix) {
    if (neverTrack(filepath)) {
      if (head !== 0 || stage !== 0) {
        await git.remove({ fs, dir, filepath });
        changed++;
      }
      continue;
    }
    if (head === 1 && workdir === 1 && stage === 1) continue;
    if (workdir === 0) await git.remove({ fs, dir, filepath });
    else await git.add({ fs, dir, filepath });
    changed++;
  }
  if (changed === 0) return null;
  const timestamp = Math.floor(now.getTime() / 1000);
  return git.commit({
    fs,
    dir,
    message,
    author: { ...AUTHOR, timestamp, timezoneOffset: now.getTimezoneOffset() },
  });
}

export interface Version {
  oid: string;
  short: string;
  message: string;
  /** 用户时区的 ISO 8601 */
  time: string;
}

/** 版本列表，新的在前；给了 path 只列改动过它的版本。 */
export async function history(
  ws: Workspace,
  opts: { path?: string; limit?: number } = {},
): Promise<Version[]> {
  if (!hasHistory(ws) || !(await headOid(ws))) return [];
  const filepath = opts.path?.replace(/\/+$/, "") || undefined;
  let entries: Awaited<ReturnType<typeof git.log>>;
  try {
    entries = await git.log({ fs, dir: ws.root, depth: opts.limit, filepath });
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
    return await git.expandOid({ fs, dir: ws.root, oid: version });
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
  await snapshot(ws, "恢复前自动保存", opts.now);

  const dir = ws.root;
  const head = await headOid(ws);
  const targetFiles = new Set(
    (await git.listFiles({ fs, dir, ref: target })).filter((f) => under(prefix, f)),
  );
  const currentFiles = head
    ? (await git.listFiles({ fs, dir, ref: head })).filter((f) => under(prefix, f))
    : [];
  if (prefix && targetFiles.size === 0 && currentFiles.length === 0) {
    throw new KaituError(`版本 ${version.slice(0, 7)} 中没有 ${prefix}`, "NOT_FOUND");
  }

  let changed = 0;
  for (const f of currentFiles) {
    if (!targetFiles.has(f) && !neverTrack(f)) {
      fs.rmSync(ws.resolve(f, { internal: true }), { force: true });
      changed++;
    }
  }
  for (const f of targetFiles) {
    if (neverTrack(f)) continue;
    const { blob } = await git.readBlob({ fs, dir, oid: target, filepath: f });
    const abs = ws.resolve(f, { internal: true });
    if (fs.existsSync(abs) && Buffer.compare(fs.readFileSync(abs), Buffer.from(blob)) === 0) continue;
    ws.writeText(f, blob, { internal: true });
    changed++;
  }

  const { commit } = await git.readCommit({ fs, dir, oid: target });
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
  return (await git.listFiles({ fs, dir: ws.root, ref: head })).includes(path);
}
