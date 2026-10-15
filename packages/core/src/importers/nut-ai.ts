import { readFileSync } from "node:fs";
import { KaituError } from "../errors.js";
import { isoInZone } from "../time.js";
import type { Workspace } from "../workspace.js";
import { type Candidate, candidate, importBatch } from "./batch.js";

type Row = Record<string, unknown>;
function object(value: unknown): Row {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid object");
  return value as Row;
}
function number(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("Invalid number");
  return value;
}

export async function importNutAi(ws: Workspace, inputFile: string, opts: { dryRun?: boolean } = {}) {
  const zone = ws.timeZone();
  const candidates: Candidate[] = [];
  const ignored = { meals_without_items: 0, exercise_entries: 0 };
  try {
    const backup = object(JSON.parse(readFileSync(inputFile, "utf8")));
    if (backup.format !== "nutai.backup" || backup.format_version !== 1) throw new Error("Invalid format");
    const tables = object(backup.tables);
    const rows = (name: string): Row[] => {
      const value = tables[name] ?? [];
      if (!Array.isArray(value)) throw new Error("Invalid table");
      return value.map(object);
    };
    const timestamp = (value: unknown): string => {
      const date = new Date(number(value));
      const iso = isoInZone(date, zone);
      const ms = date.getUTCMilliseconds();
      return ms ? `${iso.slice(0, 19)}.${String(ms).padStart(3, "0")}${iso.slice(19)}` : iso;
    };
    const items = new Map<unknown, Row[]>();
    for (const item of rows("log_items")) items.set(item.meal_id, [...(items.get(item.meal_id) ?? []), item]);
    const slots: Record<string, string> = { breakfast: "早", lunch: "午", dinner: "晚", snack: "加餐" };
    for (const meal of rows("meals")) {
      const logItems = items.get(meal.id) ?? [];
      if (!logItems.length) {
        ignored.meals_without_items++;
        continue;
      }
      const ts = timestamp(meal.logged_at);
      const hour = Number(ts.slice(11, 13));
      const inferred = hour < 11 ? "早" : hour < 16 ? "午" : hour < 21 ? "晚" : "加餐";
      const slot = meal.meal_slot == null ? inferred : slots[String(meal.meal_slot)];
      if (!slot) throw new Error("Invalid meal slot");
      const portion = number(meal.portion_eaten_fraction ?? 1);
      if (portion < 0 || portion > 1) throw new Error("Invalid portion");
      const sum = (field: string) =>
        logItems.reduce((total, item) => total + number(item[field] ?? 0), 0) * portion;
      candidates.push(
        candidate("meal", {
          ts,
          meal: slot,
          items: logItems.map((item) => {
            if (typeof item.display_name !== "string") throw new Error("Invalid item name");
            return {
              name: item.display_name,
              ...(item.grams == null ? {} : { grams: number(item.grams) * portion }),
            };
          }),
          kcal: sum("snap_energy_kcal"),
          protein_g: sum("snap_protein_g"),
          carbs_g: sum("snap_carb_g"),
          fat_g: sum("snap_fat_g"),
          ...(logItems.some((item) => item.band_half_pct != null)
            ? {
                uncertainty:
                  logItems.reduce(
                    (total, item) =>
                      total + (number(item.snap_energy_kcal ?? 0) * number(item.band_half_pct ?? 0)) / 100,
                    0,
                  ) * portion,
              }
            : {}),
          source: "nut-ai",
        }),
      );
    }
    for (const entry of rows("weight_entries")) {
      candidates.push(
        candidate("metric", {
          ts: timestamp(entry.logged_at),
          kind: "weight",
          value: number(entry.weight_kg),
          unit: "kg",
          source: "nut-ai",
        }),
      );
    }
    ignored.exercise_entries = rows("exercise_entries").length;
  } catch {
    throw new KaituError("Nut AI 备份格式不合法或无法读取", "INVALID_IMPORT");
  }
  return importBatch(ws, "nut-ai", candidates, { ...opts, ignored });
}
