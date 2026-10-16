import { existsSync, lstatSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { ScopeError } from "./errors.js";
import { localStateRoot } from "./local-state.js";

export function assertAgentPath(root: string, path: string): string {
  const target = resolve(root, path);
  const state = relative(localStateRoot(), target);
  if (state === "" || (!isAbsolute(state) && state !== ".." && !state.startsWith(`..${sep}`)))
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
  for (const directory of [localStateRoot(), join(root, ".kaitu"), join(root, ".git")]) {
    if (!existsSync(directory)) continue;
    const rel = relative(realpathSync(directory), realTarget);
    if (rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`)))
      throw new ScopeError("程序状态不对 AI 开放");
  }
  return target;
}
