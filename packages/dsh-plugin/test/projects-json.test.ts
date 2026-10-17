import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProject, initWorkspace, setProject } from "@kaitu/core";
import { expect, it } from "vitest";
import type { ToolDefinition } from "../src/dsh.js";
import { registerWorkflowTools } from "../src/workflow-tools.js";

it("项目未设置进度或已有进度时，工具结果均能无损传给 DSH", async () => {
  const root = mkdtempSync(join(tmpdir(), "kaitu-projects-json-"));
  try {
    const ws = await initWorkspace(root);
    const { slug } = await createProject(ws, { title: "合成写作", kind: "personal" });
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
      ws,
      async (operation) => operation(),
    );
    const tool = tools.get("kaitu_projects");
    if (!tool) throw new Error("项目工具未注册");
    const exec = { signal: new AbortController().signal };
    const empty = await tool.execute({ operation: "list" }, exec);
    expect(empty).toMatchObject({ ok: true, result: [{ slug, progress: null }] });
    expect(JSON.parse(JSON.stringify(empty))).toStrictEqual(empty);
    const progress = { label: "章节", current: 2, target: 10 };
    await setProject(ws, slug, { progress });
    const updated = await tool.execute({ operation: "list" }, exec);
    expect(updated).toMatchObject({ ok: true, result: [{ slug, progress }] });
    expect(JSON.parse(JSON.stringify(updated))).toStrictEqual(updated);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
