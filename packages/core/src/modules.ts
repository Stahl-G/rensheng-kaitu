import { existsSync, lstatSync, readdirSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { KaituError } from "./errors.js";
import { schemas } from "./schema.js";
import type { Workspace } from "./workspace.js";

export interface RecordDef {
  path: string;
  schema: string;
  label?: string;
}

export interface ModuleDef {
  id: string;
  name: string;
  version: number;
  visibility: "nav" | "agent";
  description?: string;
  tabs?: string[];
  records?: Record<string, RecordDef>;
  views?: unknown[];
  sources?: { type: string; id?: string }[];
  agent?: { instructions?: string };
}

export interface LoadedModule {
  dir: string;
  def: ModuleDef;
}

const NOT_MODULES = new Set([".kaitu", ".git", "memory", "chats", "inbox", "node_modules", "phone"]);

const loaded = new WeakMap<Workspace, { key: string; modules: LoadedModule[] }>();

/** 按实际目录解析模块身份，与模块清单使用同一份定义和校验。 */
export function moduleAtDirectory(ws: Workspace, dir: string): LoadedModule | undefined {
  if (!dir || NOT_MODULES.has(dir) || dir.startsWith(".") || /[/\\]/.test(dir)) return;
  const full = ws.resolve(dir);
  if (!existsSync(full) || !lstatSync(full).isDirectory() || !ws.exists(`${dir}/module.json`)) return;
  const def = ws.scanParsed<ModuleDef>(`${dir}/module.json`, "module-definition", (text) => {
    const value = JSON.parse(text) as ModuleDef;
    if (!schemas().builtin("module.schema.json")(value))
      throw new KaituError(`模块定义不合法：${dir}`, "INVALID_CONFIG");
    return value;
  });
  if (!def) throw new KaituError(`模块资料暂不可读：${dir}`, "CLOUD_UNAVAILABLE");
  return { dir, def };
}

/** 工作区顶层含 module.json 的目录即模块；module.json 没变就用上次读到的结果。 */
export function listModules(ws: Workspace): LoadedModule[] {
  const names = readdirSync(ws.root).sort();
  const key = names
    .map((name) => {
      try {
        return `${name}:${statSync(join(ws.root, name, "module.json")).mtimeMs}`;
      } catch {
        return "";
      }
    })
    .join("|");
  const cached = loaded.get(ws);
  if (cached?.key === key) return cached.modules;
  const out: LoadedModule[] = [];
  for (const name of names) {
    if (ws.conflictCopy(name)) continue;
    try {
      const module = moduleAtDirectory(ws, name);
      if (module) out.push(module);
    } catch {
      // 损坏的 module.json 由 validate 报告，这里跳过
    }
  }
  loaded.set(ws, { key, modules: out });
  return out;
}

export interface RecordTypeRef {
  type: string;
  module: LoadedModule;
  def: RecordDef;
}

export function listRecordTypes(ws: Workspace): RecordTypeRef[] {
  const out: RecordTypeRef[] = [];
  for (const m of listModules(ws)) {
    for (const [type, def] of Object.entries(m.def.records ?? {})) out.push({ type, module: m, def });
  }
  return out;
}

export function findRecordType(
  ws: Workspace,
  type: string,
  types: readonly RecordTypeRef[] = listRecordTypes(ws),
): RecordTypeRef {
  const hits = types.filter((r) => r.type === type);
  if (hits.length === 0) throw new KaituError(`没有模块定义记录类型「${type}」`, "UNKNOWN_TYPE");
  if (hits.length > 1) {
    throw new KaituError(
      `记录类型「${type}」被多个模块定义：${hits.map((h) => h.module.dir).join("、")}`,
      "AMBIGUOUS_TYPE",
    );
  }
  return hits[0] as RecordTypeRef;
}

/** {YYYY-MM} 模板 → 该类型所在目录与文件名正则。 */
export function recordFilePattern(ref: RecordTypeRef): { dir: string; match: RegExp } {
  const full = `${ref.module.dir}/${ref.def.path}`;
  const slash = full.lastIndexOf("/");
  const file = full.slice(slash + 1);
  const [pre, post] = file.split("{YYYY-MM}") as [string, string];
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return { dir: full.slice(0, slash), match: new RegExp(`^${esc(pre)}(\\d{4}-\\d{2})${esc(post)}$`) };
}

export function recordFileFor(ref: RecordTypeRef, month: string): string {
  return `${ref.module.dir}/${ref.def.path.replace("{YYYY-MM}", month)}`;
}

export function resolveRecordPath(ws: Workspace, ref: RecordTypeRef, file: string): string {
  const base = ws.resolve(ref.module.dir);
  const target = ws.resolve(file);
  const inside = (root: string, path: string) => {
    const rel = relative(root, path);
    return rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`));
  };
  if (!inside(base, target)) throw new KaituError("记录路径超出模块目录", "OUT_OF_SCOPE");
  let probe = target;
  while (!existsSync(probe)) {
    const parent = dirname(probe);
    if (parent === probe) break;
    probe = parent;
  }
  if (!inside(realpathSync(base), realpathSync(probe)))
    throw new KaituError("记录路径经符号链接超出模块目录", "OUT_OF_SCOPE");
  return target;
}
