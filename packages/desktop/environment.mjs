import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

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
  const port = Number(env.KAITU_APP_PORT ?? 19487);
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw new Error("KAITU_APP_PORT 必须是 0–65535 的整数");
  return { state, workspace, port };
}
