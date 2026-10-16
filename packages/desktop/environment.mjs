import { existsSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

export function desktopPaths(env = process.env) {
  const state = env.KAITU_APP_HOME || join(homedir(), ".kaitu-app");
  if (!isAbsolute(state)) throw new Error("KAITU_APP_HOME 必须是绝对路径");
  let workspace = env.KAITU_DIR || (env.KAITU_APP_HOME ? join(state, "workspace") : join(homedir(), "kaitu"));
  if (!env.KAITU_DIR && !env.KAITU_APP_HOME) {
    const pointer = join(homedir(), "Library/Application Support/kaitu/current-workspace.json");
    if (existsSync(pointer)) {
      const root = JSON.parse(readFileSync(pointer, "utf8")).root;
      if (typeof root === "string" && isAbsolute(root) && existsSync(join(root, ".kaitu/config.json")))
        workspace = root;
    }
  }
  if (!isAbsolute(workspace)) throw new Error("KAITU_DIR 必须是绝对路径");
  assertDesktopIsolation(workspace, state);
  const port = Number(env.KAITU_APP_PORT ?? 19487);
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw new Error("KAITU_APP_PORT 必须是 0–65535 的整数");
  return { state, workspace, port };
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
    (!isAbsolute(stateWithin) && stateWithin !== ".." && !stateWithin.startsWith("../"))
  )
    throw new Error("程序存放位置须在资料目录之外");
}
