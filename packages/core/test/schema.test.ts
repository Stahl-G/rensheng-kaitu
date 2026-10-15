import { describe, expect, it } from "vitest";
import { schemas, validateWorkspace } from "../src/index.js";
import { freshWorkspace } from "./helpers.js";

const base = { id: "01J9Z8Y7X6W5V4T3S2R1Q0P9N8", ts: "2026-10-15T21:00:00+08:00", by: "agent" };

function valid(name: string, data: unknown): boolean {
  return schemas().builtin(name)(data) as boolean;
}

describe("记录 schema", () => {
  it.each([
    [
      "workout.schema.json",
      { ...base, exercise: "深蹲", sets: 3, reps: 12, weight_kg: 60, session_id: "s1" },
    ],
    [
      "meal.schema.json",
      {
        ...base,
        meal: "午",
        items: [{ name: "鸡胸肉饭", grams: 350 }],
        kcal: 620,
        protein_g: 42,
        source: "manual",
      },
    ],
    ["supplement.schema.json", { ...base, name: "肌酸", amount: 5, unit: "g" }],
    [
      "sleep.schema.json",
      {
        ...base,
        start: "2026-10-14T23:40:00+08:00",
        end: "2026-10-15T06:50:00+08:00",
        duration_min: 430,
        source: "oura",
      },
    ],
    ["activity.schema.json", { ...base, date: "2026-10-15", steps: 8200, source: "apple-health" }],
    ["metric.schema.json", { ...base, kind: "weight", value: 72.5, unit: "kg", source: "manual" }],
    ["metric.schema.json", { ...base, kind: "bp", value: "120/80", unit: "mmHg", source: "manual" }],
    [
      "event.schema.json",
      {
        ...base,
        start: "2026-10-16T08:00:00+08:00",
        end: "2026-10-16T09:00:00+08:00",
        title: "周会",
        calendar: "工作",
        source: "ics",
      },
    ],
    [
      "event.schema.json",
      { ...base, start: "2026-10-17", end: "2026-10-18", title: "全天", calendar: "个人", source: "ics" },
    ],
    [
      "lab.schema.json",
      {
        ...base,
        date: "2026-09-30",
        items: [{ name: "LDL-C", value: 3.9, unit: "mmol/L", flag: "high" }],
        file: "files/a.pdf",
      },
    ],
    ["tombstone.schema.json", { ...base, rev: 2, deleted: true }],
  ])("%s 接受合法记录", (name, data) => {
    expect(valid(name, data)).toBe(true);
  });

  it.each([
    [
      "workout.schema.json",
      { ...base, exercise: "深蹲", sets: 3, reps: 12, session_id: "s1" },
      "缺 weight_kg",
    ],
    [
      "workout.schema.json",
      { ...base, exercise: "深蹲", sets: 0, reps: 12, weight_kg: 60, session_id: "s1" },
      "组数为 0",
    ],
    [
      "workout.schema.json",
      {
        ...base,
        ts: "2026-10-15T21:00:00",
        exercise: "深蹲",
        sets: 3,
        reps: 12,
        weight_kg: 60,
        session_id: "s1",
      },
      "ts 不带时区",
    ],
    [
      "workout.schema.json",
      { ...base, id: "not-a-ulid", exercise: "深蹲", sets: 3, reps: 12, weight_kg: 60, session_id: "s1" },
      "id 不是 ULID",
    ],
    [
      "workout.schema.json",
      { ...base, by: "someone", exercise: "深蹲", sets: 3, reps: 12, weight_kg: 60, session_id: "s1" },
      "by 非法",
    ],
    [
      "meal.schema.json",
      { ...base, meal: "夜宵", items: [{ name: "面" }], kcal: 500, protein_g: 10, source: "manual" },
      "餐次非法",
    ],
    [
      "meal.schema.json",
      { ...base, meal: "午", items: [], kcal: 500, protein_g: 10, source: "manual" },
      "没有食物",
    ],
    ["metric.schema.json", { ...base, kind: "Weight", value: 72, unit: "kg", source: "manual" }, "kind 大写"],
    ["tombstone.schema.json", { ...base, deleted: false }, "deleted 不是 true"],
  ])("%s 拒绝非法记录（%s）", (name, data) => {
    expect(valid(name, data)).toBe(false);
  });
});

