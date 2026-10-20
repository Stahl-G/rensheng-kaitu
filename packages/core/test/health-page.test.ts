import { expect, it } from "vitest";
import { addRecord, deleteRecord, readHealthPage, updateRecord } from "../src/index.js";
import { holdOverview } from "../src/overview.js";
import { localTimeToInstant } from "../src/time.js";
import { freshWorkspace, workout } from "./helpers.js";

it("训练投影保留月界、热力图边界和跨月修订，未来与删除记录不混入统计", async () => {
  for (const zone of ["Pacific/Kiritimati", "America/Los_Angeles"]) {
    const ws = await freshWorkspace(zone);
    holdOverview(ws);
    const instant = (wall: string) => localTimeToInstant(wall, zone);
    const add = (wall: string, name: string) =>
      addRecord(ws, "workout", { ...workout, exercise: name, ts: instant(wall).toISOString() });
    const now = instant("2026-03-01T12:00:00");
    add("2026-01-25T23:59:59", "热力图前一秒");
    add("2026-01-26T00:00:00", "热力图第一天");
    add("2026-02-01T00:00:00", "上月第一秒");
    add("2026-02-28T23:59:59", "上月最后一秒");
    add("2026-03-01T00:00:00", "本月第一秒");
    add("2026-03-01T23:59:59", "尚未发生");
    const movedIn = add("2026-01-25T12:00:00", "修正到上月");
    updateRecord(ws, "workout", movedIn.record.id, {
      ts: instant("2026-02-28T12:00:00").toISOString(),
      session_id: "another-session",
    });
    const movedOut = add("2026-02-01T12:00:00", "修正到更早");
    updateRecord(ws, "workout", movedOut.record.id, { ts: instant("2026-01-25T12:00:00").toISOString() });
    const removed = add("2026-03-01T01:00:00", "已删除");
    deleteRecord(ws, "workout", removed.record.id);

    const { training } = readHealthPage(ws, now);
    expect(training.previousMonth).toBe(3);
    expect(training.month).toBe(1);
    expect(training.week).toBe(3);
    expect(training.heatmap[0]).toMatchObject({ date: "2026-01-26", sessions: 1, repetitions: 36 });
    expect(training.heatmap.find((day) => day.date === "2026-02-28")).toMatchObject({
      sessions: 2,
      repetitions: 72,
    });
    expect(
      training.recent.flatMap((session) => session.exercises.map((exercise) => exercise.name)).sort(),
    ).toEqual(["上月最后一秒", "上月第一秒", "修正到上月", "本月第一秒"].sort());
  }
});
