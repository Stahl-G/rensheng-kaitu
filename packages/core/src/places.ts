import { readFileSync } from "node:fs";
import { KaituError } from "./errors.js";
import {
  commitExperienceImport,
  committedExperienceRevisions,
  committedExperiences,
  excludedExperienceSources,
  experienceSourceKey,
  pendingExperienceImports,
  recoverExperienceImports,
} from "./experience-imports.js";
import { experienceInterval, experienceLayer } from "./experience-time.js";
import { snapshot } from "./history.js";
import { listRecordTypes } from "./modules.js";
import {
  type By,
  type StoredRecord,
  addRecords,
  appendPreparedRecords,
  deleteRecord,
  readRecordRevisions,
  updateRecord,
} from "./records.js";
import { localDate } from "./time.js";
import type { Workspace } from "./workspace.js";

export interface City {
  geonameid: number;
  name: string;
  ascii: string;
  zh: string[];
  country: string;
  admin1: string;
  lat: number;
  lng: number;
  population: number;
}
export interface ExperienceInput {
  place: { name: string; country?: string };
  event_type: "lived" | "worked" | "studied" | "travel" | "visit" | "other";
  fact_status: "observed" | "user_reported" | "inferred" | "planned" | "suggested";
  start?: string;
  end?: string;
  time_precision: "year" | "month" | "day" | "unknown";
  title?: string;
  notes?: string;
  source: string;
}
export interface Experience extends ExperienceInput {
  id: string;
  ts: string;
  by: string;
  rev?: number;
  place: ExperienceInput["place"] & {
    geonameid?: number;
    lat?: number;
    lng?: number;
    precision: "city" | "region" | "country" | "unknown";
  };
  review?: { reason: string; candidates: City[] };
}
export type ExperienceChanges = Omit<ExperienceInput, "source">;
export type MapLayer = "been" | "now" | "planned";
export interface LifeMapFeature {
  type: "Feature";
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: { layer: MapLayer; place: Experience["place"]; experiences: Experience[] };
}
export interface LifeMapData {
  type: "FeatureCollection";
  asOf: string;
  features: LifeMapFeature[];
  review: Experience[];
  undated: number;
  importsPending: number;
  experiences: Experience[];
  hidden: { item: Experience; revision: number }[];
}

let cities: City[] | undefined;
function cityTable(): City[] {
  if (!cities) {
    const data = JSON.parse(readFileSync(new URL("../data/cities.json", import.meta.url), "utf8")) as {
      rows: [number, string, string, string[], string, string, number, number, number][];
    };
    cities = data.rows.map(([geonameid, name, ascii, zh, country, admin1, lat, lng, population]) => ({
      geonameid,
      name,
      ascii,
      zh,
      country,
      admin1,
      lat,
      lng,
      population,
    }));
  }
  return cities;
}

export function resolvePlace(name: string, country?: string): City[] {
  if (typeof name !== "string" || !name.trim() || (country !== undefined && typeof country !== "string"))
    throw new KaituError("请提供城市名和可选的国家代码", "BAD_ARGS");
  const term = name.trim().toLowerCase();
  const pool = country
    ? cityTable().filter((city) => city.country === country.trim().toUpperCase())
    : cityTable();
  const match = (term: string) =>
    pool.filter((city) => [...city.zh, city.name, city.ascii].some((alias) => alias.toLowerCase() === term));
  let hits = match(term);
  if (!hits.length && term.endsWith("市")) hits = match(term.slice(0, -1));
  hits.sort((a, b) => b.population - a.population || a.geonameid - b.geonameid);
  const [first, second] = hits;
  if (first && second && first.population >= second.population * 10) return [first];
  return hits.slice(0, 5);
}

function cityPlace(city: City): Experience["place"] {
  return {
    name: city.name,
    country: city.country,
    geonameid: city.geonameid,
    lat: city.lat,
    lng: city.lng,
    precision: "city",
  };
}

function experiences(ws: Workspace): Experience[] {
  return committedExperiences(ws);
}

function key(item: ExperienceInput & { place: Experience["place"] }): string {
  const place = item.place.geonameid ?? [item.place.name.toLowerCase(), item.place.country ?? ""];
  return JSON.stringify([experienceSourceKey(item.source), place, item.start ?? "", item.event_type]);
}

