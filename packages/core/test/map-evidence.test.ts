import { rmSync, symlinkSync } from "node:fs";
import { expect, it } from "vitest";
import {
  type ExperienceInput,
  addExperiences,
  experienceOverlaps,
  experienceYears,
  lifeMap,
  partialDateBounds,
  readExperienceSource,
  readOverviewPage,
} from "../src/index.js";
import { freshWorkspace } from "./helpers.js";

it("跨年持续经历按区间重叠筛选，未知日期不进入年份，未来与推测不冒充到访", async () => {
  const ws = await freshWorkspace();
  try {
    const base: ExperienceInput = {
      place: { name: "Hanoi", country: "VN" },
      event_type: "lived",
      fact_status: "user_reported",
      start: "2020-06-01",
      end: "2022-06-01",
      time_precision: "year",
      source: "memory/life.md",
    };
    await addExperiences(ws, [
      base,
      { ...base, start: "2024", end: "2027", event_type: "worked" },
      { ...base, start: "2019", end: undefined, event_type: "lived" },
      { ...base, start: "2023", end: undefined, time_precision: "unknown", event_type: "visit" },
      { ...base, start: "2030", end: undefined, event_type: "travel" },
      { ...base, start: "2018", end: undefined, fact_status: "inferred", event_type: "travel" },
      { ...base, start: "2028", end: undefined, fact_status: "planned", event_type: "travel" },
    ]);
    const map = lifeMap(ws, new Date("2026-10-16T12:00:00Z"));
    expect(map.experiences).toHaveLength(7);
    expect(
      map.features
        .find((f) => f.properties.layer === "now")
        ?.properties.experiences.map((e) => e.event_type)
        .sort(),
    ).toEqual(["lived", "worked"]);
    expect(map.review.map((e) => e.start).sort()).toEqual(["2018", "2030"]);
    expect(map.undated).toBe(1);
    expect((await readOverviewPage(ws, new Date("2026-10-16T12:00:00Z"))).sync).toMatchObject({
      needsReview: 2,
      mapNeedsReview: 2,
    });
    expect(experienceYears(map.experiences, map.asOf)).toContain("2021");
    expect(
      map.experiences
        .filter((e) => experienceOverlaps(e, "2021-06-01", "2021-06-30"))
        .map((e) => e.start)
        .sort(),
    ).toEqual(["2019", "2020-06-01"]);
    expect(experienceOverlaps(base, "2020-02-01", "2020-02-01")).toBe(true);
    expect(experienceOverlaps(base, "2022-12-31", "2022-12-31")).toBe(true);
    expect(experienceOverlaps(base, "2023-01-01", undefined)).toBe(false);
    expect(experienceOverlaps(base, "2022-02-02", "2022-01-01")).toBe(false);
    expect(partialDateBounds("2024-02")?.to).toBe("2024-02-29");
  } finally {
    rmSync(ws.root, { recursive: true, force: true });
  }
});

it("只按经历的已有来源读取原文，定位行号，限制大文件，并拒绝越界和隐藏状态链接", async () => {
  const ws = await freshWorkspace();
  try {
    ws.writeText(
      "memory/life.md",
      Array.from({ length: 40 }, (_, i) => (i === 19 ? "2021 年在河内生活的原文" : "另一段资料")).join("\n"),
    );
    const chat = Array.from({ length: 40000 }, (_, i) => `对话段落 ${i + 1}`);
    chat[29999] = "这次到访的证据只在这里";
    ws.writeText("chats/source.jsonl", chat.join("\n"));
    symlinkSync(ws.resolve(".kaitu/config.json", { internal: true }), ws.resolve("memory/alias.md"));
    const base: ExperienceInput = {
      place: { name: "Hanoi", country: "VN" },
      event_type: "travel",
      fact_status: "user_reported",
      time_precision: "unknown",
      source: "memory/life.md#L20",
    };
    const sources = [
      base.source,
      "chats/source.jsonl#L30000",
      "memory/missing.md",
      "https://example.com/trip",
      "javascript:alert(1)",
      "memory/alias.md",
      "../outside.md",
    ];
    const rows = (
      await addExperiences(
        ws,
        sources.map((source) => ({ ...base, source })),
      )
    ).entries;
    const id = (index: number) => {
      const row = rows[index];
      if (!row) throw new Error("缺少经历");
      return row.id;
    };
    const local = await readExperienceSource(ws, id(0));
    expect(local).toMatchObject({ kind: "local", focusLine: 20, firstLine: 12 });
    if (local.kind !== "local") throw new Error("缺少原文");
    expect(local.text.split("\n")[8]).toBe("2021 年在河内生活的原文");
    const large = await readExperienceSource(ws, id(1));
    expect(large).toMatchObject({ kind: "local", truncated: true });
    if (large.kind === "local") {
      expect(large.focusLine).toBe(30000);
      expect(large.text).toContain("这次到访的证据只在这里");
      expect(Buffer.byteLength(large.text)).toBeLessThanOrEqual(256 * 1024 + 3);
    }
    expect((await readExperienceSource(ws, id(2))).kind).toBe("unavailable");
    expect(await readExperienceSource(ws, id(3))).toMatchObject({
      kind: "external",
      url: "https://example.com/trip",
    });
    expect((await readExperienceSource(ws, id(4))).kind).toBe("unavailable");
    for (const index of [5, 6]) await expect(readExperienceSource(ws, id(index))).rejects.toThrow();
    await expect(readExperienceSource(ws, "unknown")).rejects.toThrow();
  } finally {
    rmSync(ws.root, { recursive: true, force: true });
  }
});
