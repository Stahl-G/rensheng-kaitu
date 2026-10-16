import { experienceInterval, partialDateBounds } from "@kaitu/core/experience-time";
import type { StyleSpecification } from "maplibre-gl";
import type { Experience } from "../types.js";

export function cityKey(place: Experience["place"]): string {
  return String(place.geonameid ?? `${place.country ?? ""}:${place.name}`);
}

export function journeyRoutes(items: Experience[], asOf: string, home?: Experience["place"]) {
  if (!home) return { type: "FeatureCollection" as const, features: [] };
  const visits = items
    .flatMap((item) => {
      const date =
        item.time_precision === "year"
          ? item.start?.slice(0, 4)
          : item.time_precision === "month"
            ? item.start?.slice(0, 7)
            : item.start;
      const start = item.time_precision !== "unknown" ? partialDateBounds(date) : null;
      if (
        item.review ||
        !start ||
        start.from > asOf ||
        !["observed", "user_reported"].includes(item.fact_status) ||
        item.place.precision !== "city" ||
        item.place.lng === undefined ||
        item.place.lat === undefined
      )
        return [];
      return [{ item, start, interval: experienceInterval(item) }];
    })
    .sort((a, b) => a.start.from.localeCompare(b.start.from) || a.item.id.localeCompare(b.item.id));
  const ambiguous = new Set<number>();
  let groupStart = 0;
  let groupEnd = "";
  for (const [index, visit] of visits.entries()) {
    const end = visit.interval?.to ?? asOf;
    if (visit.start.from <= groupEnd) {
      ambiguous.add(groupStart);
      ambiguous.add(index);
      if (end > groupEnd) groupEnd = end;
    } else {
      groupStart = index;
      groupEnd = end;
    }
  }
  const features = visits.flatMap((visit, index) => {
    const previous = visits[index - 1];
    // 重叠、同一年/月内未知先后和无家乡的第一站均不补造路线。
    if (ambiguous.has(index) || ambiguous.has(index - 1)) return [];
    const from = previous?.item.place ?? home;
    const to = visit.item.place;
    if (!from || cityKey(from) === cityKey(to) || from.lng === undefined || from.lat === undefined) return [];
    let longitude = to.lng as number;
    while (longitude - from.lng > 180) longitude -= 360;
    while (longitude - from.lng < -180) longitude += 360;
    const x = longitude - from.lng;
    const y = (to.lat as number) - from.lat;
    const length = Math.hypot(x, y);
    if (length < 0.00001) return [];
    const bend = Math.min(length * 0.12, 12);
    const cx = (from.lng + longitude) / 2 - (y / length) * bend;
    const cy = (from.lat + (to.lat as number)) / 2 + (x / length) * bend;
    const coordinates = Array.from({ length: 33 }, (_, i) => {
      const t = i / 32;
      return [
        (1 - t) ** 2 * (from.lng as number) + 2 * (1 - t) * t * cx + t ** 2 * longitude,
        Math.max(
          -85,
          Math.min(
            85,
            (1 - t) ** 2 * (from.lat as number) + 2 * (1 - t) * t * cy + t ** 2 * (to.lat as number),
          ),
        ),
      ];
    });
    return [
      {
        type: "Feature" as const,
        properties: { from: cityKey(from), to: cityKey(to) },
        geometry: { type: "LineString" as const, coordinates },
      },
    ];
  });
  return { type: "FeatureCollection" as const, features };
}

/** 保留现有 OpenFreeMap source、字体与署名，只调整兼容的样式图层。 */
export function atlasStyle(
  style: StyleSpecification,
  colors: { water: string; land: string; border: string; muted: string; green: string },
) {
  return {
    ...style,
    layers: style.layers.map((layer) => {
      const source = "source-layer" in layer ? layer["source-layer"] : "";
      if (layer.type === "background")
        return { ...layer, paint: { ...layer.paint, "background-color": colors.land } };
      if (layer.type === "fill") {
        const color =
          source === "water" || /^water(?:$|[-_])/.test(layer.id)
            ? colors.water
            : source === "landcover" || /park|wood/.test(layer.id)
              ? colors.green
              : colors.land;
        return { ...layer, paint: { ...layer.paint, "fill-color": color } };
      }
      if (layer.type === "line" && /boundary|waterway/.test(source ?? "")) {
        return { ...layer, paint: { ...layer.paint, "line-color": colors.border } };
      }
      if (layer.type === "symbol") {
        const important = source === "place" && /country|state/.test(layer.id);
        return {
          ...layer,
          minzoom: important ? layer.minzoom : Math.max(layer.minzoom ?? 0, 6),
          paint: { ...layer.paint, "text-color": colors.muted, "text-halo-color": colors.land },
        };
      }
      return layer;
    }),
  } satisfies StyleSpecification;
}
