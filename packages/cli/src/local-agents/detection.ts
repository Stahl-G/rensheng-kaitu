import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, readdir } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { delimiter, isAbsolute, join } from "node:path";
import { promisify } from "node:util";
import { agentDefinition, agentDefinitions } from "./registry.js";
import type { AgentDefinition, AgentStatus, LocalSelection } from "./types.js";

const exec = promisify(execFile);
export function agentEnvironment(source = process.env): NodeJS.ProcessEnv {
  const env = { ...source };
  for (const key of Object.keys(env))
    if (/(?:API_KEY|AUTH_TOKEN)$/i.test(key) || /^(?:KAITU_|DSH_|ELECTRON_|NODE_OPTIONS$)/.test(key))
      delete env[key];
  return env;
}
export async function resolveAgent(bin: string, env = agentEnvironment()): Promise<string | undefined> {
  const home = env.HOME ?? homedir();
  const directories = [
    ...(env.PATH ?? "").split(delimiter),
    join(home, ".local/bin"),
    join(home, ".npm-global/bin"),
    join(home, ".bun/bin"),
    join(home, ".volta/bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
  ];
  try {
    for (const version of await readdir(join(home, ".nvm/versions/node")))
      directories.push(join(home, ".nvm/versions/node", version, "bin"));
  } catch {
    /* Optional installation directory. */
  }
  for (const path of isAbsolute(bin) ? [bin] : directories.filter(Boolean).map((dir) => join(dir, bin))) {
    try {
      await access(path, constants.X_OK);
      return path;
    } catch {
      /* Try the next installation. */
    }
  }
}
async function probe(path: string, args: string[], env: NodeJS.ProcessEnv) {
  return exec(path, args, {
    cwd: tmpdir(),
    env,
    timeout: 5000,
    killSignal: "SIGKILL",
    maxBuffer: 128 * 1024,
  });
}
export async function detectAgent(def: AgentDefinition, env = agentEnvironment()): Promise<AgentStatus> {
  const path = await resolveAgent(def.bin, env);
  const result: AgentStatus = {
    id: def.id,
    name: def.name,
    path,
    status: path ? "unknown" : "missing",
    scoped: false,
    fullOnlyReason: def.fullOnlyReason,
  };
  if (!path) return result;
  if (def.format === "acp") {
    result.detail = "首次对话时验证协议与登录状态";
    return result;
  }
  try {
    const version = await probe(path, ["--version"], env);
    result.version = version.stdout.trim().split("\n")[0]?.slice(0, 120);
  } catch {
    result.status = "unavailable";
    result.detail = "无法运行版本检测，请检查安装";
    return result;
  }
  if (def.scopedFlags) {
    try {
      const help = await probe(path, def.helpArgs ?? ["--help"], env);
      result.scoped = def.scopedFlags.every((flag) => help.stdout.includes(flag));
    } catch {
      /* Unsupported versions remain full-mode only. */
    }
    if (!result.scoped)
      result.fullOnlyReason = "此版本缺少默认模式所需的工具与配置隔离参数，请升级或使用完整 Agent。";
  }
  if (def.authArgs) {
    try {
      const auth = await probe(path, def.authArgs, env);
      if (def.id === "claude") {
        const value = JSON.parse(auth.stdout);
        result.status = value.loggedIn === true ? "ready" : "signed-out";
      } else result.status = "ready";
    } catch (error) {
      const failure = error as { code?: number; stdout?: string; stderr?: string };
      result.status = failure.code === 1 ? "signed-out" : "unknown";
    }
  }
  if (result.status === "unknown") result.detail = "未提供可用的登录状态命令，首次对话时验证";
  return result;
}
export async function detectAgents(selection?: LocalSelection, env = agentEnvironment()) {
  const defs =
    selection?.agent === "custom-acp" ? [...agentDefinitions, agentDefinition(selection)] : agentDefinitions;
  return Promise.all(defs.map((def) => detectAgent(def, env)));
}
