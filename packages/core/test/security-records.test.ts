import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { Workspace, addRecord, readRecords, validateWorkspace } from "../src/index.js";
import { freshWorkspace } from "./helpers.js";

it("Agent 不能绕过日程建议确认，用户写入与日历导入仍按原来源保存", async () => {
  const ws = await freshWorkspace();
  const event = {
    title: "合成日程",
    start: "2026-10-22T10:00:00Z",
    end: "2026-10-22T11:00:00Z",
    calendar: "work",
    source: "synthetic",
  };
  try {
    expect(() => addRecord(ws, "event", { ...event, by: "user" }, { by: "agent" })).toThrow("待用户确认");
    expect(readRecords(ws, "event")).toEqual([]);
    addRecord(ws, "event", event, { by: "user" });
    addRecord(ws, "event", event, { by: "import:ics" });
    expect(readRecords(ws, "event").map((row) => row.by)).toEqual(["user", "import:ics"]);
  } finally {
    rmSync(ws.root, { recursive: true, force: true });
  }
});

it("模块定义、记录目录及文件链接不能跨越模块边界，合法自定义模块可读写", () => {
  const root = mkdtempSync(join(tmpdir(), "kaitu-record-security-"));
  try {
    const ws = new Workspace(root, { maintain: false });
    const definition = {
      id: "custom",
      name: "自定义",
      version: 1,
      visibility: "agent",
      records: { custom: { path: "data/{YYYY-MM}.jsonl", schema: "record-base.schema.json" } },
    };
    ws.writeJson("custom/module.json", definition);
    const row = addRecord(ws, "custom", { ts: "2026-10-16T00:00:00Z" });
    expect(readRecords(ws, "custom")[0]?.id).toBe(row.record.id);
    ws.writeJson("custom/module.json", {
      ...definition,
      records: { custom: { ...definition.records.custom, path: "../data/{YYYY-MM}.jsonl" } },
    });
    expect(() => readRecords(ws, "custom")).toThrow();
    expect(validateWorkspace(ws).some((issue) => issue.file === "custom/module.json")).toBe(true);
    ws.writeJson("custom/module.json", definition);
    mkdirSync(join(root, "other"));
    writeFileSync(join(root, "other/2026-11.jsonl"), JSON.stringify(row.record));
    symlinkSync(join(root, "other/2026-11.jsonl"), join(root, "custom/data/2026-11.jsonl"));
    expect(() => readRecords(ws, "custom")).toThrow();
    rmSync(join(root, "custom/data"), { recursive: true });
    symlinkSync(join(root, "other"), join(root, "custom/data"));
    expect(() => readRecords(ws, "custom")).toThrow();
    expect(validateWorkspace(ws).some((issue) => issue.file === "custom/module.json")).toBe(true);
    ws.writeJson(".kaitu/config.json", {}, { internal: true });
    const checked = spawnSync(
      process.execPath,
      [
        fileURLToPath(new URL("../../cli/dist/main.js", import.meta.url)),
        "validate",
        "--dir",
        root,
        "--json-out",
      ],
      { encoding: "utf8" },
    );
    expect(checked.status).toBe(1);
    expect(
      JSON.parse(checked.stdout).issues.some(
        (issue: { file: string }) => issue.file === "custom/module.json",
      ),
    ).toBe(true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
