import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { strToU8, zipSync } from "fflate";
import { expect, it } from "vitest";
import { history, restore } from "../src/history.js";
import { importAppleHealth } from "../src/importers/apple-health.js";
import { readRecords } from "../src/records.js";
import { validateWorkspace } from "../src/validate.js";
import { freshWorkspace, tmp } from "./helpers.js";

const fixture = new URL("../../../examples/apple-health/export.xml", import.meta.url);

it("Apple Health：流式 zip 映射、按来源聚合、跨月切分，幂等且整次可恢复", async () => {
  const ws = await freshWorkspace();
  const initial = (await history(ws))[0]?.oid as string;
  const zip = join(tmp(), "export.zip");
  writeFileSync(
    zip,
    zipSync({
      "apple_health_export/export.xml": readFileSync(fixture),
      "apple_health_export/export_cda.xml": strToU8("不是 HealthData"),
    }),
  );
  const preview = await importAppleHealth(ws, zip, { dryRun: true });
  expect(preview.added).toBe(9);
  expect(readRecords(ws, "metric")).toEqual([]);
  expect(await history(ws)).toHaveLength(1);
  const result = await importAppleHealth(ws, zip);
  expect(result.version).not.toBeNull();
  expect(result.ignored.unsupported).toBe(4);
  const metrics = readRecords(ws, "metric");
  expect(metrics).toHaveLength(6);
  expect(metrics.find((r) => r.kind === "weight")).toMatchObject({
    value: 154 * 0.45359237,
    ts: "2026-10-01T04:00:00+08:00",
    unit: "kg",
    by: "import:apple-health",
  });
  for (const [kind, value] of [
    ["body_fat", 18],
    ["height", 175],
    ["glucose", 5],
    ["resting_hr", 58],
    ["bp", "120/80"],
  ]) {
    expect(metrics.find((r) => r.kind === kind)?.value).toBe(value);
  }
  expect(readRecords(ws, "activity")).toMatchObject([
    { date: "2026-09-30", steps: 100 },
    { date: "2026-10-01", steps: 400, active_kcal: 300, total_kcal: 1800 },
  ]);
  expect(readRecords(ws, "sleep")).toMatchObject([
    {
      start: "2026-09-30T23:00:00+08:00",
      end: "2026-10-01T06:00:00+08:00",
      duration_min: 390,
    },
  ]);
  expect(validateWorkspace(ws)).toEqual([]);
  const versions = await history(ws);
  expect(versions).toHaveLength(2);
  expect((await importAppleHealth(ws, fixture.pathname)).version).toBeNull();
  expect(await history(ws)).toEqual(versions);
  await restore(ws, initial);
  for (const type of ["metric", "activity", "sleep"]) expect(readRecords(ws, type)).toEqual([]);
});

it("Apple Health：非法 XML 不留下整批中的前一条记录", async () => {
  const ws = await freshWorkspace();
  const file = join(tmp(), "export.xml");
  writeFileSync(file, readFileSync(fixture, "utf8").replace("</HealthData>", "<broken></HealthData>"));
  await expect(importAppleHealth(ws, file)).rejects.toThrow();
  expect(readRecords(ws, "metric")).toEqual([]);
  expect(await history(ws)).toHaveLength(1);
});
