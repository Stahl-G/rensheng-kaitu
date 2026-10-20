import { expect, it } from "vitest";
import { tailRotation } from "../src/client/footprint-me-marker.js";
import type { Place } from "../src/client/footprint-state.js";

const place = (lng: number, lat: number): Place => ({ name: "synthetic", lng, lat, precision: "city" });
const nativeAngle = (Math.atan2(13.5, -8.83) * 180) / Math.PI;
const screenAngle = (previous?: Place, bearing = 0) =>
  (((tailRotation(place(0, 0), previous, bearing) + nativeAngle) % 360) + 360) % 360;

it("尾迹朝上一站，东西相反方向及地图bearing映射正确；无上一站固定左下", () => {
  expect(screenAngle(place(10, 0))).toBeCloseTo(0);
  expect(screenAngle(place(-10, 0))).toBeCloseTo(180);
  expect(screenAngle(place(0, 10))).toBeCloseTo(270);
  expect(screenAngle(place(0, -10))).toBeCloseTo(90);
  expect(screenAngle(place(10, 0), 90)).toBeCloseTo(270);
  expect(screenAngle(place(-10, 0), 90)).toBeCloseTo(90);
  expect(screenAngle(undefined, 90)).toBeCloseTo(135);
});
