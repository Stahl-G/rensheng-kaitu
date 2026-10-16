import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { parseFrontmatter } from "./frontmatter.js";
import { findRecordType, listRecordTypes, recordFilePattern } from "./modules.js";
import type { RecordTypeRef } from "./modules.js";
import { projectStatusFiles, publicProject } from "./projects.js";
import { recordLines } from "./records.js";
import type { StoredRecord } from "./records.js";
import { Workspace, stateDirectory } from "./workspace.js";

export function localRecordStore(ws: Workspace, ref?: RecordTypeRef): Workspace {
  const root = ws.resolve(".kaitu/local-projects", { internal: true });
  mkdirSync(root, { recursive: true });
  const store = new Workspace(root, { maintain: false, privateRecords: true });
  store.timeZone = () => ws.timeZone();
  if (ref) {
    store.writeText(`${ref.module.dir}/module.json`, ws.readText(`${ref.module.dir}/module.json`));
    const schema = `${ref.module.dir}/${ref.def.schema}`;
    if (ws.exists(schema)) store.writeText(schema, ws.readBytes(schema));
  }
  return store;
}

export function existingLocalStore(ws: Workspace, type: string): Workspace | undefined {
  if (ws.privateRecords || !existsSync(join(stateDirectory(ws.root), "local-projects"))) return;
  const store = new Workspace(ws.resolve(".kaitu/local-projects", { internal: true }), {
    maintain: false,
    privateRecords: true,
  });
  store.timeZone = () => ws.timeZone();
  return listRecordTypes(store).some((ref) => ref.type === type) ? store : undefined;
}

export function recordStore(
  ws: Workspace,
  ref: RecordTypeRef,
  record: StoredRecord,
  existing = true,
): Workspace {
  if (ws.privateRecords || ["project_metric", "github_snapshot"].includes(ref.type)) return ws;
  if (record.project !== undefined && !publicProject(ws, record.project)) return localRecordStore(ws, ref);
  if (!existing) return ws;
  const store = existingLocalStore(ws, ref.type);
  if (
    store &&
    recordLines(store, findRecordType(store, ref.type)).some(
      (line) => (JSON.parse(line.raw) as StoredRecord).id === record.id,
    )
  )
    return store;
  return ws;
}

export function relocateProjectRecords(ws: Workspace, slug?: string, toPrivate = true): void {
  if (ws.privateRecords) return;
  if (
    !slug &&
    !ws.exists(".kaitu/local-projects") &&
    !projectStatusFiles(ws).some(
      ({ file }) => parseFrontmatter<{ local_only?: boolean }>(ws.readText(file)).data.local_only,
    )
  )
    return;
  const local = ws.exists(".kaitu/local-projects") ? localRecordStore(ws) : undefined;
  const source = toPrivate ? ws : local;
  const knownLocal = !slug && toPrivate ? localRecordIds(ws) : new Set<string>();
  if (!source) return;
  for (const ref of listRecordTypes(source)) {
    if (["project_metric", "github_snapshot"].includes(ref.type)) continue;
    const { dir } = recordFilePattern(ref);
    if (!existsSync(join(source.root, dir))) continue;
    const rows = recordLines(source, ref);
    const projects = new Map<string, Set<unknown>>();
    for (const line of rows) {
      const row = JSON.parse(line.raw) as StoredRecord;
      const linked = projects.get(row.id) ?? new Set<unknown>();
      if (row.project !== undefined) linked.add(row.project);
      projects.set(row.id, linked);
    }
    const ids = new Set(
      [...projects].flatMap(([id, linked]) => {
        const selected = slug
          ? linked.has(slug)
          : knownLocal.has(id) || [...linked].some((project) => !publicProject(ws, project));
        const shareable = [...linked].every((project) => publicProject(ws, project));
        return selected && (toPrivate || shareable) ? [id] : [];
      }),
    );
    if (!ids.size) continue;
    const target = toPrivate ? localRecordStore(ws, ref) : ws;
    const files = new Map<string, string[]>();
    for (const line of rows) {
      const lines = files.get(line.file) ?? [];
      lines.push(line.raw);
      files.set(line.file, lines);
    }
    for (const [file, lines] of files) {
      const moving = lines.filter((line) => ids.has(JSON.parse(line).id));
      if (!moving.length) continue;
      const existing = target.exists(file) ? target.readText(file).split("\n").filter(Boolean) : [];
      target.writeText(file, `${[...new Set([...existing, ...moving])].join("\n")}\n`);
      const remaining = lines.filter((line) => !ids.has(JSON.parse(line).id));
      if (remaining.length) source.writeText(file, `${remaining.join("\n")}\n`);
      else rmSync(source.resolve(file));
    }
  }
}

export function localRecordIds(ws: Workspace): Set<string> {
  if (ws.privateRecords || !ws.exists(".kaitu/local-projects")) return new Set();
  const store = localRecordStore(ws);
  return new Set(
    listRecordTypes(store).flatMap((ref) =>
      recordLines(store, ref).map((line) => (JSON.parse(line.raw) as StoredRecord).id),
    ),
  );
}
