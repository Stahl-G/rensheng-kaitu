import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { history, restore } from "../src/history.js";
import { importHealthShortcut } from "../src/importers/apple-health.js";
import { processInbox } from "../src/inbox.js";
import { addRecords, readRecords } from "../src/records.js";
import { validateWorkspace } from "../src/validate.js";
import { freshWorkspace, tmp } from "./helpers.js";

it("三个健康域与基础指标混合入库，时区等价重传不重复，修订保留 ID 且整批可恢复", async () => {
  const ws = await freshWorkspace("Asia/Ho_Chi_Minh");
  try {
    const initial = (await history(ws))[0]?.oid as string;
    const stamp = "2026-10-15T23:45:00+07:00";
    const sample = (type: string, value: number | string, start = stamp, unit = "") => ({
      type,
      value,
      start,
      end: start,
      unit,
      source: "synthetic-Watch",
    });
    const severities = ["mild", "moderate", "severe", "unspecified"];
    const kinds = [
      "abdominal_cramps",
      "chest_tightness_or_pain",
      "coughing",
      "dizziness",
      "fatigue",
      "headache",
      "nausea",
      "shortness_of_breath",
      "sore_throat",
      "chills",
    ];
    const valences = [
      "very_unpleasant",
      "unpleasant",
      "slightly_unpleasant",
      "neutral",
      "slightly_pleasant",
      "pleasant",
      "very_pleasant",
    ];
    const hearts = ["high_heart_rate", "low_heart_rate", "irregular_rhythm"];
    const envelope = {
      format: "kaitu.health.v1",
      exported_at: "2026-10-16T00:10:00+07:00",
      device: "synthetic-iPhone",
      samples: [
        sample("step_count", 1000, stamp, "count"),
        sample("hrv_sdnn", 42, stamp, "ms"),
        ...kinds.map((kind, index) =>
          sample(`symptom_${kind}`, severities[index % severities.length] as string),
        ),
        sample("symptom_appetite_changes", "increased"),
        ...valences.map((valence, index) =>
          sample("state_of_mind", valence, `2026-10-16T00:0${index}:00+07:00`),
        ),
        ...hearts.map((kind) => sample("heart_notification", kind)),
      ],
    };
    const input = join(tmp(), "mixed.health.json");
    writeFileSync(input, JSON.stringify(envelope));
    const preview = await importHealthShortcut(ws, input, { dryRun: true });
    expect(preview.added).toBe(23);
    expect(await history(ws)).toHaveLength(1);
    expect(readRecords(ws, "symptom")).toEqual([]);
    const inbox = "inbox/health/mixed.health.json";
    ws.writeJson(inbox, envelope);
    expect((await processInbox(ws, { stableMs: 0 })).processed).toEqual([inbox]);
    expect(readRecords(ws, "activity")).toMatchObject([{ date: "2026-10-15", steps: 1000 }]);
    expect(readRecords(ws, "metric")).toMatchObject([{ kind: "hrv_sdnn", value: 42, unit: "ms" }]);
    const symptoms = readRecords(ws, "symptom");
    expect(symptoms).toHaveLength(11);
    expect(symptoms.find((row) => row.kind === "appetite_changes")).toMatchObject({
      appetite_change: "increased",
    });
    expect(symptoms.find((row) => row.kind === "appetite_changes")).not.toHaveProperty("severity");
    expect(readRecords(ws, "mood").map((row) => row.valence)).toEqual(valences);
    expect(
      readRecords(ws, "heart_notification")
        .map((row) => row.kind)
        .sort(),
    ).toEqual([...hearts].sort());
    expect(readRecords(ws, "event")).toEqual([]);
    const versions = await history(ws);
    expect(versions).toHaveLength(2);
    envelope.samples = envelope.samples.map((row) => ({
      ...row,
      start: new Date(row.start).toISOString(),
      end: new Date(row.end).toISOString(),
    }));
    writeFileSync(input, JSON.stringify(envelope));
    expect((await importHealthShortcut(ws, input)).version).toBeNull();
    expect(await history(ws)).toEqual(versions);
    const oldHeadache = symptoms.find((row) => row.kind === "headache");
    const oldMood = readRecords(ws, "mood").find((row) => row.valence === "slightly_pleasant");
    envelope.samples = envelope.samples.map((row) =>
      row.type === "symptom_headache"
        ? { ...row, value: "severe" }
        : row.type === "state_of_mind" && row.value === "slightly_pleasant"
          ? { ...row, value: "neutral" }
          : row,
    );
    writeFileSync(input, JSON.stringify(envelope));
    expect((await importHealthShortcut(ws, input)).updated).toBe(2);
    expect(readRecords(ws, "symptom").find((row) => row.kind === "headache")).toMatchObject({
      id: oldHeadache?.id,
      severity: "severe",
      rev: 2,
    });
    expect(readRecords(ws, "mood").find((row) => row.id === oldMood?.id)).toMatchObject({
      valence: "neutral",
      rev: 2,
    });
    expect(validateWorkspace(ws)).toEqual([]);
    await restore(ws, initial);
    for (const type of ["activity", "metric", "symptom", "mood", "heart_notification"])
      expect(readRecords(ws, type)).toEqual([]);
  } finally {
    rmSync(ws.root, { recursive: true, force: true });
  }
});

it("非法事件使整份手机文件保留为笔记，不部分导入，症状字段互斥也在直接写入时生效", async () => {
  const ws = await freshWorkspace();
  try {
    const base = {
      start: "2026-10-16T01:00:00+08:00",
      end: "2026-10-16T01:00:00+08:00",
      source: "synthetic-Watch",
      unit: "",
    };
    const invalid = [
      { type: "symptom_headache", value: "extreme" },
      { type: "symptom_body_aches", value: "mild" },
      { type: "symptom_appetite_changes", value: "mild" },
      { type: "state_of_mind", value: "unknown" },
      { type: "heart_notification", value: "diagnosis" },
      { type: "heart_notification", value: "high_heart_rate", unit: "bpm" },
      { type: "state_of_mind", value: "neutral", end: "2026-10-15T01:00:00+08:00" },
    ];
    for (const [index, event] of invalid.entries()) {
      ws.writeJson(`inbox/health/bad-${index}.health.json`, {
        format: "kaitu.health.v1",
        exported_at: base.start,
        device: "synthetic-iPhone",
        samples: [
          { ...base, type: "step_count", value: 100, unit: "count" },
          { ...base, ...event },
        ],
      });
      const result = await processInbox(ws, { stableMs: 0 });
      expect(result.processed).toEqual([]);
      expect(result.notes).toHaveLength(1);
      for (const type of ["activity", "symptom", "mood", "heart_notification"])
        expect(readRecords(ws, type)).toEqual([]);
    }
    for (const data of [
      { kind: "appetite_changes", severity: "mild" },
      { kind: "appetite_changes", appetite_change: "increased", severity: "mild" },
      { kind: "headache", severity: "mild", appetite_change: "decreased" },
    ])
      expect(() => addRecords(ws, "symptom", [{ ...data, source: "user" }])).toThrow();
    expect(validateWorkspace(ws)).toEqual([]);
  } finally {
    rmSync(ws.root, { recursive: true, force: true });
  }
});
