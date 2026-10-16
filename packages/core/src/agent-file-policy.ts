import { existsSync, lstatSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { ScopeError } from "./errors.js";
import { localStateRoot } from "./local-state.js";

export function assertAgentPath(root: string, path: string): string {
  const target = resolve(root, path);
  const home = resolve(process.env.KAITU_APP_HOME || join(process.env.HOME || homedir(), ".kaitu-app"));
  const inside = (base: string, path: string) => {
    const rel = relative(base, path);
    return rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`));
  };
  const managed = [localStateRoot(), ...(inside(root, home) ? [home] : [])];
  if (managed.some((directory) => inside(directory, target)))
    throw new ScopeError("本机程序状态不对 AI 开放");
  const check = (base: string, value: string) => {
    const rel = relative(base, value);
    if (
      isAbsolute(rel) ||
      rel === ".." ||
      rel.startsWith(`..${sep}`) ||
      rel.split(sep).some((part) => part === ".kaitu" || part === ".git")
    )
      throw new ScopeError("只能访问开图资料，程序目录不对 AI 开放");
  };
  check(root, target);
  let probe = target;
  while (!existsSync(probe)) {
    try {
      if (lstatSync(probe).isSymbolicLink()) throw new ScopeError("不能访问失效链接");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const parent = dirname(probe);
    if (parent === probe) break;
    probe = parent;
  }
  const realTarget = realpathSync(probe);
  check(realpathSync(root), realTarget);
  for (const directory of [...managed, join(root, ".kaitu"), join(root, ".git")]) {
    if (!existsSync(directory)) continue;
    const rel = relative(realpathSync(directory), realTarget);
    if (rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`)))
      throw new ScopeError("程序状态不对 AI 开放");
  }
  return target;
}

export function agentRelativePath(root: string, file: string): string {
  const target = assertAgentPath(root, file);
  let probe = target;
  while (!existsSync(probe)) probe = dirname(probe);
  return relative(realpathSync(root), resolve(realpathSync(probe), relative(probe, target)))
    .split(sep)
    .join("/");
}

export function assertAgentWrite(root: string, file: string, confirmed = false, managedPlan = false): string {
  const path = agentRelativePath(root, file);
  if (
    (path === "NOW.md" && !managedPlan) ||
    ["AGENTS.md", "AGENT-README.md", "ORGANIZER.md", "OVERVIEW.md"].includes(path) ||
    path.startsWith("memory/") ||
    path.startsWith("chats/") ||
    (path.includes("/data/") && !/^health\/data\/labs\/[^/]+\.json$/.test(path))
  )
    throw new ScopeError("此路径由开图管理，请用专用工具");
  if (["me/rules.md", "me/goals.json"].includes(path) && !confirmed)
    throw new ScopeError("规则或目标变更须用户确认");
  return path;
}
