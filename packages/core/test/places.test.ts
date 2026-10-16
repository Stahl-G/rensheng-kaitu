import { rmSync } from "node:fs";
import { expect, it } from "vitest";
import {
  type ExperienceInput,
  addExperiences,
  editExperience,
  hideExperience,
  history,
  lifeMap,
  processInbox,
  readRecords,
  resolveExperience,
  resolvePlace,
  unhideExperience,
} from "../src/index.js";
import { freshWorkspace } from "./helpers.js";

it("人工纠正日期或城市后重导旧来源不新增，删除后的经历不复活，同城新访问仍可导入", async () => {
  const ws = await freshWorkspace();
  try {
    const original: ExperienceInput = {
      place: { name: "胡志明市", country: "VN" },
      event_type: "travel",
      fact_status: "user_reported",
      start: "2021",
      time_precision: "year",
      source: "memory/travel.md",
    };
    const created = (await addExperiences(ws, [original])).entries[0];
    if (!created) throw new Error("应已保存一条经历");
    const city = resolvePlace("Tokyo", "JP")[0];
    if (!city) throw new Error("应能解析东京");
    const correction = { ...original, place: { name: city.name, country: city.country }, start: "2022" };
    await editExperience(ws, created.id, correction, 1);
    await expect(editExperience(ws, created.id, { ...correction, start: "2020" }, 1)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect((await addExperiences(ws, [original], "agent", { dryRun: true })).added).toBe(0);
    expect((await addExperiences(ws, [original])).added).toBe(0);
    const corrected = lifeMap(ws).experiences;
    expect(corrected).toHaveLength(1);
    expect(corrected[0]).toMatchObject({
      id: created.id,
      start: "2022",
      by: "user",
      place: { geonameid: city.geonameid },
    });
    const hidden = await hideExperience(ws, created.id, 2);
    expect((await addExperiences(ws, [original])).added).toBe(0);
    expect(lifeMap(ws).experiences).toHaveLength(0);
    expect(lifeMap(ws).hidden).toMatchObject([{ item: { id: created.id, start: "2022" }, revision: 3 }]);
    await unhideExperience(ws, created.id, hidden.record.rev as number);
    expect(lifeMap(ws).experiences[0]).toMatchObject({
      id: created.id,
      start: "2022",
      place: { geonameid: city.geonameid },
    });
    await hideExperience(ws, created.id, 4);
    expect((await addExperiences(ws, [{ ...original, start: "2025" }])).added).toBe(1);
    expect(lifeMap(ws).experiences.map((item) => item.start)).toEqual(["2025"]);
  } finally {
    rmSync(ws.root, { recursive: true, force: true });
  }
});

it("胡志明市自动定位，重复提交不新增，同城多次经历按时间保留且整批一个版本", async () => {
  const ws = await freshWorkspace();
  try {
    const items: ExperienceInput[] = ["2023", "2021"].map((start) => ({
      place: { name: "胡志明市", country: "VN" },
      event_type: "travel",
      fact_status: "user_reported",
      start,
      time_precision: "year",
      source: "memory/travel.md",
    }));
    const before = (await history(ws)).length;
    expect((await addExperiences(ws, [...items, ...items], "agent")).added).toBe(2);
    expect((await history(ws)).length).toBe(before + 1);
    expect((await addExperiences(ws, items, "agent")).added).toBe(0);
    const map = lifeMap(ws);
    expect(map.features).toHaveLength(1);
    expect(map.features[0]?.geometry.coordinates).toEqual([106.6296, 10.823]);
    expect(map.features[0]?.properties.experiences.map((item) => item.start)).toEqual(["2021", "2023"]);
    expect(readRecords(ws, "experience")).toHaveLength(2);
    expect((await history(ws)).length).toBe(before + 1);
  } finally {
    rmSync(ws.root, { recursive: true, force: true });
  }
});

it("收件箱的计划只进 planned，歧义与未知城市不标点，选定后保留来源与经历", async () => {
  const ws = await freshWorkspace();
  try {
    const common = {
      type: "experience",
      event_type: "travel",
      time_precision: "unknown",
      source: "memory/places.md",
    };
    ws.writeText(
      "inbox/agents/places.records.jsonl",
      [
        { ...common, place: { name: "胡志明市" }, fact_status: "planned" },
        { ...common, place: { name: "Springfield", country: "US" }, fact_status: "user_reported" },
        { ...common, place: { name: "合成未知城市" }, fact_status: "observed" },
      ]
        .map((item) => JSON.stringify(item))
        .join("\n"),
    );
    expect((await processInbox(ws, { stableMs: 0 })).processed).toHaveLength(1);
    const map = lifeMap(ws);
    expect(map.features.map((feature) => feature.properties.layer)).toEqual(["planned"]);
    expect(map.review).toHaveLength(2);
    expect(map.undated).toBe(3);
    expect(map.review.every((item) => item.place.lat === undefined)).toBe(true);
    const ambiguous = map.review.find((item) => item.place.name === "Springfield");
    const candidate = resolvePlace("Springfield", "US")[0];
    if (!ambiguous || !candidate) throw new Error("应有待核对城市及候选");
    await resolveExperience(ws, ambiguous.id, candidate.geonameid);
    const resolved = lifeMap(ws);
    expect(resolved.review).toHaveLength(1);
    expect(
      resolved.features.find((feature) => feature.properties.layer === "been")?.geometry.coordinates,
    ).toEqual([candidate.lng, candidate.lat]);
    expect(resolved.experiences.find((item) => item.id === ambiguous.id)?.source).toBe("memory/places.md");
    expect(resolved.experiences.find((item) => item.id === ambiguous.id)?.review).toBeUndefined();
    expect(
      (
        await addExperiences(
          ws,
          [
            {
              place: { name: "Springfield", country: "US" },
              event_type: "travel",
              fact_status: "user_reported",
              time_precision: "unknown",
              source: "memory/places.md",
            },
          ],
          "agent",
        )
      ).added,
    ).toBe(0);
  } finally {
    rmSync(ws.root, { recursive: true, force: true });
  }
});
