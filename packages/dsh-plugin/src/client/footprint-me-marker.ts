import { type Place, coordinate } from "./footprint-state.js";

// Verified at https://kaitu.si/: hero .hm-route-open final cubic and .hm-ring
// share endpoint (39.5,16). Preserve the cubic; normalize around that endpoint.
export const routeTail = "M30.67 29.5C34 28 36.5 22 39.5 16";
const originalTailAngle = (Math.atan2(13.5, -8.83) * 180) / Math.PI;

/** Back azimuth at the current city: the tail points toward the previous city,
 * never toward a plan. SVG +x is east/+y south; map bearing rotates east up.
 */
export function tailRotation(current?: Place, previous?: Place, mapBearing = 0): number {
  if (!coordinate(current) || !coordinate(previous)) return 135 - originalTailAngle;
  const rad = Math.PI / 180;
  const a = current.lat * rad;
  const b = previous.lat * rad;
  const d = (previous.lng - current.lng) * rad;
  const x = Math.sin(d) * Math.cos(b);
  const y = Math.cos(a) * Math.sin(b) - Math.sin(a) * Math.cos(b) * Math.cos(d);
  if (Math.hypot(x, y) < 1e-10) return 135 - originalTailAngle;
  return (Math.atan2(x, y) * 180) / Math.PI - mapBearing - 90 - originalTailAngle;
}

let sequence = 0;
export function createMeMarker(
  markerClass: string,
  iconClass: string,
  glowClass: string,
  labelClass: string,
) {
  const root = document.createElement("div");
  root.className = markerClass;
  root.dataset.footprintMe = "true";
  root.setAttribute("role", "img");
  const id = `kaitu-me-tail-${++sequence}`;
  root.innerHTML = `<div class="${iconClass}"><div class="${glowClass}"></div><svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="-32 -32 64 64" aria-hidden="true"><defs><linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="30.67" y1="29.5" x2="39.5" y2="16"><stop offset="0" stop-color="currentColor" stop-opacity="0"/><stop offset="1" stop-color="currentColor" stop-opacity=".9"/></linearGradient></defs><g data-me-direction><g transform="scale(1.1) translate(-39.5 -16)"><path d="${routeTail}" fill="none" stroke="url(#${id})" stroke-width="${2 / 1.1}" stroke-linecap="round"/></g></g><circle data-me-ring r="6.25" fill="none" stroke="currentColor" stroke-width="1.5"/><circle data-me-head r="4" fill="currentColor"/></svg></div>`;
  const label = document.createElement("span");
  label.className = labelClass;
  root.append(label);
  return root;
}