function importedKeys(ws: Workspace): Set<string> {
  const seen = new Set<string>();
  // 修正前的原始身份也要保留，删除标记不能让旧来源重新生成同一经历。
  for (const item of readRecordRevisions(ws, "experience")) {
    if (!item.deleted) seen.add(key(item as unknown as Experience));
  }
  return seen;
}

function prepareExperience(item: ExperienceInput) {
  if (
    !item?.place ||
    Object.hasOwn(item, "review") ||
    Object.keys(item.place).some((field) => !["name", "country"].includes(field))
  )
    throw new KaituError("地点只接受城市名 name 和国家代码 country，坐标由城市表提供", "BAD_ARGS");
  if (
    item.start &&
    item.end &&
    item.start.slice(0, Math.min(item.start.length, item.end.length)) >
      item.end.slice(0, Math.min(item.start.length, item.end.length))
  )
    throw new KaituError("结束时间不能早于开始时间，请核对经历日期", "BAD_ARGS");
  const candidates = resolvePlace(item.place.name, item.place.country);
  const city = candidates.length === 1 ? candidates[0] : undefined;
  return {
    ...item,
    place: city
      ? cityPlace(city)
      : {
          name: item.place.name.trim(),
          ...(item.place.country ? { country: item.place.country.trim().toUpperCase() } : {}),
          precision: "unknown" as const,
        },
    review: !city
      ? {
          reason: candidates.length ? "地名有多个候选，请选择城市" : "城市表未找到，请核对地名",
          candidates,
        }
      : undefined,
  };
}

function currentRevision(ws: Workspace, id: string, expectedRevision: number) {
  let current: StoredRecord | undefined;
  for (const record of readRecordRevisions(ws, "experience")) {
    if (record.id === id && (!current || (record.rev ?? 1) >= (current.rev ?? 1))) current = record;
  }
  if (!current) throw new KaituError("找不到这条经历", "NOT_FOUND");
  if (!Number.isInteger(expectedRevision) || expectedRevision !== (current.rev ?? 1))
    throw new KaituError("这条经历已经更新，请重新读取后再修改", "CONFLICT");
  return current;
}

export async function editExperience(
  ws: Workspace,
  id: string,
  changes: ExperienceChanges,
  expectedRevision: number,
) {
  const current = currentRevision(ws, id, expectedRevision);
  if (current.deleted) throw new KaituError("这条经历已隐藏，请先撤销隐藏", "NOT_FOUND");
  const input = prepareExperience({ ...changes, source: String(current.source) });
  const record = updateRecord(
    ws,
    "experience",
    id,
    {
      start: undefined,
      end: undefined,
      title: undefined,
      notes: undefined,
      ...input,
    },
    { by: "user" },
  );
  return { ...record, version: await snapshot(ws, "你修正了一条地点经历") };
}

export async function hideExperience(ws: Workspace, id: string, expectedRevision: number) {
  currentRevision(ws, id, expectedRevision);
  const record = deleteRecord(ws, "experience", id, { by: "user" });
  return { ...record, version: await snapshot(ws, "你隐藏了一条地点经历") };
}

export async function unhideExperience(ws: Workspace, id: string, expectedRevision: number) {
  const current = currentRevision(ws, id, expectedRevision);
  if (!current.deleted) throw new KaituError("这条经历并未隐藏", "BAD_ARGS");
  const previous = readRecordRevisions(ws, "experience")
    .filter((record) => record.id === id && !record.deleted)
    .sort((a, b) => (b.rev ?? 1) - (a.rev ?? 1))[0];
  if (!previous) throw new KaituError("找不到隐藏前的经历", "NOT_FOUND");
  const record: StoredRecord = { ...previous, by: "user", rev: (current.rev ?? 1) + 1 };
  appendPreparedRecords(ws, [{ type: "experience", record }]);
  return { record, version: await snapshot(ws, "你撤销了地点经历的隐藏") };
}

