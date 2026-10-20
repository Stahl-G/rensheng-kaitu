import { expect, it } from "vitest";
import { footprintData, greatCircle } from "../src/client/footprint-state.js";
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
});

it("大圆经过跨日界线短边且所有坐标有限；对跖点不编造方向", () => {
  const arc = greatCircle(city(1, 178), city(2, -171));
  expect(arc).not.toBeNull();
  expect(arc?.every((p) => p.every(Number.isFinite))).toBe(true);
  expect((arc?.at(-1)?.[0] ?? 0) - (arc?.[0]?.[0] ?? 0)).toBeCloseTo(11);
  expect(greatCircle(city(1, 0, 0), city(2, 180, 0))).toBeNull();
});
