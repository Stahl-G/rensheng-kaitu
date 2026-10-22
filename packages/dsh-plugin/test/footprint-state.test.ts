import { expect, it } from "vitest";
import { tailRotation } from "../src/client/footprint-me-marker.js";
import { footprintAnchor, footprintData, greatCircle } from "../src/client/footprint-state.js";
import type { Experience } from "../src/types.js";

const city = (id: number, lng: number, lat = 35): Experience["place"] => ({
  name: `City ${id}`,
  geonameid: id,
  lng,
  lat,
  precision: "city",
});
const item = (
  id: number,
  start: string,
  end: string | undefined,
  extra: Partial<Experience> = {},
): Experience => ({
  id: String(id),
  ts: "2026-01-01T00:00:00Z",
  by: "user",
  place: city(id, 70 + id * 10),
  event_type: "lived",
  fact_status: "user_reported",
  time_precision: "day",
  start,
  end,
  source: "synthetic",
  ...extra,
});

it("来路只连接已发生且有时间的居住，不把家乡、旅行、推测或未知日期接成事实", () => {
  const first = item(1, "2010-01-01", "2011-01-01");
  const last = item(2, "2012-01-01", undefined);
  const data = footprintData(
    [
      first,
      last,
      item(3, "2011-01-02", "2011-12-31", { event_type: "travel" }),
      item(4, "2000", undefined, { fact_status: "inferred" }),
      item(5, "2000", undefined, { time_precision: "unknown" }),
      item(6, "2030", undefined),
    ],
    "2026-10-20",
  );
  expect(data.history.map((p) => p.geonameid)).toEqual([1, 2]);
  expect(data.origin).toEqual(first.place);
  expect(data.previous).toEqual(first.place);
  expect(data.routes.features).toHaveLength(1);
  expect(data.routes.features[0]?.geometry.coordinates[0]?.[0]).toBeCloseTo(80);
  expect(data.routes.features[0]?.geometry.coordinates[0]?.[1]).toBeCloseTo(35);
  expect(data.undated).toBe(1);
  expect(data.me).toEqual(last.place);
  expect(data.travelled).toHaveLength(1);
  expect(data.all.map((p) => p.geonameid)).toEqual([1, 2, 3, 5]);
});

it("重叠居住、同年未知先后不连线，计划建议保持各自线型语义，明确现居优先", () => {
  const current = city(20, 121.47, 31.23);
  const a = item(1, "2010", "2012", { time_precision: "year" });
  const b = item(2, "2012", "2013", { time_precision: "year" });
  const planned = item(3, "2030", undefined, { fact_status: "planned" });
  const suggested = item(4, "2031", undefined, { fact_status: "suggested" });
  const data = footprintData([a, b, planned, suggested], "2026-10-20", current);
  expect(data.me).toEqual(current);
  expect(data.routes.features.map((f) => f.properties.kind)).toEqual(["planned", "suggested"]);
  for (const f of data.routes.features) expect(f.geometry.coordinates[0]?.[0]).toBeCloseTo(121.47);
  expect(footprintData([a, b], "2026-10-20").me).toBeUndefined();
  expect(footprintData([a, b], "2026-10-20").origin).toBeUndefined();
  expect(footprintData([a, b], "2026-10-20", current).previous).toBeUndefined();
});

it("家乡与首居分开，保留各自经历类型，不补造家乡到首居路线", () => {
  const home = city(90, 110, 20);
  const first = item(1, "2010-01-01", "2011-12-31");
  const current = item(2, "2020-01-01", undefined);
  const rows = [
    first,
    current,
    ...[3, 4, 5, 6].map((id) =>
      item(id, "2015", undefined, {
        event_type: id % 2 ? "worked" : "studied",
      }),
    ),
    item(7, "2018", undefined, { fact_status: "inferred" }),
    item(8, "2030", undefined, { fact_status: "planned" }),
  ];
  const data = footprintData(rows, "2026-10-22", current.place, home);
  expect(data.origin).toEqual(home);
  expect(data.me).toEqual(current.place);
  expect(data.history.map((p) => p.geonameid)).toEqual([90, 1, 2]);
  expect(data.all.map((p) => p.geonameid)).toEqual([90, 1, 2, 3, 4, 5, 6, 8]);
  expect(data.lived.map((p) => p.geonameid)).toEqual([1, 2]);
  expect(data.travelled).toHaveLength(0);
  const route = data.routes.features.find((f) => f.properties.kind === "history");
  expect(route?.geometry.coordinates[0]?.[0]).toBeCloseTo(first.place.lng as number);
  expect(route?.geometry.coordinates[0]?.[1]).toBeCloseTo(first.place.lat as number);
  expect(data.routes.features.filter((f) => f.properties.kind === "history")).toHaveLength(1);
  expect(footprintData(rows, "2026-10-22", current.place).origin).toEqual(first.place);
});

