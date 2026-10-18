import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { constants, accessSync, existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, extname, isAbsolute, join, resolve } from "node:path";
import { KaituError } from "@kaitu/core";

export function agentEnvironment(source = process.env): NodeJS.ProcessEnv {
  const env = { ...source };
  // 只去掉开图自己的变量和 Electron 的 Node 开关；CodeBuddy 自己的登录变量（如 CODEBUDDY_API_KEY）要留着。
  for (const key of Object.keys(env))
    if (/^(?:KAITU_|DSH_|ELECTRON_|NODE_OPTIONS$)/.test(key)) delete env[key];
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
export function findCodeBuddy(custom?: string, env = agentEnvironment()): string | undefined {
  const extensions = process.platform === "win32" ? [".exe", ".cmd", ".bat", ""] : [""];
  const candidates = custom
    ? [custom]
    : ["codebuddy", "cbc"].flatMap((name) =>
        (env.PATH ?? "").split(delimiter).flatMap((dir) => extensions.map((ext) => join(dir, name + ext))),
      );
  for (const candidate of candidates) {
    if (custom && !isAbsolute(candidate))
      throw new KaituError("请填写 CodeBuddy CLI 的绝对路径", "AI_CONFIG");
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
  bin: string,
  env: NodeJS.ProcessEnv,
  platform = process.platform,
): [string, ...string[]] {
  if (platform !== "win32" || !/\.(cmd|bat)$/i.test(bin)) return [bin];
  const sibling = bin.slice(0, -extname(bin).length);
  const text = existsSync(sibling) ? readFileSync(sibling, "utf8") : "";
  const match = /"\$basedir\/([^"\r\n]+)"\s+"\$@"/.exec(text);
  if (!match?.[1]) throw new KaituError("无法识别 CodeBuddy 启动文件，请填写原生程序的路径", "AI_CONNECTION");
  const entry = resolve(dirname(bin), match[1]);
  const node = [
    join(dirname(bin), "node.exe"),
    ...(env.PATH ?? "").split(delimiter).map((dir) => join(dir, "node.exe")),
  ].find(existsSync);
  if (!node || !existsSync(entry))
    throw new KaituError("CodeBuddy CLI 缺少 Node 或入口文件", "AI_CONNECTION");
  return [node, entry];
}
export function launchCodeBuddy(
  bin: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
): ChildProcessWithoutNullStreams {
  const [command, ...args] = cliCommand(bin, env);
  const childEnv = { ...env, PATH: [dirname(bin), env.PATH ?? ""].join(delimiter) };
  return spawn(command, [...args, "--acp"], {
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
