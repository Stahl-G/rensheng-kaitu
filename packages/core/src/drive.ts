import { randomUUID } from "node:crypto";
import {
  constants,
  accessSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { doctor } from "./doctor.js";
import { KaituError } from "./errors.js";
import { snapshot } from "./history.js";
import { localStateRoot } from "./local-state.js";
import { refreshOverview } from "./overview.js";
import { rebaseProjectLinks } from "./projects.js";
import { setStateBinding, stateBinding } from "./state-binding.js";
import { requestICloudDownload } from "./sync-files.js";
import {
  type SyncMode,
  type SyncProvider,
  folderProvider,
  iCloudDirectory,
  nutstoreDirectory,
  syncMode,
  syncProvider,
  syncProviders,
} from "./sync-location.js";
import { validateWorkspace } from "./validate.js";
import { type Workspace, stateDirectory } from "./workspace.js";

export { localStateRoot } from "./local-state.js";

export function currentWorkspace(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const pointer = join(localStateRoot(env), "current-workspace.json");
  if (!existsSync(pointer)) return;
  const root = JSON.parse(readFileSync(pointer, "utf8")).root;
  return typeof root === "string" && existsSync(join(root, ".kaitu/config.json")) ? root : undefined;
}

function remember(root: string) {
  const path = join(localStateRoot(), "current-workspace.json");
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.tmp`;
  writeFileSync(temp, `${JSON.stringify({ root })}\n`);
  renameSync(temp, path);
}

export function findDriveDirectory(home = process.env.HOME || homedir()): string {
  const cloud = join(home, "Library/CloudStorage");
  const accounts = existsSync(cloud)
    ? readdirSync(cloud, { withFileTypes: true }).filter(
        (e) => e.isDirectory() && e.name.startsWith("GoogleDrive-"),
      )
    : [];
  if (accounts.length !== 1)
    throw new KaituError(
      "未找到唯一 Google Drive 账号，请指定 --drive-dir <我的云端硬盘路径>",
      "DRIVE_DIRECTORY",
    );
  const account = join(cloud, accounts[0]?.name ?? "");
  const candidates = readdirSync(account, { withFileTypes: true }).filter((e) => {
    if (!e.isDirectory() || e.name.startsWith(".")) return false;
    try {
      accessSync(join(account, e.name), constants.W_OK);
      return true;
    } catch {
      return false;
    }
  });
  if (candidates.length !== 1)
    throw new KaituError("无法确定我的云端硬盘目录，请指定 --drive-dir <路径>", "DRIVE_DIRECTORY");
  return join(account, candidates[0]?.name ?? "");
}

function move(source: string, target: string) {
  if (existsSync(target)) throw new KaituError(`目标已存在，未覆盖：${target}`, "TARGET_EXISTS");
  mkdirSync(dirname(target), { recursive: true });
  try {
    renameSync(source, target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
    try {
      cpSync(source, target, { recursive: true, errorOnExist: true, force: false });
    } catch (copyError) {
      rmSync(target, { recursive: true, force: true });
      throw copyError;
    }
    rmSync(source, { recursive: true });
  }
}

function separate(a: string, b: string) {
  const nested = (outer: string, inner: string) => {
    const rel = relative(outer, inner);
    return !rel || (!rel.startsWith("..") && !isAbsolute(rel));
  };
  if (nested(a, b) || nested(b, a)) throw new KaituError("迁移目录不能彼此包含", "BAD_ARGS");
}

function relocationNote(old: string, target: string) {
  mkdirSync(old, { recursive: true });
  writeFileSync(
    join(old, "WORKSPACE-MOVED.md"),
    `# 开图工作区已迁移\n\n当前位置：${target}\n\n运行 kaitu ui 打开。\n`,
  );
}

async function verify(ws: Workspace) {
  refreshOverview(ws);
  // 冲突副本只提示用户处理，不算迁移失败。
  const checks = (await doctor(ws)).filter((c) => c.name !== "无同步冲突副本");
  const issues = validateWorkspace(ws);
  if (checks.some((c) => !c.ok) || issues.length) {
    throw new KaituError(
      `迁移已完成到 ${ws.root}，但检查未通过：${checks
        .filter((c) => !c.ok)
        .map((c) => `${c.name} ${c.detail ?? ""}`)
        .join("；")}`,
      "MIGRATION_CHECK",
    );
  }
}

/** 设置页可直接选的默认同步目录：找不到或无法唯一确定时为 null。 */
function suggestedFolders() {
  let drive: string | null = null;
  try {
    drive = findDriveDirectory();
  } catch {}
  const icloud = iCloudDirectory();
  return {
    icloud: process.platform === "darwin" && existsSync(icloud) ? icloud : null,
    drive,
    nutstore: nutstoreDirectory(),
  };
}

