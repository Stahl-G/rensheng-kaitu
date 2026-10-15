import { readFileSync } from "node:fs";
import { KaituError } from "./errors.js";
import { snapshot } from "./history.js";
import { listRecordTypes } from "./modules.js";
import { type By, addRecords, readRecords, updateRecord } from "./records.js";
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
export type MapLayer = "been" | "now" | "planned";
export interface LifeMapFeature {
  type: "Feature";
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: { layer: MapLayer; place: Experience["place"]; experiences: Experience[] };
}
export interface LifeMapData {
  type: "FeatureCollection";
  features: LifeMapFeature[];
  review: Experience[];
  undated: number;
  experiences: Experience[];
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
  return listRecordTypes(ws).some((ref) => ref.type === "experience")
    ? (readRecords(ws, "experience") as unknown as Experience[])
    : [];
}

function key(item: ExperienceInput & { place: Experience["place"] }): string {
  const place = item.place.geonameid ?? [item.place.name.toLowerCase(), item.place.country ?? ""];
  return JSON.stringify([item.source, place, item.start ?? "", item.event_type]);
}

export async function addExperiences(
  ws: Workspace,
  items: ExperienceInput[],
  by: By = "agent",
  options: { dryRun?: boolean } = {},
) {
  if (!Array.isArray(items)) throw new KaituError("经历必须是数组", "BAD_ARGS");
  const data = items.map((item) => {
    if (
      !item?.place ||
      Object.hasOwn(item, "review") ||
      Object.keys(item.place).some((field) => !["name", "country"].includes(field))
    )
      throw new KaituError("地点只接受城市名 name 和国家代码 country，坐标由城市表提供", "BAD_ARGS");
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
      ...(!city
        ? {
            review: {
              reason: candidates.length ? "地名有多个候选，请选择城市" : "城市表未找到，请核对地名",
              candidates,
            },
          }
        : {}),
    };
  });
  const prepared = addRecords(ws, "experience", data, { by, dryRun: true });
  const seen = new Set(experiences(ws).map(key));
  const fresh = data.filter((item) => {
    const id = key(item);
    if (
      seen.has(id) ||
      item.review?.candidates.some((city) => seen.has(key({ ...item, place: cityPlace(city) })))
    )
      return false;
    seen.add(id);
    return true;
  });
  if (options.dryRun)
    return {
      entries: prepared.map((row) => row.record as unknown as Experience),
      added: fresh.length,
      version: null,
    };
  const entries = addRecords(ws, "experience", fresh, { by }).map(
    (row) => row.record as unknown as Experience,
  );
  const version = entries.length
    ? await snapshot(ws, `${by === "user" ? "你" : "Agent"}记录了 ${entries.length} 条地点经历`)
    : null;
  return { entries, added: entries.length, version };
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

export function lifeMap(ws: Workspace): LifeMapData {
  const rows = experiences(ws).sort(
    (a, b) =>
      (a.start ?? a.end ?? "9999").localeCompare(b.start ?? b.end ?? "9999") || a.id.localeCompare(b.id),
  );
  const groups = new Map<string, LifeMapFeature>();
  for (const item of rows) {
    const { place, fact_status: status } = item;
    if (item.review || place.lat === undefined || place.lng === undefined) continue;
    const layer: MapLayer | null =
      status === "planned" || status === "suggested"
        ? "planned"
        : status === "observed" || status === "user_reported"
          ? ["lived", "worked"].includes(item.event_type) && !item.end
            ? "now"
            : "been"
          : null;
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
    features: [...groups.values()],
    review: rows.filter((item) => item.review),
    undated: rows.filter((item) => !item.start && !item.end).length,
    experiences: rows,
  };
}