export async function addExperiences(
  ws: Workspace,
  items: ExperienceInput[],
  by: By = "agent",
  options: { dryRun?: boolean } = {},
) {
  if (!Array.isArray(items)) throw new KaituError("经历必须是数组", "BAD_ARGS");
  if (!options.dryRun) await recoverExperienceImports(ws);
  const excluded = excludedExperienceSources(ws);
  const accepted = items.filter((item) => !excluded.has(experienceSourceKey(item?.source)));
  const excluded_count = items.length - accepted.length;
  const data = accepted.map(prepareExperience);
  const prepared = addRecords(ws, "experience", data, { by, dryRun: true });
  const seen = importedKeys(ws);
  const freshIndices = new Set<number>();
  const fresh = data.filter((item, index) => {
    const id = key(item);
    if (
      seen.has(id) ||
      item.review?.candidates.some((city) => seen.has(key({ ...item, place: cityPlace(city) })))
    )
      return false;
    seen.add(id);
    freshIndices.add(index);
    return true;
  });
  if (options.dryRun)
    return {
      entries: prepared
        .filter((_, index) => freshIndices.has(index))
        .map((row) => row.record as unknown as Experience),
      added: fresh.length,
      excluded: excluded_count,
      duplicates: data.length - fresh.length,
      batch_id: null,
      version: null,
    };
  const entries = prepared.filter((_, index) => freshIndices.has(index)).map((row) => row.record);
  const receipt = await commitExperienceImport(
    ws,
    entries,
    {
      input_count: items.length,
      duplicate_count: data.length - fresh.length,
      excluded_count,
    },
    by,
  );
  return {
    entries: entries as unknown as Experience[],
    added: entries.length,
    excluded: excluded_count,
    duplicates: data.length - fresh.length,
    ...receipt,
  };
}

export async function resolveExperience(ws: Workspace, id: string, geonameid: number) {
  const current = experiences(ws).find((item) => item.id === id);
  if (!current) throw new KaituError("找不到这条经历", "NOT_FOUND");
  const city = cityTable().find((candidate) => candidate.geonameid === geonameid);
  if (!city || !current.review?.candidates.some((candidate) => candidate.geonameid === geonameid))
    throw new KaituError("请选择待核对列表中的城市", "BAD_ARGS");
  const record = updateRecord(
    ws,
    "experience",
    id,
    { place: cityPlace(city), review: undefined },
    { by: "user" },
  );
  const version = await snapshot(ws, "你确认了一条经历的城市");
  return { ...record, version };
}

export function lifeMap(ws: Workspace, now = new Date()): LifeMapData {
  const asOf = localDate(now, ws.timeZone());
  const rows = experiences(ws).sort(
    (a, b) =>
      (a.start ?? a.end ?? "9999").localeCompare(b.start ?? b.end ?? "9999") || a.id.localeCompare(b.id),
  );
  const groups = new Map<string, LifeMapFeature>();
  const hidden = new Map<string, { item?: Experience; revision: number; deleted: boolean }>();
  if (listRecordTypes(ws).some((ref) => ref.type === "experience")) {
    const revisions = committedExperienceRevisions(ws).sort((a, b) => (a.rev ?? 1) - (b.rev ?? 1));
    for (const record of revisions) {
      hidden.set(record.id, {
        item: record.deleted ? hidden.get(record.id)?.item : (record as unknown as Experience),
        revision: record.rev ?? 1,
        deleted: record.deleted === true,
      });
    }
  }
  for (const item of rows) {
    const { place } = item;
    if (item.review || place.lat === undefined || place.lng === undefined) continue;
    const layer = experienceLayer(item, asOf);
    if (!layer) continue;
    const id = `${place.geonameid}:${layer}`;
    let feature = groups.get(id);
    if (!feature) {
      feature = {
        type: "Feature",
        geometry: { type: "Point", coordinates: [place.lng, place.lat] },
        properties: { layer, place, experiences: [] },
      };
      groups.set(id, feature);
    }
    feature.properties.experiences.push(item);
  }
  return {
    type: "FeatureCollection",
    asOf,
    features: [...groups.values()],
    review: rows.filter((item) => item.review || !experienceLayer(item, asOf)),
    undated: rows.filter((item) => !experienceInterval(item)).length,
    importsPending: pendingExperienceImports(ws).length,
    experiences: rows,
    hidden: [...hidden.values()]
      .filter(
        (entry): entry is { item: Experience; revision: number; deleted: boolean } =>
          entry.deleted && !!entry.item,
      )
      .map(({ item, revision }) => ({ item, revision })),
  };
}