it("大圆经过跨日界线短边且所有坐标有限；对跖点不编造方向", () => {
  const arc = greatCircle(city(1, 178), city(2, -171));
  expect(arc).not.toBeNull();
  expect(arc?.every((p) => p.every(Number.isFinite))).toBe(true);
  expect((arc?.at(-1)?.[0] ?? 0) - (arc?.[0]?.[0] ?? 0)).toBeCloseTo(11);
  expect(greatCircle(city(1, 0, 0), city(2, 180, 0))).toBeNull();
});

it("年份和图层过滤不能把当前锚点改成旧居或清空计划出发点", () => {
  const old = item(1, "2010-01-01", "2012-12-31");
  const recent = item(2, "2020-01-01", undefined);
  const plan = item(3, "2030-01-01", undefined, { fact_status: "planned" });
  const anchor = footprintAnchor([old, recent, plan], "2026-10-20");
  expect(anchor).toEqual(recent.place);
  expect(footprintData([old], "2026-10-20", anchor ?? null).me).toEqual(recent.place);
  const plannedOnly = footprintData([plan], "2026-10-20", anchor ?? null);
  expect(plannedOnly.me).toEqual(recent.place);
  expect(plannedOnly.routes.features).toHaveLength(1);
  expect(plannedOnly.routes.features[0]?.geometry.coordinates[0]?.[0]).toBeCloseTo(
    recent.place.lng as number,
  );
  // A full-data conflict stays unresolved even if a filter happens to leave one city.
  const conflict = { ...recent, id: "conflict", place: city(4, 140) };
  const unknown = footprintAnchor([recent, conflict], "2026-10-20");
  expect(unknown).toBeUndefined();
  expect(footprintData([recent], "2026-10-20", unknown ?? null).me).toBeUndefined();
});

it("重返同城的最新居住冲突不借用多年前来路，尾迹回到默认左下", () => {
  const shanghai = city(20, 121.4581, 31.2222);
  const rows = [
    item(1, "2010-01-01", "2011-12-31", { place: city(1, 116.3972, 39.9075) }),
    item(2, "2012-01-01", "2013-12-31", { place: shanghai }),
    item(3, "2014-01-01", "2016-12-31", { place: city(3, 104.0667, 30.6667) }),
    item(4, "2015-01-01", undefined, { place: shanghai }),
  ];
  const data = footprintData(rows, "2026-10-20", shanghai);
  expect(data.routes.features).toHaveLength(1); // The old Beijing → Shanghai fact remains.
  expect(data.previous).toBeUndefined();
  expect(tailRotation(data.me, data.previous, 90)).toBe(tailRotation(shanghai));
});

it("跨日界线来路用真实居住端点确定上一站，尾迹仍朝苏瓦", () => {
  const suva = city(1, 178.4419, -18.1416);
  const apia = city(2, -171.7514, -13.8507);
  const data = footprintData(
    [item(1, "2010-01-01", "2011-12-31", { place: suva }), item(2, "2012-01-01", undefined, { place: apia })],
    "2026-10-20",
    apia,
  );
  expect(data.routes.features[0]?.geometry.coordinates.at(-1)?.[0]).toBeCloseTo(188.2486);
  expect(data.previous).toEqual(suva);
  expect(data.origin).toEqual(suva);
  const angle =
    ((tailRotation(data.me, data.previous) + (Math.atan2(13.5, -8.83) * 180) / Math.PI) * Math.PI) / 180;
  expect(Math.cos(angle)).toBeLessThan(0); // West toward Suva.
  expect(Math.sin(angle)).toBeGreaterThan(0); // South toward Suva.
});
