import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { KaituError } from "./errors.js";
import { parseFrontmatter } from "./frontmatter.js";
import { findRecordType, listRecordTypes, recordFilePattern } from "./modules.js";
import type { RecordTypeRef } from "./modules.js";
import { projectStatusFiles, publicProject } from "./projects.js";
import { privacyIndex, privateInput } from "./record-privacy.js";
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
  if (privateInput(ws, record)) return localRecordStore(ws, ref);
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
  const local = ws.exists(".kaitu/local-projects") ? localRecordStore(ws) : undefined;
  const source = toPrivate ? ws : local;
  const privacy = privacyIndex(ws);
  if (!source) return;
  for (const ref of listRecordTypes(source)) {
    if (["project_metric", "github_snapshot"].includes(ref.type)) continue;
    const { dir } = recordFilePattern(ref);
    if (!existsSync(join(source.root, dir))) continue;
    const rows = recordLines(source, ref);
    const ids = new Set(
      rows.flatMap((line) => {
        const row = JSON.parse(line.raw) as StoredRecord;
        const selected = toPrivate
          ? privacy.privateIds.has(row.id) || privacy.localIds.has(row.id)
          : !!slug && privacy.projects.get(row.id)?.has(slug) && !privacy.privateIds.has(row.id);
        return selected ? [row.id] : [];
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
      const merged = toPrivate ? [...moving, ...existing] : [...existing, ...moving];
      const copied = `${[...new Set(merged)].join("\n")}\n`;
      target.writeText(file, copied);
      if (target.readText(file) !== copied)
        throw new KaituError("本机记录副本验证失败，保留原件", "PRIVATE_MIGRATION");
      const remaining = lines.filter((line) => !ids.has(JSON.parse(line).id));
      if (remaining.length) source.writeText(file, `${remaining.join("\n")}\n`);
      else rmSync(source.resolve(file));
    }
  }
}

export function localRecordIds(ws: Workspace): Set<string> {
  if (ws.privateRecords) return new Set();
  const privacy = privacyIndex(ws);
  return new Set([...privacy.localIds, ...privacy.privateIds]);
}
