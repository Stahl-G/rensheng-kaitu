import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exportWorkspace, initWorkspace, readLibrary, validateWorkspace } from "@kaitu/core";
import { strFromU8, unzipSync } from "fflate";
import { expect, it } from "vitest";
import type { ToolDefinition } from "../../dsh-plugin/src/dsh.js";
import { KaituSkillProvider } from "../../dsh-plugin/src/skills.js";
import { registerWorkflowTools } from "../../dsh-plugin/src/workflow-tools.js";

it("原文工具只写绑定工作区，资料与导出保留原话；拒绝越区参数、空内容和取消", async () => {
  const root = mkdtempSync(join(tmpdir(), "kaitu-capture-"));
  try {
    const a = await initWorkspace(join(root, "synthetic-child-a"));
    const b = await initWorkspace(join(root, "synthetic-child-b"));
    const tools = new Map<string, ToolDefinition>();
    registerWorkflowTools(
      {
        tools: {
          register: (tool) => {
            tools.set(tool.name, tool);
            return () => tools.delete(tool.name);
          },
        },
      },
      a,
      (run) => run(),
    );
    const inbox = tools.get("kaitu_inbox");
    if (!inbox) throw new Error("inbox tool missing");
    const exec = { signal: new AbortController().signal };
    const text = "合成孩子 A：昨天自己穿好鞋了，不确定是不是第一次。\nParent's original observation.";
    const before = readLibrary(b);
    const saved = (await inbox.execute({ operation: "capture", text }, exec)) as {
      ok: boolean;
      result: { path: string; version: string | null };
    };
    expect(saved.ok).toBe(true);
    expect(saved.result.version).toBeTruthy();
    expect(readLibrary(a).inbox).toContainEqual(
      expect.objectContaining({ file: saved.result.path, text, status: "raw" }),
    );
    const listed = (await inbox.execute({ operation: "notes" }, exec)) as {
      result: { path: string }[];
    };
    expect(listed.result.map((note) => note.path)).toEqual([saved.result.path]);
    const zip = unzipSync(Buffer.from(exportWorkspace(a).base64, "base64"));
    expect(strFromU8(zip[saved.result.path] as Uint8Array)).toBe(a.readText(saved.result.path));
    expect(Object.keys(zip).some((path) => path.startsWith(".kaitu/"))).toBe(false);
    expect(readLibrary(b)).toEqual(before);
    expect(validateWorkspace(a)).toEqual([]);
    const provider = new KaituSkillProvider(a);
    const growth = (await provider.list({ cwd: b.root })).find((skill) => skill.name === "log-growth");
    if (!growth) throw new Error("growth skill missing from workspace");
    expect((await provider.get(growth, { cwd: b.root }))?.path).toBe(
      a.resolve(".agents/skills/log-growth/SKILL.md"),
    );
    for (const input of [
      { operation: "capture", text: " " },
      { operation: "capture", text: "rejected", path: join(b.root, "injected.md") },
      { operation: "capture", text: "x".repeat(100001) },
    ])
      expect(await inbox.execute(input, exec)).toMatchObject({ ok: false });
    const canceled = new AbortController();
    canceled.abort();
    expect(
      await inbox.execute({ operation: "capture", text: "canceled" }, { signal: canceled.signal }),
    ).toMatchObject({ ok: false });
    expect(readLibrary(a).inbox).toHaveLength(1);
    expect(readLibrary(b)).toEqual(before);
    expect(b.exists("injected.md")).toBe(false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
