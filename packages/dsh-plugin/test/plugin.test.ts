import fs, { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  Workspace,
  addRecords,
  history,
  initWorkspace,
  listMemories,
  readOverviewPage,
  readRecords,
  validateWorkspace,
} from "@kaitu/core";
import { expect, it, vi } from "vitest";
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
    const format = (await tools.get("kaitu_status")?.execute({ type: "workout" }, exec)) as {
      reference: { type: string };
      summary?: unknown;
    };
    expect(format.reference.type).toBe("workout");
    expect(format.summary).toBeUndefined();
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
    expect(
      await tool.execute(
        {
          type: "event",
          fields: {
            title: "AI 日程",
            start: "2026-10-22T10:00:00Z",
            end: "2026-10-22T11:00:00Z",
            calendar: "work",
            source: "synthetic",
            by: "user",
          },
        },
        exec,
      ),
    ).toMatchObject({ ok: false });
    expect(readRecords(ws, "event")).toEqual([]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it("问问工具直接持久AI记忆，重开可回读，后台存版本不追加未核实提示", async () => {
  const root = mkdtempSync(join(tmpdir(), "kaitu-dsh-memory-"));
  try {
    const ws = await initWorkspace(root);
    const tools = new Map<string, ToolDefinition>();
    const queue = apply(
      {
        tools: {
          register: (tool) => {
            tools.set(tool.name, tool);
            return () => tools.delete(tool.name);
          },
        },
      },
      { workspace: root },
      ws,
    );
    const input = {
      idempotency_key: "dsh-synthetic/1",
      type: "decision",
      name: "合成纸桥建议",
      text: "可以试试折叠纸桥",
      evidence: "合成模型测试",
      source: "synthetic-assistant/1",
      origin: "ai-suggestion",
      uncertainty: "还未采纳",
      observed_at: "2026-10-26T10:00:00Z",
      scope: "personal",
    };
    const response = await tools
      .get("kaitu_memory_capture")
      ?.execute(input, { signal: new AbortController().signal });
    expect(response).toMatchObject({
      ok: true,
      result: { status: "saved", entry: { type: "context", origin: "ai-suggestion" } },
    });
    await queue(async () => {});
    const entry = listMemories(ws)[0];
    if (!entry) throw new Error("Missing persisted memory");
    expect(listMemories(new Workspace(root))).toMatchObject([entry]);
    expect(response).not.toHaveProperty("result.notice");
    expect((await readOverviewPage(ws)).warnings).toEqual([]);

    const write = fs.writeFileSync.bind(fs);
    const failure = vi.spyOn(fs, "writeFileSync").mockImplementation((...args) => {
      if (String(args[0]).endsWith("/kaitu-internal-history"))
        throw Object.assign(new Error("synthetic background ENOSPC"), { code: "ENOSPC" });
      return write(...args);
    });
    try {
      await tools
        .get("kaitu_memory_capture")
        ?.execute(
          { ...input, idempotency_key: "dsh-synthetic/background-failure" },
          { signal: new AbortController().signal },
        );
      await queue(async () => {});
    } finally {
      failure.mockRestore();
    }
    expect(listMemories(ws)).toHaveLength(2);
    expect((await readOverviewPage(ws)).warnings).toHaveLength(1);
    const retried = (await tools
      .get("kaitu_workspace")
      ?.execute(
        { operation: "snapshot", message: "retry synthetic background version" },
        { signal: new AbortController().signal },
      )) as { ok: boolean };
    expect(retried.ok).toBe(true);
    expect((await readOverviewPage(ws)).warnings).toEqual([]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
