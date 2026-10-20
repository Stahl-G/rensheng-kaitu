import { execFile } from "node:child_process";
import { lstat, readdir } from "node:fs/promises";
import { join, matchesGlob, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { assertAgentPath } from "../core/dist/agent-file-policy.js";
import { agentCanRead } from "../core/dist/exposure.js";
import { Workspace } from "../core/dist/workspace.js";

const run = promisify(execFile);
export async function agentSearch(
  root,
  name,
  args,
  signal,
  executable,
  execute = run,
  connection = "local-ask",
) {
  const ws = new Workspace(root, { maintain: false });
  const base = assertAgentPath(root, resolve(root, args.path ?? "."));
  const files = [];
  let visited = 0;
  let rangeLimited = false;
  async function* walk(path) {
    signal?.throwIfAborted();
    if (rangeLimited) return;
    const info = await lstat(path);
    if (info.isSymbolicLink()) return;
    try {
      if (!agentCanRead(ws, path, connection)) return;
    } catch {
      return;
    }
    if (info.isDirectory()) {
      for (const entry of await readdir(path, { withFileTypes: true })) {
        if (rangeLimited) return;
        if ([".kaitu", ".git", "node_modules"].includes(entry.name)) continue;
        yield* walk(join(path, entry.name));
      }
    } else if (info.isFile()) {
      const filter = name === "glob" ? args.pattern : args.include;
      const pathName = relative(base, path) || relative(root, path);
      if (!filter || matchesGlob(pathName, filter) || matchesGlob(entryName(pathName), filter)) {
        if (++visited > 10000) {
          rangeLimited = true;
          return;
        }
        yield path;
      }
    }
  }
  const matches = [];
  const searchBatch = async (batch) => {
    for (const path of batch) assertAgentPath(root, path);
    let stdout;
    try {
      ({ stdout } = await execute(
        executable,
        ["--no-config", "--json", `--regexp=${args.pattern}`, "--", ...batch],
        { cwd: root, signal, timeout: 5000, maxBuffer: 1024 * 1024 },
      ));
    } catch (error) {
      if (error.code === 1) return;
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
  };
  let batch = [];
  for await (const path of walk(base)) {
    if (name === "glob") files.push(path);
    else {
      if (relative(root, path).replaceAll("\\", "/") === "memory/MEMORY.md") {
        // Its entries are already searched in the individual allowed memory files.
        continue;
      }
      batch.push(path);
      if (batch.length === 128) {
        await searchBatch(batch);
        batch = [];
        if (matches.length === 250) break;
      }
    }
  }
  if (name !== "glob" && batch.length && matches.length < 250) await searchBatch(batch);
  const scope = {
    scannedFiles: Math.min(visited, 10000),
    truncated: rangeLimited || matches.length === 250,
    ...(rangeLimited
      ? {
          reason:
            "仅搜索前 10000 个候选文件，请缩小目录继续搜索 / Partial results: candidate limit reached; narrow the directory",
        }
      : matches.length === 250
        ? { reason: "已达到 250 条结果上限，可能还有匹配 / Result limit reached; more matches may exist" }
        : {}),
  };
  if (name === "glob") return { root, paths: files.map((path) => relative(root, path)), ...scope };
  return { matches, ...scope };
}
function entryName(path) {
  return path.split(/[\\/]/).at(-1);
}
