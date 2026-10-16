import { expect, it } from "vitest";
import { journeyRoutes } from "../src/client/life-map-visuals.js";
import type { Experience } from "../src/types.js";

it("人生主线从家乡开始，保留返乡，排除未知/计划/重叠时间，跨经线取短边", () => {
  const home: Experience["place"] = { name: "北京", geonameid: 1, lng: 116.4, lat: 39.9, precision: "city" };
  const item = (id: string, start: string, lng: number): Experience => ({
    id,
    ts: "2026-01-01T00:00:00Z",
    by: "user",
    place: { name: id, geonameid: Number(id), lng, lat: 35, precision: "city" },
    event_type: "travel",
    fact_status: "user_reported",
    time_precision: "day",
    start,
    source: "memory/travel.md",
  });
  const tokyo = item("2", "2023-10-01", 139.7);
  const back = { ...item("1", "2024-01-01", 116.4), place: home };
  const hcm = item("3", "2025-02-01", 106.7);
  const items = [
    hcm,
    back,
    tokyo,
    { ...item("4", "2025-08-01", 100), fact_status: "planned" as const },
    { ...item("5", "2022-01-01", 10), time_precision: "unknown" as const },
  ];
  const routes = journeyRoutes(items, "2026-01-01", home);
  expect(routes.features.map((row) => row.properties)).toEqual([
    { from: "1", to: "2" },
    { from: "2", to: "1" },
    { from: "1", to: "3" },
  ]);
  expect(routes.features[0].geometry.coordinates[0]).toEqual([116.4, 39.9]);
  expect(journeyRoutes(items, "2026-01-01").features).toEqual([]);
  const overlap = [{ ...tokyo, end: "2024-02-01" }, back];
  expect(journeyRoutes(overlap, "2026-01-01", home).features).toEqual([]);
  expect(journeyRoutes([...overlap, hcm], "2026-01-01", home).features).toEqual([]);
  const sameYear = [tokyo, { ...back, start: "2023", time_precision: "year" as const }];
  expect(journeyRoutes(sameYear, "2026-01-01", home).features).toEqual([]);
  const pacificHome = { ...home, lng: 178 };
  const line = journeyRoutes([item("6", "2023-01-01", -171)], "2026-01-01", pacificHome).features[0].geometry
    .coordinates;
  expect(Math.abs((line.at(-1)?.[0] ?? Number.NaN) - line[0][0])).toBe(11);
  expect(line.every((point) => point.every(Number.isFinite))).toBe(true);
});
