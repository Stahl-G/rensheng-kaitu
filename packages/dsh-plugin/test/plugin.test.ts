import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addRecords, history, initWorkspace, readRecords, validateWorkspace } from "@kaitu/core";
import { expect, it } from "vitest";
import type { ToolDefinition } from "../src/dsh.js";
import { apply } from "../src/tools.js";

it("合法训练写入并存版本，非法记录返回原始校验错误且不写入", async () => {
  const root = mkdtempSync(join(tmpdir(), "kaitu-dsh-"));
  try {
    const ws = await initWorkspace(root);
    const tools = new Map<string, ToolDefinition>();
    apply(
      {
        tools: {
          register: (tool) => {
            tools.set(tool.name, tool);
            return () => tools.delete(tool.name);
          },
        },
      },
      { workspace: root },
    );
    const tool = tools.get("kaitu_add_record");
    if (!tool) throw new Error("未注册记录工具");
    const exec = { signal: new AbortController().signal };
    const before = await history(ws);
    const result = (await tool.execute(
      { type: "workout", fields: { exercise: "深蹲", sets: 3, reps: 12, weight_kg: 60, session_id: "s1" } },
      exec,
    )) as { ok: boolean; id: string; file: string; version: string };
    expect(result.ok).toBe(true);
    expect(ws.exists(result.file)).toBe(true);
    const content = ws.readText(result.file);
    expect(JSON.parse(content)).toMatchObject({
      id: result.id,
      exercise: "深蹲",
      sets: 3,
      reps: 12,
      weight_kg: 60,
      session_id: "s1",
      by: "agent",
    });
    expect(validateWorkspace(ws)).toEqual([]);
    const versions = await history(ws);
    expect(versions).toHaveLength(before.length + 1);
    expect(versions[0]?.oid).toBe(result.version);

    const invalid = { exercise: "深蹲", sets: -1 };
    let original: unknown;
    try {
      addRecords(ws, "workout", [invalid], { dryRun: true });
    } catch (error) {
      original = error;
    }
    expect(original).toBeInstanceOf(Error);
    const rejected = await tool.execute({ type: "workout", fields: invalid }, exec);
    expect(rejected).toEqual({ ok: false, error: (original as Error).message });
    expect(ws.readText(result.file)).toBe(content);
    expect(readRecords(ws, "workout")).toHaveLength(1);
    expect(await history(ws)).toEqual(versions);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
