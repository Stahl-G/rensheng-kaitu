import { homedir } from "node:os";
import { join, resolve } from "node:path";

export function localStateRoot(env: NodeJS.ProcessEnv = process.env): string {
  if (env.KAITU_LOCAL_STATE_DIR) return resolve(env.KAITU_LOCAL_STATE_DIR);
  const home = env.HOME || homedir();
  if (process.platform === "darwin") return join(home, "Library/Application Support/kaitu");
  if (process.platform === "win32") return join(env.LOCALAPPDATA || join(home, "AppData/Local"), "kaitu");
  return join(env.XDG_STATE_HOME || join(home, ".local/state"), "kaitu");
}
