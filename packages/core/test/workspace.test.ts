import { appendFileSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { doctor, renderAgentsMd, validateWorkspace } from "../src/index.js";
import { freshWorkspace } from "./helpers.js";

describe("init / doctor / validate", () => {
  it("新建的工作区 doctor 全部通过", async () => {
    const ws = await freshWorkspace();
    const checks = await doctor(ws);
    expect(checks.filter((c) => !c.ok)).toEqual([]);
  });

  it("指定时区写进 rules.md", async () => {
    const ws = await freshWorkspace("Europe/Berlin");
    expect(ws.timeZone()).toBe("Europe/Berlin");
    expect(validateWorkspace(ws)).toEqual([]);
  });

  it("validate 报出损坏的行、放错月份的记录和不合法的 frontmatter，并带行号", async () => {
    const ws = await freshWorkspace();
    const base = { by: "agent", exercise: "深蹲", sets: 3, reps: 12, weight_kg: 60, session_id: "s" };
    const file = join(ws.root, "health/data/workouts/2026-10.jsonl");
    ws.writeText("health/data/workouts/2026-10.jsonl", "");
    appendFileSync(
      file,
      `${JSON.stringify({ id: "01J9Z8Y7X6W5V4T3S2R1Q0P9N8", ts: "2026-10-15T20:00:00+08:00", ...base })}\n`,
    );
    appendFileSync(file, "{broken\n");
    appendFileSync(
      file,
      `${JSON.stringify({ id: "01J9Z8Y7X6W5V4T3S2R1Q0P9N9", ts: "2026-11-02T20:00:00+08:00", ...base })}\n`,
    );
    ws.writeText(
      "health/STATUS.md",
      // 状态写成 doing 这类会自动认成待办；YAML 本身写坏了才报告。
      "---\nupdated: 2026-10-15T21:00:00+08:00\nnext: [ { id: a, title: b\n---\n",
    );

    const issues = validateWorkspace(ws);
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ file: "health/data/workouts/2026-10.jsonl", line: 2 }),
        expect.objectContaining({
          file: "health/data/workouts/2026-10.jsonl",
          line: 3,
          message: expect.stringMatching(/2026-11/),
        }),
        expect.objectContaining({ file: "health/STATUS.md" }),
      ]),
    );
    expect(issues).toHaveLength(3);
    expect(validateWorkspace(ws, "me")).toEqual([]);
    expect((await doctor(ws)).find((c) => c.name === "数据格式校验")?.ok).toBe(false);
  });

  it("自定义模块可用自己的 schema，并引用公共字段", async () => {
    const ws = await freshWorkspace();
    ws.writeJson("books/module.json", {
      id: "books",
      name: "读书",
      version: 1,
      visibility: "agent",
      records: { book: { path: "data/{YYYY-MM}.jsonl", schema: "schemas/book.schema.json" } },
    });
    ws.writeJson("books/schemas/book.schema.json", {
      allOf: [{ $ref: "record-base.schema.json" }],
      required: ["title"],
      properties: { title: { type: "string" } },
    });
    expect(validateWorkspace(ws)).toEqual([]);
    const { addRecord } = await import("../src/index.js");
    expect(addRecord(ws, "book", { title: "置身事内" }).file).toBe("books/data/2026-10.jsonl");
    expect(() => addRecord(ws, "book", { author: "x" })).toThrow(/title/);
    expect(renderAgentsMd(ws)).toContain("`books/`");
  });

  it.skipIf(process.platform === "win32")("密钥文件权限不对时 doctor 报错", async () => {
    const ws = await freshWorkspace();
    chmodSync(join(ws.root, ".kaitu/secrets.json"), 0o644);
    expect((await doctor(ws)).find((c) => c.name.startsWith("密钥文件"))?.ok).toBe(false);
  });

  it("重新生成 AGENTS.md 保留用户追加的内容", async () => {
    const ws = await freshWorkspace();
    ws.writeText("AGENTS.md", `${ws.readText("AGENTS.md")}我喜欢简短的回答。\n`);
    expect(renderAgentsMd(ws)).toMatch(/我喜欢简短的回答。\n$/);
  });
});
