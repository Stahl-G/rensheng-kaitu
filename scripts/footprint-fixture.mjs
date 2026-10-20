// Synthetic acceptance input only. No workspace pointer, profile or account is read.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
const { build } = createRequire(new URL("../packages/dsh-plugin/package.json", import.meta.url))("esbuild");
import { clientStyles } from "../packages/dsh-plugin/scripts/client-styles.mjs";
const root = fileURLToPath(new URL("..", import.meta.url));
const output = resolve(root, "dist/footprint-acceptance");
mkdirSync(output, { recursive: true });
const rows = JSON.parse(readFileSync(resolve(root, "packages/core/data/cities.json"), "utf8")).rows;
const place = (r) => ({
  geonameid: r[0],
  name: r[3][0] || r[1],
  country: r[4],
  lat: r[6],
  lng: r[7],
  precision: "city",
});
const normal = (s) => s.toLowerCase().replace(/[^a-z]/g, "");
const find = (name, country) => {
  const candidates = rows.filter(
    (r) => r[4] === country && [r[1], r[2]].some((n) => normal(n) === normal(name)),
  );
  const match = candidates.sort((a, b) => b[8] - a[8])[0];
  if (!match) throw new Error(`Synthetic city missing: ${name}`);
  return place(match);
};
const home = find("Chengdu", "CN");
const lived = [
  ["Chengdu", "CN"],
  ["Beijing", "CN"],
  ["Berlin", "DE"],
  ["Singapore", "SG"],
  ["Hangzhou", "CN"],
  ["Shanghai", "CN"],
].map(([n, c], i) => ({
  place: find(n, c),
  event_type: "lived",
  start: `${2000 + i * 4}-01-01`,
  ...(i < 5 ? { end: `${2003 + i * 4}-12-31` } : {}),
}));
const travel = [
  ["Paris", "FR"],
  ["Madrid", "ES"],
  ["Lisbon", "PT"],
  ["Rome", "IT"],
  ["Athens", "GR"],
  ["Istanbul", "TR"],
  ["Dubai", "AE"],
  ["Vienna", "AT"],
  ["Bangkok", "TH"],
  ["Hanoi", "VN"],
  ["Hong Kong", "HK"],
  ["Taipei", "TW"],
  ["Seoul", "KR"],
  ["Tokyo", "JP"],
  ["Osaka", "JP"],
  ["Sydney", "AU"],
  ["Melbourne", "AU"],
  ["New York City", "US"],
  ["Toronto", "CA"],
  ["Vancouver", "CA"],
].map(([n, c], i) => ({
  place: find(n, c),
  event_type: "travel",
  start: `2023-${String(1 + (i % 12)).padStart(2, "0")}-${String(1 + Math.floor(i / 12)).padStart(2, "0")}`,
}));
const possible = [
  ["London", "GB", "planned"],
  ["Reykjavik", "IS", "planned"],
  ["Auckland", "NZ", "planned"],
  ["Santiago", "CL", "suggested"],
  ["Cape Town", "ZA", "suggested"],
].map(([n, c, fact_status]) => ({
  place: find(n, c),
  event_type: "travel",
  fact_status,
  time_precision: "unknown",
}));
const complete = (r, i) => ({
  id: `synthetic-${i}`,
  ts: "2026-10-20T00:00:00Z",
  by: "user",
  fact_status: "user_reported",
  time_precision: "day",
  source: "synthetic/acceptance",
  ...r,
});
const sample = [...lived, ...travel, ...possible].map(complete);
const largePlaces = rows
  .toSorted((a, b) => b[8] - a[8])
  .slice(0, 300)
  .map(place);
const large = Array.from({ length: 2000 }, (_, i) =>
  complete(
    {
      place: largePlaces[i % 300],
      event_type: i % 9 === 0 ? "lived" : "travel",
      start: new Date(Date.UTC(2010, 0, i + 1)).toISOString().slice(0, 10),
      end: new Date(Date.UTC(2010, 0, i + 1)).toISOString().slice(0, 10),
    },
    i,
  ),
);
writeFileSync(
  resolve(output, "fixtures.json"),
  JSON.stringify({ sample, large, home, current: find("Shanghai", "CN") }),
);
const entry = resolve(root, "packages/dsh-plugin/src/standalone/footprint-acceptance.tsx");
const worker = await build({
  entryPoints: [resolve(root, "packages/dsh-plugin/node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs")],
  bundle: true,
  format: "iife",
  minify: true,
  write: false,
});
const styles = clientStyles(worker.outputFiles[0].text);
await build({
  entryPoints: [entry],
  outfile: resolve(output, "preview.js"),
  bundle: true,
  platform: "browser",
  format: "esm",
  jsx: "automatic",
  plugins: [
    styles.plugin,
    {
      name: "acceptance-map-inspection",
      setup(builder) {
        builder.onLoad({ filter: /PaperMap\.tsx$/ }, ({ path }) => ({
          loader: "tsx",
          contents: readFileSync(path, "utf8").replace(
            "map.current = m;",
            `map.current = m;
        window.__acceptanceMap = m;
        window.__mapCreatedAt = performance.now();
        m.on("render", () => { if (!window.__firstLocalPaint && m.getSource("paper-earth")?.loaded()) window.__firstLocalPaint = performance.now(); });`,
          ),
        }));
      },
    },
  ],
});
writeFileSync(
  resolve(output, "preview.css"),
  `${readFileSync(resolve(root, "packages/dsh-plugin/src/standalone/base.css"), "utf8")}\n${styles.css()}`,
);
writeFileSync(
  resolve(output, "index.html"),
  '<!doctype html><meta charset="utf-8"><title>Synthetic footprint acceptance</title><link rel="stylesheet" href="preview.css"><div id="root"></div><script type="module" src="preview.js"></script>',
);
console.log(output);
