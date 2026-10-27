import { existsSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import type { AtlasCandidate } from "./life-atlas.js";

export const ATLAS_LIMIT = { count: 50, bytes: 512 * 1024 ** 2 };
export function atlasStorage(dir: string, count: number) {
  let bytes = 0;
  for (const part of ["maps", "cache"])
    if (existsSync(join(dir, part)))
      for (const name of readdirSync(join(dir, part))) bytes += statSync(join(dir, part, name)).size;
  return { count, bytes, maxCount: ATLAS_LIMIT.count, maxBytes: ATLAS_LIMIT.bytes };
}
export function terrainKey(dir: string, candidate: AtlasCandidate): string | undefined {
  if (candidate.terrainKey) return candidate.terrainKey;
  try {
    return JSON.parse(readFileSync(join(dir, "maps", `${candidate.id}.json`), "utf8")).key;
  } catch {
    return undefined;
  }
}
/** Only program-owned resources for the requested candidate are removed. Unknown references retain caches. */
export function deleteAtlasFiles(dir: string, candidate: AtlasCandidate, retained: AtlasCandidate[]) {
  const key = terrainKey(dir, candidate);
  const references = retained.map((c) => terrainKey(dir, c));
  for (const suffix of [".json", ".json.tmp"])
    rmSync(join(dir, "maps", `${candidate.id}${suffix}`), { force: true });
  if (key && /^[a-f0-9]{24}$/.test(key) && references.every((other) => other && other !== key))
    rmSync(join(dir, "cache", `${key}.terrain`), { force: true });
}
export function terrainFiles(dir: string) {
  const cache = join(dir, "cache");
  return existsSync(cache)
    ? readdirSync(cache).filter((name) => /^[a-f0-9]{24}\.terrain(?:\.\d+\.tmp)?$/.test(name))
    : [];
}
/** The worker has stopped before this runs; discard only files created by this failed generation. */
export function discardAtlasJob(dir: string, id: string, before: Set<string>) {
  for (const suffix of [".json", ".json.tmp"]) rmSync(join(dir, "maps", `${id}${suffix}`), { force: true });
  for (const name of terrainFiles(dir))
    if (!before.has(name)) rmSync(join(dir, "cache", name), { force: true });
}
