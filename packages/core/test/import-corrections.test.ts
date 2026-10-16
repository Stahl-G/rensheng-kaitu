import { rmSync } from "node:fs";
import { expect, it } from "vitest";
import { importIcs } from "../src/importers/ics.js";
import { deleteRecord, readRecords, updateRecord } from "../src/records.js";
import { freshWorkspace } from "./helpers.js";

it("重新同步日历保留人工改期和删除，不生成重复事件，也不新建版本", async () => {
  const ws = await freshWorkspace();
  try {
    const fixture = new URL("../../../examples/calendar.ics", import.meta.url).pathname;
    const window = { from: "2026-10-01", to: "2026-10-31" };
    await importIcs(ws, fixture, window);
    const [rescheduled, removed] = readRecords(ws, "event");
    if (!rescheduled || !removed) throw new Error("应已导入多个事件");
    updateRecord(
      ws,
      "event",
      rescheduled.id,
      {
        start: "2026-10-18T10:00:00+08:00",
        end: "2026-10-18T11:00:00+08:00",
      },
      { by: "user" },
    );
    deleteRecord(ws, "event", removed.id, { by: "user" });
    const before = readRecords(ws, "event");
    const preview = await importIcs(ws, fixture, { ...window, dryRun: true });
    expect(preview).toMatchObject({ added: 0, updated: 0, deleted: 0 });
    const result = await importIcs(ws, fixture, window);
    expect(result.version).toBeNull();
    expect(readRecords(ws, "event")).toEqual(before);
    expect(before.find((row) => row.id === rescheduled.id)?.start).toBe("2026-10-18T10:00:00+08:00");
    expect(before.some((row) => row.id === removed.id)).toBe(false);
  } finally {
    rmSync(ws.root, { recursive: true, force: true });
  }
});
