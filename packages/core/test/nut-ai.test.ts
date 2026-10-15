import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { history, restore } from "../src/history.js";
import { importNutAi } from "../src/importers/nut-ai.js";
import { readRecords } from "../src/records.js";
import { validateWorkspace } from "../src/validate.js";
import { freshWorkspace, tmp } from "./helpers.js";

it("Nut AI：毫秒时间、portion 与误差映射，预览、追加修改、幂等与恢复", async () => {
  const ws = await freshWorkspace();
  const initial = (await history(ws))[0]?.oid as string;
  const file = join(tmp(), "backup.json");
  const backup = JSON.parse(
    readFileSync(new URL("../../../examples/nut-ai-backup.json", import.meta.url), "utf8"),
  );
  writeFileSync(file, JSON.stringify(backup));
  const preview = await importNutAi(ws, file, { dryRun: true });
  expect(preview.added).toBe(2);
  expect(preview.ignored).toEqual({ meals_without_items: 1, exercise_entries: 1 });
  expect(readRecords(ws, "meal")).toEqual([]);
  expect(await history(ws)).toHaveLength(1);
  await importNutAi(ws, file);
  expect(readRecords(ws, "meal")).toMatchObject([
    {
      ts: "2026-10-01T00:30:00.125+08:00",
      meal: "早",
      kcal: 300,
      protein_g: 25,
      fat_g: 7.5,
      carbs_g: 25,
      uncertainty: 40,
      items: [
        { name: "合成豆饭", grams: 100 },
        { name: "合成配菜", grams: 50 },
      ],
    },
  ]);
  expect(readRecords(ws, "metric")).toMatchObject([
    { kind: "weight", value: 70, ts: "2026-10-01T04:00:00+08:00" },
  ]);
  expect(await history(ws)).toHaveLength(2);
  expect((await importNutAi(ws, file)).version).toBeNull();
  expect(await history(ws)).toHaveLength(2);
  const id = readRecords(ws, "meal")[0]?.id;
  backup.tables.meals[0].portion_eaten_fraction = 1;
  for (const item of backup.tables.log_items) item.band_half_pct = undefined;
  writeFileSync(file, JSON.stringify(backup));
  expect((await importNutAi(ws, file, { dryRun: true })).updated).toBe(1);
  expect(readRecords(ws, "meal")[0]?.kcal).toBe(300);
  expect((await importNutAi(ws, file)).updated).toBe(1);
  expect(readRecords(ws, "meal")[0]).toMatchObject({ id, rev: 2, kcal: 600 });
  expect(readRecords(ws, "meal")[0]).not.toHaveProperty("uncertainty");
  expect(validateWorkspace(ws)).toEqual([]);
  backup.format = "another.format";
  writeFileSync(file, JSON.stringify(backup));
  await expect(importNutAi(ws, file)).rejects.toThrow();
  expect(await history(ws)).toHaveLength(3);
  await restore(ws, initial);
  expect(readRecords(ws, "meal")).toEqual([]);
  expect(readRecords(ws, "metric")).toEqual([]);
});