export function syncStatus(ws: Workspace) {
  const state = stateDirectory(ws.root, ws.isICloud);
  const mode = syncMode(ws.root);
  const file = ".kaitu/inbox-state.json";
  return {
    mode,
    provider: syncProvider(ws.root, mode, state),
    suggested: suggestedFolders(),
    path: ws.root,
    drivePath: mode === "drive" ? ws.root : null,
    hint: mode === "icloud" ? `在 Finder 里对 ${basename(ws.root)} 文件夹选『始终保留下载』` : null,
    root: ws.root,
    stateDir: state,
    lastInboxProcessed: ws.exists(file) ? ws.readJson<{ lastProcessed: string }>(file).lastProcessed : null,
  };
}

const PROVIDER_NAMES: Record<SyncProvider, string> = {
  local: "本机",
  icloud: "iCloud",
  "google-drive": "Google Drive",
  nutstore: "坚果云",
  folder: "同步文件夹",
};

export async function enableSync(
  ws: Workspace,
  mode: Exclude<SyncMode, "local">,
  options: { dir?: string; name?: string; provider?: SyncProvider } = {},
) {
  if (mode !== "icloud" && mode !== "drive") throw new KaituError("请选择 icloud 或 drive", "BAD_ARGS");
  if (syncStatus(ws).mode !== "local")
    throw new KaituError("已在同步模式，请先运行 kaitu sync disable 搬回本机", "CONFLICT");
  if (mode === "icloud" && process.platform !== "darwin")
    throw new KaituError("iCloud 同步仅支持 macOS", "UNSUPPORTED_PLATFORM");
  const name = options.name ?? "kaitu";
  if (!name || name === "." || name === ".." || /[/\\]/.test(name))
    throw new KaituError("name 必须是单个目录名", "BAD_ARGS");
  const cloud = mode === "icloud" ? iCloudDirectory() : undefined;
  if (cloud && !existsSync(cloud))
    throw new KaituError("在系统设置 → Apple 账户 → iCloud 里打开 iCloud 云盘", "ICLOUD_DIRECTORY");
  if (mode === "drive" && (options.provider === "local" || options.provider === "icloud"))
    throw new KaituError("同步方式与云盘不一致", "BAD_ARGS");
  const nutstore = options.provider === "nutstore" && !options.dir ? nutstoreDirectory() : undefined;
  if (options.provider === "nutstore" && !options.dir && !nutstore)
    throw new KaituError(
      "未找到坚果云同步文件夹，请先在坚果云里设好同步文件夹，再用 --dir 指定它",
      "NUTSTORE_DIRECTORY",
    );
  if (options.provider === "folder" && !options.dir)
    throw new KaituError("请指定同步文件夹 --dir <路径>", "BAD_ARGS");
  const folder = resolve(options.dir ?? cloud ?? nutstore ?? findDriveDirectory());
  const provider: SyncProvider = mode === "icloud" ? "icloud" : (options.provider ?? folderProvider(folder));
  accessSync(folder, constants.W_OK);
  const old = ws.root;
  const target = join(folder, name);
  if (existsSync(target)) throw new KaituError(`目标已存在，未覆盖：${target}`, "TARGET_EXISTS");
  separate(old, target);
  const state = join(localStateRoot(), randomUUID());
  separate(state, target);
  separate(state, old);
  const config = ws.readJson<Record<string, unknown>>(".kaitu/config.json");
  refreshOverview(ws);
  move(join(old, ".kaitu"), state);
  try {
    setStateBinding(old, state, mode);
    mkdirSync(join(old, ".kaitu"));
    ws.writeJson(".kaitu/config.json", { ...config, state_dir: state }, { internal: true });
    writeFileSync(join(state, "sync-location.json"), `${JSON.stringify({ mode, provider })}\n`);
    // 配置留在同步文件夹，其他状态留在本机。
    rmSync(join(state, "config.json"));
    move(old, target);
  } catch (error) {
    rmSync(join(old, ".kaitu"), { recursive: true, force: true });
    move(state, join(old, ".kaitu"));
    setStateBinding(old, join(old, ".kaitu"), "local");
    ws.writeJson(".kaitu/config.json", config, { internal: true });
    refreshOverview(ws);
    throw error;
  }
  setStateBinding(target, state, mode, stateBinding(old).id);
  ws.root = target;
  rebaseProjectLinks(ws, old, target);
  remember(target);
  relocationNote(old, target);
  setStateBinding(old, join(old, ".kaitu"), "local", randomUUID());
  if (mode === "icloud") requestICloudDownload(target);
  await snapshot(ws, `开启 ${PROVIDER_NAMES[provider]} 同步`);
  await verify(ws);
  return syncStatus(ws);
}

