import { existsSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export function desktopPaths(env = process.env) {
  const state = env.KAITU_APP_HOME || join(homedir(), ".kaitu-app");
  if (!isAbsolute(state)) throw new Error("KAITU_APP_HOME 必须是绝对路径");
  const legacy = join(homedir(), "kaitu");
  let workspace =
    env.KAITU_DIR ||
    (env.KAITU_APP_HOME
      ? join(state, "workspace")
      : // 有 ~/kaitu 就照旧用它，包括搬去云盘后只剩迁移说明的情况：云盘暂时没挂上时报不可用，不另建空库。
        existsSync(legacy)
        ? legacy
        : join(homedir(), "kaitu-ai-memory"));
  let createWorkspace = true;
  let workspaceError;
  if (!env.KAITU_DIR && !env.KAITU_APP_HOME) {
    const localState =
      env.KAITU_LOCAL_STATE_DIR ||
      (process.platform === "win32"
        ? join(env.LOCALAPPDATA || join(homedir(), "AppData/Local"), "kaitu")
        : process.platform === "darwin"
          ? join(homedir(), "Library/Application Support/kaitu")
          : join(env.XDG_STATE_HOME || join(homedir(), ".local/state"), "kaitu"));
    const pointer = join(localState, "current-workspace.json");
    if (existsSync(pointer)) {
      // 绑定失效也保留原位置，交给窗口里的恢复入口；不能回退后另建空库。
      createWorkspace = false;
      try {
        const root = JSON.parse(readFileSync(pointer, "utf8")).root;
        if (typeof root !== "string" || !isAbsolute(root)) throw new Error("资料位置记录无效");
        workspace = root;
      } catch (error) {
        workspaceError = error;
      }
    }
  }
  if (!isAbsolute(workspace)) throw new Error("KAITU_DIR 必须是绝对路径");
  assertDesktopIsolation(workspace, state);
  const port = Number(env.KAITU_APP_PORT ?? 19487);
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw new Error("KAITU_APP_PORT 必须是 0–65535 的整数");
  return { state, workspace, port, createWorkspace, workspaceError };
}

export function assertDesktopIsolation(workspace, state) {
  const real = (path) => {
    let probe = resolve(path);
    while (!existsSync(probe) && dirname(probe) !== probe) probe = dirname(probe);
    return resolve(realpathSync(probe), relative(probe, resolve(path)));
  };
  const stateWithin = relative(real(workspace), real(state));
  if (
    stateWithin === "" ||
    (!isAbsolute(stateWithin) && stateWithin !== ".." && !stateWithin.startsWith(`..${sep}`))
  )
    throw new Error("程序存放位置须在资料目录之外");
}