describe("文件格式 schema", () => {
  it("对话逐行校验，拒绝非法消息和放错月份的文件", async () => {
    const ws = await freshWorkspace("Asia/Shanghai");
    const header = {
      type: "chat",
      id: "chat-1",
      title: "测试对话",
      source: "chatgpt",
      created: "2026-10-31T23:30:00Z",
      updated: "2026-10-31T23:30:00Z",
    };
    const message = { type: "message", id: "m-1", role: "user", ts: null, text: "你好" };
    const file = "chats/2026/11/chat-1.jsonl";
    const write = (rows: unknown[]) =>
      ws.writeText(file, `${rows.map((r) => JSON.stringify(r)).join("\n")}\n`);
    write([header, message]);
    expect(validateWorkspace(ws, "chats")).toEqual([]);
    write([header, { ...message, role: "invalid" }]);
    expect(validateWorkspace(ws, "chats").some((i) => i.line === 2)).toBe(true);
    write([{ ...header, created: "2026-10-01T00:00:00+08:00" }, message]);
    expect(validateWorkspace(ws, "chats").length).toBeGreaterThan(0);
  });

  it("module.json：visibility 与视图类型受限，schema 路径不能跳出模块目录", () => {
    const mod = { id: "books", name: "读书", version: 1, visibility: "agent" };
    expect(valid("module.schema.json", mod)).toBe(true);
    expect(valid("module.schema.json", { ...mod, visibility: "hidden" })).toBe(false);
    expect(valid("module.schema.json", { ...mod, views: [{ type: "pie", title: "x" }] })).toBe(false);
    const rec = (schema: string) => ({ ...mod, records: { book: { path: "data/{YYYY-MM}.jsonl", schema } } });
    expect(valid("module.schema.json", rec("schemas/book.schema.json"))).toBe(true);
    expect(valid("module.schema.json", rec("../../etc/x.schema.json"))).toBe(false);
  });

  it("NOW.md：event / proposal 必须有起止时间", () => {
    const now = (block: object) => ({
      date: "2026-10-15",
      blocks: [{ id: "b1", title: "x", status: "pending", ...block }],
    });
    expect(valid("now.schema.json", now({ kind: "proposal", start: "09:30", end: "10:10" }))).toBe(true);
    expect(valid("now.schema.json", now({ kind: "proposal" }))).toBe(false);
    expect(valid("now.schema.json", now({ kind: "task" }))).toBe(true);
    expect(valid("now.schema.json", now({ kind: "task", start: "25:00" }))).toBe(false);
  });

  it("STATUS.md 与 rules.md", () => {
    expect(
      valid("status.schema.json", {
        updated: "2026-10-15T21:00:00+08:00",
        next: [{ id: "h-1", title: "x", status: "done" }],
      }),
    ).toBe(true);
    expect(
      valid("status.schema.json", { updated: null, next: [{ id: "h-1", title: "x", status: "doing" }] }),
    ).toBe(false);
    expect(
      valid("rules.schema.json", { timezone: "Asia/Shanghai", sleep: { start: "23:30", end: "07:30" } }),
    ).toBe(true);
    expect(valid("rules.schema.json", { sleep: { start: "23:30", end: "07:30" } })).toBe(false);
  });

  it("config.json 不能放密钥", () => {
    expect(valid("config.schema.json", { version: 1, modules: [] })).toBe(true);
    expect(valid("config.schema.json", { version: 1, modules: [], apiKey: "x" })).toBe(false);
  });
});
