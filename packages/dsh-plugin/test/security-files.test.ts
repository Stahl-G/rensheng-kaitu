import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initWorkspace } from "@kaitu/core";
import { expect, it } from "vitest";
import { registerWorkflowTools } from "../src/workflow-tools.js";
import { writeFiles } from "../src/workspace-files.js";

it("等价路径与文件别名受同一保护，重复规范路径整批拒绝，模型不能提供可信确认", async () => {
  const root = mkdtempSync(join(tmpdir(), "kaitu-file-security-"));
  try {
    const ws = await initWorkspace(root);
    const before = ws.readText("me/rules.md");
    const changed = `${before}\n合成规则更新\n`;
    symlinkSync(join(root, "me/rules.md"), join(root, "rules-alias.md"));
    for (const path of ["./me/rules.md", "me/../me/rules.md", "rules-alias.md"])
      await expect(writeFiles(ws, [{ path, content: changed }], false)).rejects.toThrow();
    await expect(writeFiles(ws, [{ path: "./OVERVIEW.md", content: "injected" }], true)).rejects.toThrow();
    await expect(
      writeFiles(
        ws,
        [
          { path: "./me/note.md", content: "one" },
          { path: "me/../me/note.md", content: "two" },
        ],
        false,
      ),
    ).rejects.toThrow();
    expect(ws.exists("me/note.md")).toBe(false);
    const tools = new Map<string, { execute(args: unknown, exec: unknown): Promise<unknown> }>();
    registerWorkflowTools(
      {
        tools: {
          register: (tool: { name: string; execute: unknown }) => tools.set(tool.name, tool as never),
        },
      } as never,
      ws,
      async (operation) => operation(),
    );
    const result = await tools
      .get("kaitu_workspace")
      ?.execute(
        { operation: "write", files: [{ path: "me/rules.md", content: changed }], confirmed: true },
        { signal: new AbortController().signal },
      );
    expect(result).toMatchObject({ ok: false });
    expect(ws.readText("me/rules.md")).toBe(before);
    await writeFiles(ws, [{ path: "./me/rules.md", content: changed }], true);
    expect(ws.readText("me/rules.md")).toBe(changed);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
