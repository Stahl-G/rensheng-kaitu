import { existsSync } from "node:fs";
import { join, posix } from "node:path";
import { listRecordTypes, recordFilePattern } from "./modules.js";
import { publicProject } from "./projects.js";
import { recordLines } from "./records.js";
import type { StoredRecord } from "./records.js";
import { schemas } from "./schema.js";
import { Workspace } from "./workspace.js";

export interface PrivacyIndex {
  privateIds: Set<string>;
  localIds: Set<string>;
  known: Set<string>;
  projects: Map<string, Set<unknown>>;
}
export function projectReference(path: string): string | undefined {
  const value = posix.normalize(path.replaceAll("\\", "/").split("#")[0] ?? path);
  return /^(?:projects|\.kaitu\/local-projects)\/([^/]+)(?:\/|$)/.exec(value)?.[1];
}
export function associations(ws: Workspace, row: Record<string, unknown>) {
  const projects = new Set<unknown>();
  const parents = new Set<string>();
  let invalid = false;
  if (row.project !== undefined) projects.add(row.project);
  for (const key of ["direction_id", "experiment_id"]) {
    if (row[key] === undefined) continue;
    if (typeof row[key] === "string" && row[key]) parents.add(row[key] as string);
    else invalid = true;
  }
  if (typeof row.source === "string") {
    const project = projectReference(row.source);
    if (project) projects.add(project);
  }
  if (row.references !== undefined) {
    if (!Array.isArray(row.references)) invalid = true;
    else
      for (const item of row.references) {
        if (!item || typeof item.ref !== "string") {
          invalid = true;
          continue;
        }
        if (item.kind === "project") projects.add(item.ref);
        else if (item.kind === "decision" || item.kind === "source") {
          if (/^https?:\/\//.test(item.ref)) continue;
          const project = projectReference(item.ref);
          if (project) projects.add(project);
          else {
            try {
              if (!ws.exists(item.ref.split("#")[0])) invalid = true;
            } catch {
              invalid = true;
            }
          }
        } else invalid = true;
      }
  }
  return { projects, parents, invalid };
}
export function privacyIndex(
  ws: Workspace,
  extra: StoredRecord[] = [],
  privateProjects = new Set<string>(),
): PrivacyIndex {
  const nodes = new Map<
    string,
    { projects: Set<unknown>; parents: Set<string>; invalid: boolean; local: boolean }
  >();
  const localIds = new Set<string>();
  const add = (row: StoredRecord, local: boolean) => {
    const links = associations(ws, row);
    const node = nodes.get(row.id) ?? {
      projects: new Set(),
      parents: new Set(),
      invalid: false,
      local: false,
    };
    for (const value of links.projects) node.projects.add(value);
    for (const value of links.parents) node.parents.add(value);
    node.invalid ||= links.invalid;
    node.local ||= local;
    nodes.set(row.id, node);
    if (local) localIds.add(row.id);
  };
  const stores = [ws];
  if (!ws.privateRecords && ws.exists(".kaitu/local-projects"))
    stores.push(
      new Workspace(ws.resolve(".kaitu/local-projects", { internal: true }), {
        maintain: false,
        privateRecords: true,
      }),
    );
  for (const store of stores)
    for (const ref of listRecordTypes(store)) {
      const directory = recordFilePattern(ref).dir;
      if (!existsSync(join(store.root, directory))) continue;
      for (const line of recordLines(store, ref)) {
        try {
          const row = JSON.parse(line.raw) as StoredRecord;
          if (schemas().builtin("record-base.schema.json")(row)) add(row, store.privateRecords);
        } catch {}
      }
    }
  for (const row of extra) add(row, false);
  const privateIds = new Set<string>();
  const projects = new Map<string, Set<unknown>>();
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visible = new Map<unknown, boolean>();
  const visit = (id: string, depth = 0): boolean => {
    if (visited.has(id)) return privateIds.has(id);
    const node = nodes.get(id);
    if (!node || visiting.has(id) || depth > 256) return true;
    visiting.add(id);
    const linked = new Set(node.projects);
    let hidden = node.invalid;
    for (const project of node.projects) {
      if (!visible.has(project))
        visible.set(project, !privateProjects.has(String(project)) && publicProject(ws, project));
      hidden ||= !visible.get(project);
    }
    for (const parent of node.parents) {
      hidden = visit(parent, depth + 1) || hidden;
      for (const project of projects.get(parent) ?? []) linked.add(project);
    }
    if (node.local && !linked.size && !node.parents.size) hidden = true;
    projects.set(id, linked);
    if (hidden) privateIds.add(id);
    visiting.delete(id);
    visited.add(id);
    return hidden;
  };
  for (const id of nodes.keys()) visit(id);
  return { privateIds, localIds, projects, known: new Set(nodes.keys()) };
}
export function privateInput(ws: Workspace, row: Record<string, unknown>, index?: PrivacyIndex): boolean {
  const links = associations(ws, row);
  if (links.invalid || [...links.projects].some((project) => !publicProject(ws, project))) return true;
  if (!links.parents.size) return false;
  const privacy = index ?? privacyIndex(ws, typeof row.id === "string" ? [row as StoredRecord] : []);
  return [...links.parents].some(
    (id) => !privacy.known.has(id) || privacy.privateIds.has(id) || privacy.localIds.has(id),
  );
}
export function privateBlock(ws: Workspace, block: Record<string, unknown>, index: PrivacyIndex): boolean {
  for (const key of ["module", "ref"]) {
    const value = block[key];
    if (typeof value !== "string") continue;
    const project = projectReference(value);
    if (project && !publicProject(ws, project)) return true;
    if (index.privateIds.has(value) || index.localIds.has(value)) return true;
    if (key === "ref" && /^[0-9A-HJKMNP-TV-Z]{26}$/.test(value) && !index.known.has(value)) return true;
  }
  return false;
}
