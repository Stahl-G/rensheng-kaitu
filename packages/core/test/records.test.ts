import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { addRecord, deleteRecord, readRecords, updateRecord } from "../src/index.js";
import { freshWorkspace, workout } from "./helpers.js";

const lines = (root: string, rel: string) => readFileSync(join(root, rel), "utf8").trim().split("\n");

describe("记录追加语义", () => {
  it("修改追加新版本，读取取最新；原行不动", async () => {
    const ws = await freshWorkspace();
    const { record, file } = addRecord(ws, "workout", { ...workout, ts: "2026-10-15T20:00:00+08:00" });
    updateRecord(ws, "workout", record.id, { weight_kg: 62.5 }, { by: "user" });

    expect(lines(ws.root, file)).toHaveLength(2);
    expect(JSON.parse(lines(ws.root, file)[0] as string).weight_kg).toBe(60);
    const [latest] = readRecords(ws, "workout");
    expect(latest).toMatchObject({ id: record.id, weight_kg: 62.5, rev: 2, by: "user", exercise: "深蹲" });
  });

  it("删除追加删除标记，读取时消失；不能修改已删除的记录", async () => {
    const ws = await freshWorkspace();
    const a = addRecord(ws, "workout", workout).record;
    const b = addRecord(ws, "workout", { ...workout, exercise: "卧推" }).record;
    deleteRecord(ws, "workout", a.id);
    expect(readRecords(ws, "workout").map((r) => r.id)).toEqual([b.id]);
    expect(() => updateRecord(ws, "workout", a.id, { sets: 4 })).toThrow(/找不到/);
  });

  it("修改把 ts 挪到别的月份后，按新月份存放，旧月份不再返回旧版本", async () => {
    const ws = await freshWorkspace();
    const { record } = addRecord(ws, "workout", { ...workout, ts: "2026-10-31T20:00:00+08:00" });
    const moved = updateRecord(ws, "workout", record.id, { ts: "2026-11-01T09:00:00+08:00" });
    expect(moved.file).toBe("health/data/workouts/2026-11.jsonl");
    expect(readRecords(ws, "workout", { from: "2026-10-01", to: "2026-10-31" })).toEqual([]);
    expect(readRecords(ws, "workout", { from: "2026-11-01" })).toHaveLength(1);
  });

  it("用户提供的 id、by、rev 会被忽略", async () => {
    const ws = await freshWorkspace();
    const { record } = addRecord(ws, "workout", { ...workout, id: "X", by: "user", rev: 9 }, { by: "agent" });
    expect(record.id).not.toBe("X");
    expect(record.by).toBe("agent");
    expect(record.rev).toBeUndefined();
  });

  it("非法记录不会写入", async () => {
    const ws = await freshWorkspace();
    expect(() => addRecord(ws, "workout", { exercise: "深蹲" })).toThrow(/不合法/);
    expect(ws.exists("health/data/workouts")).toBe(false);
    expect(() => addRecord(ws, "nope", {})).toThrow(/没有模块定义/);
  });
});

describe("时区与日期切分", () => {
  it("按用户时区切分月份：UTC 10-31 17:30 在上海已是 11-01", async () => {
    const ws = await freshWorkspace("Asia/Shanghai");
    expect(addRecord(ws, "workout", { ...workout, ts: "2026-10-31T17:30:00Z" }).file).toBe(
      "health/data/workouts/2026-11.jsonl",
    );
    expect(addRecord(ws, "workout", { ...workout, ts: "2026-10-31T15:59:59Z" }).file).toBe(
      "health/data/workouts/2026-10.jsonl",
    );
    expect(readRecords(ws, "workout", { from: "2026-11-01", to: "2026-11-01" })).toHaveLength(1);
  });

  it("同一时刻在西半球时区落在前一天", async () => {
    const ws = await freshWorkspace("America/Los_Angeles");
    expect(addRecord(ws, "workout", { ...workout, ts: "2026-11-01T03:00:00Z" }).file).toBe(
      "health/data/workouts/2026-10.jsonl",
    );
  });

  it("未提供 ts 时生成带本地偏移的时间", async () => {
    const ws = await freshWorkspace("Asia/Shanghai");
    const { record, file } = addRecord(ws, "workout", workout, { now: new Date("2026-12-31T16:30:00Z") });
    expect(record.ts).toBe("2027-01-01T00:30:00+08:00");
    expect(file).toBe("health/data/workouts/2027-01.jsonl");
  });

  it("夏令时切换前后偏移正确", async () => {
    const ws = await freshWorkspace("America/New_York");
    expect(addRecord(ws, "workout", workout, { now: new Date("2026-03-08T06:59:00Z") }).record.ts).toBe(
      "2026-03-08T01:59:00-05:00",
    );
    expect(addRecord(ws, "workout", workout, { now: new Date("2026-03-08T07:00:00Z") }).record.ts).toBe(
      "2026-03-08T03:00:00-04:00",
    );
  });

  it("拒绝不带时区偏移的时间", async () => {
    const ws = await freshWorkspace();
    expect(() => addRecord(ws, "workout", { ...workout, ts: "2026-10-15T20:00:00" })).toThrow(/时区偏移/);
  });
});
