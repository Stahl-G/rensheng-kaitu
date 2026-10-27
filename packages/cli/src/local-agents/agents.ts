import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { constants, accessSync, existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, extname, isAbsolute, join, resolve } from "node:path";
import { KaituError } from "@kaitu/core";

export interface LocalAgent {
  id: string;
  name: string;
  bins: string[];
  /** 让 CLI 以 ACP 方式在 stdio 上运行的参数。 */
  args: string[];
  /** 这个 agent 自己的登录变量前缀，其余密钥不传给它。 */
  env: string[];
  /** 已核实为逐动作审查、保留拒绝的原生模式；不按名字猜其他 Agent 的 Auto 语义。 */
  autoMode?: string;
}
// 启动参数参考 Open Design 的 runtime 清单（Apache-2.0）；claude、codex 用 Zed 的 ACP 适配器。
export const localAgents: LocalAgent[] = [
  {
    id: "codebuddy",
    name: "CodeBuddy",
    bins: ["codebuddy", "cbc"],
    args: ["--acp"],
    env: ["CODEBUDDY_"],
    autoMode: "auto",
  },
  { id: "claude", name: "Claude Code", bins: ["claude-agent-acp"], args: [], env: ["ANTHROPIC_", "CLAUDE_"] },
  { id: "codex", name: "Codex", bins: ["codex-acp"], args: [], env: ["OPENAI_", "CODEX_"] },
  { id: "opencode", name: "OpenCode", bins: ["opencode"], args: ["acp"], env: ["OPENCODE_"] },
  { id: "kimi", name: "Kimi Code", bins: ["kimi"], args: ["acp"], env: ["KIMI_", "MOONSHOT_"] },
  { id: "hermes", name: "Hermes", bins: ["hermes"], args: ["acp"], env: ["HERMES_"] },
  {
    id: "reasonix",
    name: "DeepSeek Reasonix",
    bins: ["reasonix", "dsnix"],
    args: ["acp"],
    env: ["DEEPSEEK_"],
  },
  { id: "kilo", name: "Kilo", bins: ["kilo"], args: ["acp"], env: ["KILO_"] },
  { id: "kiro", name: "Kiro", bins: ["kiro-cli"], args: ["acp"], env: ["KIRO_"] },
  { id: "vibe", name: "Mistral Vibe", bins: ["vibe-acp"], args: [], env: ["MISTRAL_"] },
];
export function localAgent(id = "codebuddy"): LocalAgent {
  const agent = localAgents.find((item) => item.id === id);
  if (!agent) throw new KaituError("不支持这个本机 Agent", "AI_CONFIG");
  return agent;
}
export function agentEnvironment(agent: LocalAgent, source = process.env): NodeJS.ProcessEnv {
  const env = { ...source };
  // 去掉开图自己的变量、Electron 的 Node 开关和别家的密钥；只留这个 agent 自己的登录变量（如 CODEBUDDY_API_KEY）。
  for (const key of Object.keys(env))
    if (
      /^(?:KAITU_|DSH_|ELECTRON_|NODE_OPTIONS$)/.test(key) ||
      (!agent.env.some((prefix) => key.startsWith(prefix)) &&
        /KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL/i.test(key))
    )
      delete env[key];
  const home = env.HOME ?? env.USERPROFILE ?? homedir();
  let nvmBins: string[] = [];
  try {
    nvmBins = readdirSync(join(home, ".nvm/versions/node"))
      .sort()
      .reverse()
      .map((version) => join(home, ".nvm/versions/node", version, "bin"));
  } catch {
    /* Optional installation directory. */
  }
  env.PATH = [
    ...new Set(
      [
        ...(env.PATH ?? env.Path ?? "").split(delimiter),
        join(home, ".local/bin"),
        join(home, ".kimi-code/bin"),
        join(home, ".opencode/bin"),
        join(home, ".npm-global/bin"),
        join(home, ".volta/bin"),
        ...nvmBins,
        ...(env.APPDATA ? [join(env.APPDATA, "npm")] : []),
        "/opt/homebrew/bin",
        "/usr/local/bin",
      ].filter(Boolean),
    ),
  ].join(delimiter);
  const { Path: _path, ...normalized } = env;
  return normalized;
}
export function findAgent(
  agent: LocalAgent,
  custom: string | undefined,
  env: NodeJS.ProcessEnv,
): string | undefined {
  const extensions = process.platform === "win32" ? [".exe", ".cmd", ".bat", ""] : [""];
  const candidates = custom
    ? [custom]
    : agent.bins.flatMap((name) =>
        (env.PATH ?? "").split(delimiter).flatMap((dir) => extensions.map((ext) => join(dir, name + ext))),
      );
  for (const candidate of candidates) {
    if (custom && !isAbsolute(candidate))
      throw new KaituError(`请填写 ${agent.name} CLI 的绝对路径`, "AI_CONFIG");
    try {
      accessSync(candidate, constants.X_OK);
      if (statSync(candidate).isFile()) return resolve(candidate);
    } catch {
      /* Next installed entry. */
    }
  }
}
/** Resolve a standard npm shim without running a shell or interpreting user command strings. */
export function cliCommand(
  binary: string,
  env: NodeJS.ProcessEnv,
  platform = process.platform,
): [string, ...string[]] {
  let bin = binary;
  if (platform === "win32" && !isAbsolute(bin) && !/[\\/]/.test(bin)) {
    bin =
      (env.PATH ?? "")
        .split(delimiter)
        .flatMap((dir) => [".exe", ".cmd", ".bat", ""].map((ext) => join(dir, bin + ext)))
        .find((path) => existsSync(path) && statSync(path).isFile()) ?? bin;
  }
  if (platform !== "win32" || !/\.(cmd|bat)$/i.test(bin)) return [bin];
  const sibling = bin.slice(0, -extname(bin).length);
  const text = existsSync(sibling) ? readFileSync(sibling, "utf8") : "";
  const match = /"\$basedir\/([^"\r\n]+)"\s+"\$@"/.exec(text);
  if (!match?.[1]) throw new KaituError("无法识别 CLI 启动文件，请填写原生程序的路径", "AI_CONNECTION");
  const entry = resolve(dirname(bin), match[1]);
  const node = [
    join(dirname(bin), "node.exe"),
    ...(env.PATH ?? "").split(delimiter).map((dir) => join(dir, "node.exe")),
  ].find(existsSync);
  if (!node || !existsSync(entry)) throw new KaituError("CLI 缺少 Node 或入口文件", "AI_CONNECTION");
  return [node, entry];
}
export function launchAgent(
  agent: LocalAgent,
  bin: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
): ChildProcessWithoutNullStreams {
  const [command, ...args] = cliCommand(bin, env);
  const childEnv = { ...env, PATH: [dirname(bin), env.PATH ?? ""].join(delimiter) };
  return spawn(command, [...args, ...agent.args], {
    cwd,
    env: childEnv,
    windowsHide: true,
    detached: process.platform !== "win32",
    stdio: ["pipe", "pipe", "pipe"],
  });
}
export async function terminateAgent(child: ChildProcessWithoutNullStreams) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((resolve) => child.once("close", () => resolve()));
  if (process.platform === "win32") {
    // Only this owned execution tree, never processes selected by executable name.
    const killer = spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    });
    killer.on("error", () => child.kill());
  } else {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      child.kill();
    }
  }
  const pid = child.pid;
  const timer = setTimeout(() => {
    if (process.platform !== "win32") {
      try {
        process.kill(-pid, "SIGKILL");
      } catch {
        /* Exited. */
      }
    } else child.kill();
  }, 1200);
  timer.unref();
  await Promise.race([exited, new Promise<void>((resolve) => setTimeout(resolve, 2500).unref())]);
  clearTimeout(timer);
}
