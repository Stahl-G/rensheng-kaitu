import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { history, restore } from "../src/history.js";
import { importAppleHealth } from "../src/importers/apple-health.js";
import { processInbox } from "../src/inbox.js";
import { readRecords } from "../src/records.js";
import { validateWorkspace } from "../src/validate.js";
import { freshWorkspace, tmp } from "./helpers.js";

it("HRV 从手机收件箱入库，XML 秒值命中同一记录，修订与整批恢复正确", async () => {
  const ws = await freshWorkspace("Asia/Ho_Chi_Minh");
  const initial = (await history(ws))[0]?.oid as string;
  const file = "inbox/health/hrv.health.json";
  const envelope = {
    format: "kaitu.health.v1",
    exported_at: "2026-10-16T00:00:00+07:00",
    device: "synthetic-iPhone",
    samples: [
      {
        type: "hrv_sdnn",
        start: "2026-10-15T23:30:00+07:00",
        end: "2026-10-15T23:31:00+07:00",
        value: 42,
        unit: "ms",
        source: "synthetic-Watch",
      },
    ],
  };
  ws.writeJson(file, envelope);
  expect((await processInbox(ws, { stableMs: 0 })).processed).toEqual([file]);
  const imported = readRecords(ws, "metric");
  expect(imported).toMatchObject([
    {
      kind: "hrv_sdnn",
      value: 42,
      unit: "ms",
      ts: "2026-10-15T23:30:00+07:00",
      by: "import:apple-health",
      source: "apple-health",
    },
  ]);
  const versions = await history(ws);
  const xml = join(tmp(), "export.xml");
  writeFileSync(
    xml,
    `<HealthData><Record type="HKQuantityTypeIdentifierHeartRateVariabilitySDNN"
    startDate="2026-10-15 16:30:00 +0000" endDate="2026-10-15 16:31:00 +0000"
    value="0.042" unit="s" sourceName="synthetic-Watch"/></HealthData>`,
  );
  expect((await importAppleHealth(ws, xml)).version).toBeNull();
  expect(await history(ws)).toEqual(versions);
  envelope.samples = envelope.samples.map((sample) => ({ ...sample, value: 50 }));
  ws.writeJson(file, envelope);
  await processInbox(ws, { stableMs: 0 });
  expect(readRecords(ws, "metric")).toMatchObject([{ id: imported[0]?.id, value: 50, rev: 2 }]);
  expect(validateWorkspace(ws)).toEqual([]);
  await restore(ws, initial);
  expect(readRecords(ws, "metric")).toEqual([]);
});
