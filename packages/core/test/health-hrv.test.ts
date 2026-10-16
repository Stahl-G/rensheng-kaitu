import { expect, it } from "vitest";
import { processInbox } from "../src/inbox.js";
import { readRecords } from "../src/records.js";
import { freshWorkspace } from "./helpers.js";

it("手机导出的 HRV、症状、情绪和心脏通知进收件箱后各自入库", async () => {
  const ws = await freshWorkspace("Asia/Ho_Chi_Minh");
  const at = "2026-10-15T23:30:00+07:00";
  const sample = (type: string, value: number | string, unit = "") => ({
    type,
    value,
    unit,
    start: at,
    end: at,
    source: "Apple Watch",
  });
  ws.writeJson("inbox/health/today.health.json", {
    format: "kaitu.health.v1",
    exported_at: "2026-10-16T00:00:00+07:00",
    device: "iPhone",
    samples: [
      sample("hrv_sdnn", 42, "ms"),
      sample("symptom_headache", "mild"),
      sample("state_of_mind", "slightly_pleasant"),
      sample("heart_notification", "high_heart_rate"),
    ],
  });
  await processInbox(ws, { stableMs: 0 });
  expect(readRecords(ws, "metric")).toMatchObject([{ kind: "hrv_sdnn", value: 42, unit: "ms" }]);
  expect(readRecords(ws, "symptom")).toMatchObject([{ kind: "headache", severity: "mild" }]);
  expect(readRecords(ws, "mood")).toMatchObject([{ valence: "slightly_pleasant" }]);
  expect(readRecords(ws, "heart_notification")).toMatchObject([{ kind: "high_heart_rate" }]);
});
