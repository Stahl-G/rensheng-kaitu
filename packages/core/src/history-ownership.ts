import { existsSync, lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { inflateSync } from "node:zlib";

export const HISTORY_MARKER = "kaitu-internal-history";

/** 旧版只写 loose objects。没有明确的开图来源就保留用户的 .git。 */
export function ownsLegacyHistory(gitdir: string): boolean {
  if (!existsSync(gitdir) || !lstatSync(gitdir).isDirectory() || lstatSync(gitdir).isSymbolicLink())
    return false;
  try {
    const config = readFileSync(join(gitdir, "config"), "utf8");
    if (/\[remote\s/i.test(config)) return false;
    if (existsSync(join(gitdir, HISTORY_MARKER))) return true;
    let head = readFileSync(join(gitdir, "HEAD"), "utf8").trim();
    if (head.startsWith("ref: ")) head = readFileSync(join(gitdir, head.slice(5)), "utf8").trim();
    const pending = [head];
    const seen = new Set<string>();
    let initial = false;
    while (pending.length) {
      const oid = pending.pop() as string;
      if (seen.has(oid)) continue;
      seen.add(oid);
      if (!/^[a-f0-9]{40}$/.test(oid)) return false;
      const object = inflateSync(
        readFileSync(join(gitdir, "objects", oid.slice(0, 2), oid.slice(2))),
      ).toString();
      if (!object.startsWith("commit ")) return false;
      const body = object.slice(object.indexOf("\0") + 1);
      if (!/^author 开图 <kaitu@localhost> /m.test(body) || !/^committer 开图 <kaitu@localhost> /m.test(body))
        return false;
      const parents = [...body.matchAll(/^parent ([a-f0-9]{40})$/gm)].map((m) => m[1] as string);
      if (!parents.length) {
        if (body.split("\n\n").slice(1).join("\n\n").trim() !== "初始化开图工作区") return false;
        initial = true;
      }
      pending.push(...parents);
    }
    return initial;
  } catch {
    return false;
  }
}
