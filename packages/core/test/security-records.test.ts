import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { Workspace, addRecord, readRecords, validateWorkspace } from "../src/index.js";

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
    symlinkSync(tmpdir(), join(root, "escape"));
    expect(() => ws.resolve("escape/outside.jsonl")).toThrow();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
