// Create disposable synthetic workspaces for the NORMAL product server, not a UI mock.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  addRecords,
  initWorkspace,
  saveCurrentCity,
  saveHometown,
  snapshot,
  validateWorkspace,
} from "../packages/core/dist/index.js";

const base = resolve(process.argv[2]);
if (!base.includes("footprint-integration-"))
  throw new Error("An explicit disposable integration directory is required");
mkdirSync(base, { recursive: true });
const fixtures = JSON.parse(
  readFileSync(new URL("../dist/footprint-acceptance/fixtures.json", import.meta.url), "utf8"),
);
const report = {};
for (const name of ["sample", "large", "empty"]) {
  const ws = await initWorkspace(resolve(base, name), { timeZone: "Asia/Shanghai" });
  const data = fixtures[name] ?? [];
  ws.writeText(
    "memory/footprint-seed.md",
    `# Synthetic footprint acceptance\n\nOnly fictional records for software validation.\n\n${data.map((e) => `${e.place.name} / ${e.event_type} / ${e.fact_status} / ${e.start ?? "unknown"}`).join("\n")}\n`,
  );
  const start = performance.now();
  addRecords(
    ws,
    "experience",
    data.map(({ id, by, ...e }) => ({ ...e, source: "memory/footprint-seed.md" })),
    { by: "user" },
  );
  if (name !== "empty") {
    await saveCurrentCity(ws, "Shanghai", fixtures.current.geonameid);
    await saveHometown(ws, "Chengdu", fixtures.home.geonameid);
  }
  await snapshot(ws, "Synthetic footprint integration seed");
  report[name] = {
    root: ws.root,
    records: data.length,
    cities: new Set(data.map((e) => e.place.geonameid)).size,
    seedMs: performance.now() - start,
    validation: validateWorkspace(ws),
  };
}
writeFileSync(resolve(base, "seed-report.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report));
