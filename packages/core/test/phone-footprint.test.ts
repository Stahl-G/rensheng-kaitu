import { rmSync } from "node:fs";
import { expect, it } from "vitest";
import {
  type ExperienceInput,
  addExperiences,
  buildPhoneMap,
  lifeMap,
  readExploration,
  readOverviewPage,
  schemas,
} from "../src/index.js";
import { freshWorkspace } from "./helpers.js";

it("手机足迹从事实经历区分现居、到过和计划，现居冲突时留空", async () => {
  const ws = await freshWorkspace();
  try {
    const now = new Date("2026-10-20T12:00:00Z");
    const entry = (
      name: string,
      country: string,
      event_type: ExperienceInput["event_type"],
      fact_status: ExperienceInput["fact_status"],
      start: string,
    ): ExperienceInput => ({
      place: { name, country },
      event_type,
      fact_status,
      start,
      time_precision: "year",
      source: "memory/synthetic-places.md",
    });
    await addExperiences(ws, [
      entry("Tokyo", "JP", "lived", "user_reported", "2020"),
      entry("Osaka", "JP", "worked", "observed", "2021"),
      entry("胡志明市", "VN", "travel", "user_reported", "2022"),
      { ...entry("Hanoi", "VN", "lived", "user_reported", "2023"), end: "2026" },
      entry("Paris", "FR", "travel", "inferred", "2023"),
      entry("Paris", "FR", "travel", "planned", "2027"),
      entry("Hanoi", "VN", "travel", "suggested", "2027"),
      entry("Osaka", "JP", "lived", "user_reported", "2028"),
    ]);
    const overview = await readOverviewPage(ws, now);
    const project = () => buildPhoneMap(overview, lifeMap(ws, now), readExploration(ws), now.toISOString());
    const map = project();
    const validate = schemas().builtin("phone-map.schema.json");
    expect(validate(map), JSON.stringify(validate.errors)).toBe(true);
    expect(map.footprint.current?.name).toBe("Tokyo");
    expect(map.footprint.visited.map((city) => city.name)).toEqual(["Hanoi", "Ho Chi Minh City", "Osaka"]);
    expect(map.footprint.planned.map(({ name, status }) => [name, status])).toEqual([
      ["Hanoi", "suggested"],
      ["Paris", "planned"],
    ]);
    expect(map.places.some((city) => city.layer === "now" && city.name === "Osaka")).toBe(true);

    await addExperiences(ws, [entry("Osaka", "JP", "lived", "user_reported", "2022")]);
    expect(project().footprint.current).toBeNull();
  } finally {
    rmSync(ws.root, { recursive: true, force: true });
  }
});
