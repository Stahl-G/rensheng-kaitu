import { experienceInterval, partialDateBounds } from "@kaitu/core/experience-time";
import type { Experience } from "../types.js";
import { cityKey } from "./life-map-visuals.js";

export type FootprintState = "now" | "history" | "possible";
export type Place = Experience["place"];
export const coordinate = (p?: Place): p is Place & { lng: number; lat: number } =>
  p?.precision === "city" && Number.isFinite(p.lng) && Number.isFinite(p.lat);
const real = (e: Experience, asOf: string) =>
  !e.review &&
  ["observed", "user_reported"].includes(e.fact_status) &&
  (!experienceInterval(e) || (experienceInterval(e)?.from ?? "") <= asOf);

/** Spherical interpolation along the shorter great-circle arc, with unwrapped longitude.
 * Coincident/antipodal cities do not receive an arbitrary direction.
 */
export function greatCircle(from: Place, to: Place) {
  if (!coordinate(from) || !coordinate(to)) return null;
  const rad = Math.PI / 180;
  const vector = (p: typeof from) => {
    const lat = (p.lat as number) * rad;
    const lng = (p.lng as number) * rad;
    return [Math.cos(lat) * Math.cos(lng), Math.cos(lat) * Math.sin(lng), Math.sin(lat)];
  };
  const a = vector(from);
  const b = vector(to);
  const angle = Math.acos(
    Math.max(
      -1,
      Math.min(
        1,
        a.reduce((v, x, i) => v + x * (b[i] as number), 0),
      ),
    ),
  );
  if (angle < 1e-7 || Math.PI - angle < 1e-7) return null;
  let longitude = from.lng;
  return Array.from({ length: 65 }, (_, i) => {
    const t = i / 64;
    const x = Math.sin((1 - t) * angle) / Math.sin(angle);
    const y = Math.sin(t * angle) / Math.sin(angle);
    const v = a.map((n, j) => n * x + (b[j] as number) * y);
    let lng = Math.atan2(v[1] as number, v[0] as number) / rad;
    while (lng - longitude > 180) lng -= 360;
    while (lng - longitude < -180) lng += 360;
    longitude = lng;
    return [
      lng,
      Math.max(
        -85.051129,
        Math.min(85.051129, Math.atan2(v[2] as number, Math.hypot(v[0] as number, v[1] as number)) / rad),
      ),
    ];
  });
}

export function footprintData(items: Experience[], asOf: string, current?: Place) {
  const actual = items.filter((e) => real(e, asOf) && coordinate(e.place));
  const lived = actual.filter((e) => e.event_type === "lived");
  const timed = lived
    .flatMap((e) => {
      const interval = experienceInterval(e);
      const start =
        e.time_precision === "unknown"
          ? null
          : partialDateBounds(
              e.time_precision === "year"
                ? e.start?.slice(0, 4)
                : e.time_precision === "month"
                  ? e.start?.slice(0, 7)
                  : e.start,
            );
      return start && interval ? [{ e, interval, start }] : [];
    })
    .sort((a, b) => a.start.from.localeCompare(b.start.from));
  // A tied/overlapping latest residence cannot establish a current city.
  const latest = timed.at(-1);
  const latestConflict =
    latest &&
    timed.some(
      (v) =>
        v !== latest &&
        (v.interval.to ?? asOf) >= latest.start.from &&
        v.start.from <= latest.start.to &&
        cityKey(v.e.place) !== cityKey(latest.e.place),
    );
  const me = coordinate(current)
    ? current
    : latest && !latestConflict
      ? latest.e.place
      : lived.length === 1
        ? lived[0]?.place
        : undefined;
  const points = (rows: Experience[]) => [...new Map(rows.map((e) => [cityKey(e.place), e.place])).values()];
  const possible = items.filter(
    (e) => !e.review && coordinate(e.place) && ["planned", "suggested"].includes(e.fact_status),
  );
  const features: {
    type: "Feature";
    properties: { kind: string; opacity: number };
    geometry: { type: "LineString"; coordinates: number[][] };
  }[] = [];
  for (let i = 1; i < timed.length; i++) {
    const previous = timed[i - 1];
    const next = timed[i];
    if (!previous || !next) continue;
    // Do not draw through a residence whose date range overlaps any other residence.
    const ambiguous = (v: typeof previous) =>
      timed.some(
        (other) =>
          other !== v &&
          other.start.from <= (v.interval.to ?? asOf) &&
          (other.interval.to ?? asOf) >= v.start.from,
      );
    if (ambiguous(previous) || ambiguous(next)) continue;
    const arc = greatCircle(previous.e.place, next.e.place);
    if (arc)
      features.push({
        type: "Feature",
        properties: { kind: "history", opacity: 0.35 + (0.55 * i) / Math.max(1, timed.length - 1) },
        geometry: { type: "LineString", coordinates: arc },
      });
  }
  if (me)
    for (const e of possible) {
      const arc = greatCircle(me, e.place);
      if (arc)
        features.push({
          type: "Feature",
          properties: { kind: e.fact_status, opacity: 0.85 },
          geometry: { type: "LineString", coordinates: arc },
        });
    }
  return {
    me,
    all: points([...actual, ...possible]),
    lived: points(lived),
    history: points(timed.map((v) => v.e)),
    possible: points(possible),
    travelled: points(actual.filter((e) => ["travel", "visit"].includes(e.event_type))),
    undated: lived.length - timed.length,
    routes: { type: "FeatureCollection" as const, features },
  };
}
