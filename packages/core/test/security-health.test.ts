import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { parseHealthInWorker } from "../src/health-import.js";
import { initWorkspace, processInbox, readRecords } from "../src/index.js";
import { syncInventory } from "../src/sync-files.js";

it("异常健康跨度在可终止线程中整批拒绝，事件循环可响应，自动导入保存整份原件为待整理附件", async () => {
  const temp = mkdtempSync(join(tmpdir(), "kaitu-health-security-"));
  try {
    const ws = await initWorkspace(join(temp, "workspace"));
    const normal = {
      type: "step_count",
      source: "synthetic",
      unit: "count",
      value: 100,
      start: "2026-10-16T09:00:00Z",
      end: "2026-10-16T09:05:00Z",
    };
    const envelope = (samples: unknown[]) =>
      JSON.stringify({
        format: "kaitu.health.v1",
        device: "synthetic",
        exported_at: "2026-10-16T12:00:00Z",
        samples,
      });
    const healthy = join(temp, "normal.health.json");
    writeFileSync(healthy, envelope([normal]));
    expect((await parseHealthInWorker(healthy, "UTC", true)).candidates).toHaveLength(1);
    const bytes = envelope([
      normal,
      { ...normal, start: "0001-01-01T00:00:00Z", end: "9999-12-31T00:00:00Z" },
    ]);
    ws.writeText("inbox/health/oversize.health.json", bytes);
    const parsing = parseHealthInWorker(ws.resolve("inbox/health/oversize.health.json"), "UTC", true);
    const responsive = await Promise.race([
      parsing.then(
        () => false,
        () => false,
      ),
      new Promise<boolean>((resolve) => setImmediate(() => resolve(true))),
    ]);
    expect(responsive).toBe(true);
    await expect(parsing).rejects.toThrow();
    const result = await processInbox(ws, { stableMs: 0 });
    expect(result.notes).toHaveLength(1);
    expect(readRecords(ws, "activity")).toEqual([]);
    expect(ws.exists("inbox/health/oversize.health.json")).toBe(false);
    const attachment = syncInventory(ws.root, "inbox/notes").files.find((file) =>
      file.endsWith("oversize.health.json"),
    );
    expect(attachment).toBeTruthy();
    expect(readFileSync(ws.resolve(attachment as string), "utf8")).toBe(bytes);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
