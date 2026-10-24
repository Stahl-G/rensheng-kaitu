import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  exportWorkspace,
  history,
  initWorkspace,
  readLibrary,
  validateWorkspace,
  workspaceTaskSkill,
  writeAgentsMd,
} from "@kaitu/core";
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
    const pending: Promise<unknown>[] = [];
    const beforeVersions = await history(a);
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
      (run) => {
        const result = run();
        pending.push(result);
        return result;
      },
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
    expect(saved.result.version).toBeNull();
    await new Promise<void>((resolve) => setImmediate(resolve));
    await Promise.all(pending);
    expect(await history(a)).toHaveLength(beforeVersions.length + 1);
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

it("成长技能与写入只认合法模块；标准目录名、旧技能副本或模型声明不能放行", async () => {
  const root = mkdtempSync(join(tmpdir(), "kaitu-growth-folder-"));
  try {
    const ws = await initWorkspace(root);
    const tools = new Map<string, ToolDefinition>();
    const pending: Promise<unknown>[] = [];
    registerWorkflowTools(
      {
        tools: {
          register: (tool) => {
            tools.set(tool.name, tool);
            return () => tools.delete(tool.name);
          },
        },
      },
      ws,
      (run) => {
        const result = run();
        pending.push(result);
        return result;
      },
    );
    const inbox = tools.get("kaitu_inbox");
    if (!inbox) throw new Error("inbox tool missing");
    const exec = { signal: new AbortController().signal };
    const input = { operation: "capture-growth", text: "合成孩子今天自己穿鞋" };
    const provider = new KaituSkillProvider(ws);
    expect((await provider.list({})).some((skill) => skill.name === "log-growth")).toBe(false);
    expect(workspaceTaskSkill("记一条成长原文", ws)).toBeUndefined();
    expect(await inbox.execute(input, exec)).toMatchObject({ ok: false });
    ws.writeJson("growth/module.json", { id: "other", name: "合成模块", version: 1, visibility: "agent" });
    expect(await inbox.execute(input, exec)).toMatchObject({ ok: false });
    expect(await inbox.execute({ ...input, mode: "growth" }, exec)).toMatchObject({ ok: false });
    expect(readLibrary(ws).inbox).toEqual([]);
    ws.writeJson("growth/module.json", { id: "growth", name: "合成成长", version: 1, visibility: "agent" });
    writeAgentsMd(ws);
    const growth = (await provider.list({ cwd: "/unrelated" })).find((skill) => skill.name === "log-growth");
    if (!growth) throw new Error("growth skill missing");
    expect(workspaceTaskSkill("记一条成长原文", ws)?.name).toBe(growth.name);
    expect((await provider.get(growth, {}))?.path).toBe(ws.resolve(".agents/skills/log-growth/SKILL.md"));
    expect(await inbox.execute(input, exec)).toMatchObject({ ok: true });
    await new Promise<void>((resolve) => setImmediate(resolve));
    await Promise.all(pending);
    expect(readLibrary(ws).inbox).toContainEqual(expect.objectContaining({ text: input.text }));
    rmSync(ws.resolve("growth/module.json"));
    writeAgentsMd(ws);
    expect(await provider.get(growth, {})).toBeUndefined();
    expect(workspaceTaskSkill("记一条成长原文", ws)).toBeUndefined();
    expect(await inbox.execute(input, exec)).toMatchObject({ ok: false });
    expect(readLibrary(ws).inbox).toHaveLength(1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
