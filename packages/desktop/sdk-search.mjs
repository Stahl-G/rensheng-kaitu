import { execFile } from "node:child_process";
import { lstat, readdir } from "node:fs/promises";
import { join, matchesGlob, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { assertAgentPath } from "../core/dist/agent-file-policy.js";

const run = promisify(execFile);
export async function agentSearch(root, name, args, signal, executable, execute = run) {
  const base = assertAgentPath(root, resolve(root, args.path ?? "."));
  const files = [];
  async function walk(path) {
    signal?.throwIfAborted();
    const info = await lstat(path);
    if (info.isSymbolicLink()) return;
    try {
      assertAgentPath(root, path);
    } catch {
      return;
    }
    if (info.isDirectory()) {
      for (const entry of await readdir(path, { withFileTypes: true })) {
        if ([".kaitu", ".git", "node_modules"].includes(entry.name)) continue;
        await walk(join(path, entry.name));
      }
    } else if (info.isFile()) {
      const filter = name === "glob" ? args.pattern : args.include;
      const pathName = relative(base, path) || relative(root, path);
      if (!filter || matchesGlob(pathName, filter) || matchesGlob(entryName(pathName), filter))
        files.push(path);
      if (files.length > 10000) throw new Error("搜索范围过大，请选择具体目录");
    }
  }
  await walk(base);
  if (name === "glob") return { root, paths: files.map((path) => relative(root, path)) };
  const matches = [];
  for (let offset = 0; offset < files.length && matches.length < 250; offset += 128) {
    const batch = files.slice(offset, offset + 128);
    for (const path of batch) assertAgentPath(root, path);
    let stdout;
    try {
      ({ stdout } = await execute(
        executable,
        ["--no-config", "--json", `--regexp=${args.pattern}`, "--", ...batch],
        { cwd: root, signal, timeout: 5000, maxBuffer: 1024 * 1024 },
      ));
    } catch (error) {
      if (error.code === 1) continue;
      throw error;
    }
    for (const line of stdout.split("\n").filter(Boolean)) {
      const row = JSON.parse(line);
      if (row.type !== "match" || !row.data.lines.text) continue;
      const matchedPath = assertAgentPath(root, row.data.path.text);
      if (!batch.includes(matchedPath)) throw new Error("搜索返回了范围外路径");
      matches.push({
        path: relative(root, matchedPath),
        lineNumber: row.data.line_number,
        line: row.data.lines.text.trimEnd().slice(0, 2000),
      });
      if (matches.length === 250) break;
    }
  }
  return { matches };
}
function entryName(path) {
  return path.split(/[\\/]/).at(-1);
}
