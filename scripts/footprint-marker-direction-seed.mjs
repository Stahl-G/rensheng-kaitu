import { cpSync, rmSync } from "node:fs";
import { Workspace, addRecords, resolvePlace, validateWorkspace } from "../packages/core/dist/index.js";
if (!process.env.KAITU_LOCAL_STATE_DIR?.startsWith("/tmp/kaitu-footprint"))
  throw Error("Isolated synthetic local-state directory required");
const base = "/tmp/kaitu-footprint-marker-direction-20261020";
for (const [name, previous] of [
  ["north", "Beijing"],
  ["south", "Singapore"],
]) {
  const target = `${base}/${name}`;
  rmSync(target, { recursive: true, force: true });
  // Clone the already core-initialized, validated EMPTY SYNTHETIC workspace.
  // Generated Git history and agent tooling are not needed by these data-only fixtures.
  console.log(name, "copying local synthetic files");
  cpSync("/tmp/kaitu-footprint-integration-20261020/empty", target, {
    recursive: true,
    filter: (path) =>
      !path.includes("/history.git") && !path.includes("/.agents") && !path.endsWith("/OVERVIEW.md"),
  });
  const ws = new Workspace(target, { maintain: false });
  console.log(name, "cloned synthetic workspace");
  ws.writeText(
    "memory/marker-direction.md",
    "# Synthetic marker direction verification\nNo personal data.\n",
  );
  const names = [previous, "Shanghai"];
  addRecords(
    ws,
    "experience",
    names.map((name, i) => {
      const c = resolvePlace(name)[0];
      return {
        place: {
          name: c.name,
          geonameid: c.geonameid,
          country: c.country,
          lat: c.lat,
          lng: c.lng,
          precision: "city",
        },
        event_type: "lived",
        fact_status: "user_reported",
        start: i ? "2010-01-01" : "2000-01-01",
        ...(i ? {} : { end: "2009-12-31" }),
        time_precision: "day",
        source: "memory/marker-direction.md",
      };
    }),
    { by: "user" },
  );
  ws.writeText("me/profile.md", "# Synthetic profile\n现居城市：Shanghai | geonameid:1796236\n");
  console.log(name, ws.root, validateWorkspace(ws));
}
