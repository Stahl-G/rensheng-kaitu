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
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { doctor } from "./doctor.js";
import { KaituError } from "./errors.js";
import { snapshot } from "./history.js";
import { refreshOverview } from "./overview.js";
import { rebaseProjectLinks, relocateProjects } from "./projects.js";
import { validateWorkspace } from "./validate.js";
import { type Workspace, stateDirectory } from "./workspace.js";

export function localStateRoot(env: NodeJS.ProcessEnv = process.env): string {
  const home = env.HOME || homedir();
  if (process.platform === "darwin") return join(home, "Library/Application Support/kaitu");
  if (process.platform === "win32") return join(env.LOCALAPPDATA || join(home, "AppData/Local"), "kaitu");
  return join(env.XDG_STATE_HOME || join(home, ".local/state"), "kaitu");
}

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
  const checks = await doctor(ws);
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

export function driveStatus(ws: Workspace) {
  const state = stateDirectory(ws.root);
  const drive = state !== join(ws.root, ".kaitu");
  const file = ".kaitu/inbox-state.json";
  return {
    mode: drive ? "drive" : "local",
    drivePath: drive ? ws.root : null,
    root: ws.root,
    stateDir: state,
    lastInboxProcessed: ws.exists(file) ? ws.readJson<{ lastProcessed: string }>(file).lastProcessed : null,
  };
}

export async function enableDrive(ws: Workspace, options: { driveDir?: string; name?: string } = {}) {
  if (driveStatus(ws).mode === "drive") throw new KaituError("已开启 Drive 模式", "CONFLICT");
  const name = options.name ?? "kaitu";
  if (!name || name === "." || name === ".." || /[/\\]/.test(name))
    throw new KaituError("name 必须是单个目录名", "BAD_ARGS");
  const drive = resolve(options.driveDir ?? findDriveDirectory());
  accessSync(drive, constants.W_OK);
  const old = ws.root;
  const target = join(drive, name);
  if (existsSync(target)) throw new KaituError(`目标已存在，未覆盖：${target}`, "TARGET_EXISTS");
  separate(old, target);
  const state = join(localStateRoot(), randomUUID());
  separate(state, target);
  separate(state, old);
  const config = ws.readJson<Record<string, unknown>>(".kaitu/config.json");
  relocateProjects(ws, true);
  refreshOverview(ws);
  move(join(old, ".kaitu"), state);
  try {
    mkdirSync(join(old, ".kaitu"));
    ws.writeJson(".kaitu/config.json", { ...config, state_dir: state }, { internal: true });
    // 配置必须在同步工作区内，其他状态从未进入 Drive。
    rmSync(join(state, "config.json"));
    move(old, target);
  } catch (error) {
    rmSync(join(old, ".kaitu"), { recursive: true, force: true });
    move(state, join(old, ".kaitu"));
    ws.writeJson(".kaitu/config.json", config, { internal: true });
    relocateProjects(ws, false);
    refreshOverview(ws);
    throw error;
  }
  ws.root = target;
  rebaseProjectLinks(ws, old, target);
  remember(target);
  relocationNote(old, target);
  await snapshot(ws, "开启 Google Drive 同步");
  await verify(ws);
  return driveStatus(ws);
}

export async function disableDrive(ws: Workspace, options: { to?: string } = {}) {
  if (driveStatus(ws).mode !== "drive") throw new KaituError("当前是本地模式", "CONFLICT");
  const old = ws.root;
  const target = resolve(options.to ?? join(process.env.HOME || homedir(), "kaitu"));
  separate(old, target);
  const state = stateDirectory(old);
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
  if (extras.length) throw new KaituError("Drive 的 .kaitu/ 有额外文件，请先核对再迁移", "CONFLICT");
  move(old, target);
  ws.root = target;
  try {
    rmSync(join(target, ".kaitu"), { recursive: true });
    move(state, join(target, ".kaitu"));
  } catch (error) {
    mkdirSync(join(target, ".kaitu"), { recursive: true });
    ws.writeJson(".kaitu/config.json", config, { internal: true });
    move(target, old);
    ws.root = old;
    throw error;
  }
  const { state_dir: _state, ...local } = config;
  ws.writeJson(".kaitu/config.json", local, { internal: true });
  relocateProjects(ws, false);
  rebaseProjectLinks(ws, old, target);
  remember(target);
  relocationNote(old, target);
  await snapshot(ws, "关闭 Google Drive 同步，搬回本机");
  await verify(ws);
  return driveStatus(ws);
}
