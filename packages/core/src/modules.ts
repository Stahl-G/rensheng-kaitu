import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { KaituError } from "./errors.js";
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

const NOT_MODULES = new Set([".kaitu", ".git", "memory", "chats", "inbox", "node_modules"]);

/** 工作区顶层含 module.json 的目录即模块。 */
export function listModules(ws: Workspace): LoadedModule[] {
  const out: LoadedModule[] = [];
  for (const name of readdirSync(ws.root).sort()) {
    if (ws.conflictCopy(name)) continue;
    if (NOT_MODULES.has(name) || name.startsWith(".")) continue;
    const full = join(ws.root, name);
    if (!statSync(full).isDirectory() || !ws.exists(`${name}/module.json`)) continue;
    try {
      out.push({ dir: name, def: ws.readJson<ModuleDef>(`${name}/module.json`) });
    } catch {
      // 损坏的 module.json 由 validate 报告，这里跳过
    }
  }
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

export function findRecordType(ws: Workspace, type: string): RecordTypeRef {
  const hits = listRecordTypes(ws).filter((r) => r.type === type);
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
