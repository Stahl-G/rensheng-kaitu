import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { processInbox } from "../src/inbox.js";
import { readRecords } from "../src/records.js";
import { freshWorkspace } from "./helpers.js";

it("外部健康文件夹的样本被拉入收件箱入库，原件移除，未写完的文件留到下一轮", async () => {
  const ws = await freshWorkspace("Asia/Ho_Chi_Minh");
  const external = join(ws.root, "..", "kaitu-external-health-test");
  mkdirSync(external, { recursive: true });
  const config = ws.readJson(".kaitu/config.json") as Record<string, unknown>;
  config.health_inbox_external = [external];
  ws.writeJson(".kaitu/config.json", config, { internal: true });
  const at = "2026-10-16T08:00:00+07:00";
  writeFileSync(
    join(external, "2026-10-16-abc12345.health.json"),
    JSON.stringify({
      format: "kaitu.health.v1",
      exported_at: at,
      device: "iPhone",
      samples: [{ type: "step_count", value: 100, unit: "count", start: at, end: at, source: "iPhone" }],
    }),
  );
  writeFileSync(join(external, "partial.health.json"), "{ 还在写");
  await processInbox(ws, { stableMs: 0 });
  expect(readRecords(ws, "activity")[0]?.steps).toBe(100);
  expect(existsSync(join(external, "2026-10-16-abc12345.health.json"))).toBe(false);
  expect(existsSync(join(external, "partial.health.json"))).toBe(true);
});
