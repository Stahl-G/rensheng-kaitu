import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  rmdirSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { KaituError } from "./errors.js";
import { localStateRoot } from "./local-state.js";
import { readWorkspaceConfig } from "./sync-files.js";

interface Binding {
  id: string;
  root: string;
  state: string;
  realState: string;
  migrating: boolean;
  mode: "local" | "drive" | "icloud";
}
function canonical(path: string): string {
  let probe = resolve(path);
  while (!existsSync(probe)) {
    try {
      if (lstatSync(probe).isSymbolicLink())
        throw new KaituError("状态路径包含失效链接", "INVALID_STATE_DIR");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    probe = dirname(probe);
  }
  return resolve(realpathSync(probe), relative(probe, resolve(path)));
}
function inside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`));
}
function bindingFile(root: string): string {
  return join(
    localStateRoot(),
    "workspaces",
    `${createHash("sha256").update(canonical(root)).digest("hex")}.json`,
  );
}
export function setStateBinding(
  root: string,
  state: string,
  mode: Binding["mode"],
  identity?: string,
  migrating = false,
): Binding {
  const file = bindingFile(root);
  const old = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Binding) : undefined;
  const binding = {
    id: identity ?? old?.id ?? randomUUID(),
    root: canonical(root),
    state: resolve(state),
    migrating,
    realState: canonical(state),
    mode,
  };
  mkdirSync(join(localStateRoot(), "workspaces"), { recursive: true, mode: 0o700 });
  const temp = `${file}.${randomUUID()}.tmp`;
  writeFileSync(temp, JSON.stringify(binding), { mode: 0o600 });
  renameSync(temp, file);
  return binding;
}
function cloudMode(root: string): Binding["mode"] {
  const home = process.env.HOME || homedir();
  if (
    process.platform === "darwin" &&
    inside(canonical(join(home, "Library/Mobile Documents/com~apple~CloudDocs")), canonical(root))
  )
    return "icloud";
  const parts = canonical(root).split(sep);
  return parts.some((part) => /^(?:GoogleDrive(?:-|$)|My Drive$|我的云端硬盘$|我的雲端硬碟$)/i.test(part))
    ? "drive"
    : "local";
}
export function stateBinding(root: string, icloud?: boolean, persist = true): Binding {
  const file = bindingFile(root);
  if (existsSync(file)) {
    const binding = JSON.parse(readFileSync(file, "utf8")) as Binding;
    if (binding.root !== canonical(root) || binding.realState !== canonical(binding.state))
      throw new KaituError("状态目录真实位置已变化，请在设置中重新迁移", "INVALID_STATE_DIR");
    return binding;
  }
  let state = join(root, ".kaitu");
  let mode = cloudMode(root);
  const config = join(root, ".kaitu/config.json");
  if (!existsSync(config))
    return { id: "", root: canonical(root), state, realState: canonical(state), mode, migrating: false };
  if (!inside(canonical(root), realpathSync(config)))
    throw new KaituError("工作区配置不能指向外部文件", "OUT_OF_SCOPE");
  const legacy = readWorkspaceConfig(root, icloud).state_dir;
  if (legacy !== undefined) {
    if (typeof legacy !== "string" || !isAbsolute(legacy))
      throw new KaituError("state_dir 必须是本机绝对路径", "INVALID_STATE_DIR");
    if (existsSync(legacy) && lstatSync(legacy).isSymbolicLink())
      throw new KaituError("旧状态目录不能是符号链接", "INVALID_STATE_DIR");
    if (!inside(canonical(localStateRoot()), canonical(legacy))) {
      const id = legacy.split(/[\\/]/).at(-1) ?? "";
      if (existsSync(legacy) || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(id))
        throw new KaituError("旧状态目录不在本机状态根目录下，请先迁移资料", "INVALID_STATE_DIR");
      state = join(localStateRoot(), id);
    } else state = legacy;
    if (
      canonical(state) === canonical(localStateRoot()) ||
      inside(canonical(join(localStateRoot(), "workspaces")), canonical(state))
    )
      throw new KaituError("不能把本机状态根目录或登记表用作工作区状态", "INVALID_STATE_DIR");
    const registry = join(localStateRoot(), "workspaces");
    if (existsSync(registry))
      for (const entry of readdirSync(registry)) {
        if (!entry.endsWith(".json")) continue;
        const owner = JSON.parse(readFileSync(join(registry, entry), "utf8")) as Binding;
        if (
          owner.root !== canonical(root) &&
          (inside(canonical(owner.state), canonical(state)) ||
            inside(canonical(state), canonical(owner.state)))
        )
          throw new KaituError("状态目录已属于另一工作区", "INVALID_STATE_DIR");
      }
    const marker = join(state, "sync-location.json");
    const previous = existsSync(marker) ? JSON.parse(readFileSync(marker, "utf8")).mode : mode;
    mode = previous === "icloud" ? "icloud" : "drive";
  } else if (mode !== "local") state = join(localStateRoot(), randomUUID());
  const migrating = canonical(state) !== canonical(join(root, ".kaitu"));
  if (!persist) return { id: "", root: canonical(root), state, realState: canonical(state), mode, migrating };
  return setStateBinding(root, state, mode, undefined, migrating);
}

function moveStateEntry(source: string, target: string): void {
  const info = lstatSync(source);
  if (existsSync(target)) {
    const other = lstatSync(target);
    if (other.isSymbolicLink() || info.isDirectory() !== other.isDirectory())
      throw new KaituError("旧状态与本机状态冲突", "STATE_MIGRATION");
    if (info.isFile()) {
      if (!readFileSync(source).equals(readFileSync(target)))
        throw new KaituError("旧状态与本机状态冲突", "STATE_MIGRATION");
      rmSync(source);
      return;
    }
  } else {
    try {
      renameSync(source, target);
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
    }
  }
  if (info.isDirectory()) {
    mkdirSync(target, { recursive: true, mode: 0o700 });
    for (const name of readdirSync(source)) moveStateEntry(join(source, name), join(target, name));
    rmdirSync(source);
    return;
  }
  const temp = `${target}.${randomUUID()}.tmp`;
  try {
    copyFileSync(source, temp);
    chmodSync(temp, info.mode & 0o777);
    if (!readFileSync(source).equals(readFileSync(temp)))
      throw new KaituError("复制期间旧状态发生变化", "STATE_MIGRATION");
    renameSync(temp, target);
    rmSync(source);
  } finally {
    rmSync(temp, { force: true });
  }
}

export function migrateWorkspaceState(root: string): void {
  const binding = stateBinding(root);
  if (!binding.migrating) return;
  const state = binding.state;
  const source = join(root, ".kaitu");
  if (canonical(state) === canonical(source) || !existsSync(source)) return;
  const check = (path: string) => {
    if (lstatSync(path).isSymbolicLink()) throw new KaituError("旧状态目录包含符号链接", "INVALID_STATE_DIR");
    const info = lstatSync(path);
    if (!info.isDirectory() && !info.isFile())
      throw new KaituError("旧状态包含非普通文件", "INVALID_STATE_DIR");
    if (info.isDirectory()) for (const name of readdirSync(path)) check(join(path, name));
  };
  const entries = readdirSync(source).filter((name) => name !== "config.json");
  for (const name of entries) check(join(source, name));
  mkdirSync(state, { recursive: true, mode: 0o700 });
  for (const name of entries) {
    moveStateEntry(join(source, name), join(state, name));
  }
  setStateBinding(root, state, binding.mode, binding.id);
}