export async function disableSync(ws: Workspace, options: { to?: string } = {}) {
  if (syncStatus(ws).mode === "local") throw new KaituError("当前是本地模式", "CONFLICT");
  const unavailable = ws.unavailableFiles();
  if (unavailable.length)
    throw new KaituError(
      `还没从 iCloud 下载：${unavailable.join("、")}，下载完成后再搬回本机`,
      "CLOUD_UNAVAILABLE",
    );
  const old = ws.root;
  const target = resolve(options.to ?? join(process.env.HOME || homedir(), "kaitu"));
  separate(old, target);
  const state = stateDirectory(old, ws.isICloud);
  separate(state, target);
  const config = ws.readJson<Record<string, unknown>>(".kaitu/config.json");
  // 只允许替换开图自己留下的迁移说明目录。
  if (existsSync(target)) {
    const entries = readdirSync(target);
    if (
      entries.length !== 1 ||
      entries[0] !== "WORKSPACE-MOVED.md" ||
      !readFileSync(join(target, entries[0]), "utf8").includes(old)
    ) {
      throw new KaituError(`目标已存在，未覆盖：${target}`, "TARGET_EXISTS");
    }
    rmSync(target, { recursive: true });
  }
  const extras = readdirSync(join(old, ".kaitu")).filter((file) => file !== "config.json");
  if (extras.length) throw new KaituError("同步文件夹的 .kaitu/ 有额外文件，请先核对再迁移", "CONFLICT");
  move(old, target);
  setStateBinding(target, join(target, ".kaitu"), "local", stateBinding(old).id);
  ws.root = target;
  try {
    rmSync(join(target, ".kaitu"), { recursive: true });
    move(state, join(target, ".kaitu"));
  } catch (error) {
    mkdirSync(join(target, ".kaitu"), { recursive: true });
    ws.writeJson(".kaitu/config.json", config, { internal: true });
    move(target, old);
    setStateBinding(old, state, syncMode(old));
    ws.root = old;
    throw error;
  }
  const { state_dir: _state, ...local } = config;
  ws.writeJson(".kaitu/config.json", local, { internal: true });
  rmSync(join(target, ".kaitu/sync-location.json"), { force: true });
  rebaseProjectLinks(ws, old, target);
  remember(target);
  relocationNote(old, target);
  setStateBinding(old, join(old, ".kaitu"), "local", randomUUID());
  await snapshot(ws, "关闭同步，搬回本机");
  await verify(ws);
  return syncStatus(ws);
}

export const driveStatus = syncStatus;
export const disableDrive = disableSync;

export function enableDrive(ws: Workspace, options: { driveDir?: string; name?: string } = {}) {
  return enableSync(ws, "drive", { dir: options.driveDir, name: options.name });
}

export async function moveWorkspace(ws: Workspace, target: string, drive: boolean, provider?: SyncProvider) {
  if (!isAbsolute(target)) throw new KaituError("请选择绝对路径", "BAD_ARGS");
  if (provider !== undefined && !syncProviders.includes(provider))
    throw new KaituError("不支持的同步方式", "BAD_ARGS");
  if (ws.exists(".kaitu/dsh-setup.json")) {
    const setup = ws.readJson<{ root?: string }>(".kaitu/dsh-setup.json");
    if (!setup.root) {
      setup.root = ws.root;
      ws.writeJson(".kaitu/dsh-setup.json", setup, { internal: true });
    }
  }
  const destination = resolve(target);
  const mode = driveStatus(ws).mode;
  if (drive && mode === "local")
    return enableSync(ws, provider === "icloud" ? "icloud" : "drive", {
      dir: dirname(destination),
      name: destination.split(/[\\/]/).at(-1),
      ...(provider === undefined || provider === "icloud" || provider === "local" ? {} : { provider }),
    });
  if (!drive && mode === "drive") return disableDrive(ws, { to: destination });
  const old = ws.root;
  separate(old, destination);
  await snapshot(ws, "迁移资料前保存");
  const state = stateDirectory(old);
  move(old, destination);
  setStateBinding(
    destination,
    mode === "local" ? join(destination, ".kaitu") : state,
    mode,
    stateBinding(old).id,
  );
  ws.root = destination;
  rebaseProjectLinks(ws, old, destination);
  remember(destination);
  relocationNote(old, destination);
  setStateBinding(old, join(old, ".kaitu"), "local", randomUUID());
  await snapshot(ws, "你更换了资料存放位置");
  await verify(ws);
  return driveStatus(ws);
}
