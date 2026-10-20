import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  addMemory,
  addRecord,
  createProject,
  initWorkspace,
  parseFrontmatter,
  readRecords,
  saveOnboardingMatter,
  setFinanceAccess,
  stringifyFrontmatter,
} from "@kaitu/core";
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
    await addMemory(ws, { type: "fact", name: "Secret", text: "Synthetic private memory", sensitive: true });
    addRecord(ws, "finance_account", {
      name: "Synthetic wallet",
      kind: "wallet",
      source: "manual",
      currency: "CNY",
    });
    for (const connection of ["local-ask", "phone-ask"] as const) {
      registerWorkflowTools(
        { tools: { register: (tool: { name: string }) => tools.set(tool.name, tool as never) } } as never,
        ws,
        async (run) => run(),
        connection,
      );
      const call = (name: string, args: unknown) =>
        tools.get(name)?.execute(args, { signal: new AbortController().signal });
      expect(JSON.stringify(await call("kaitu_memory", { operation: "list" }))).not.toContain(
        "Synthetic private memory",
      );
      for (const allowed of [false, true]) {
        setFinanceAccess(ws, connection, allowed);
        const rows = await call("kaitu_records", { operation: "list", type: "finance_account" });
        expect(JSON.stringify(rows).includes("Synthetic wallet")).toBe(allowed);
        expect(await call("kaitu_workspace", { operation: "read", path: "finance/STATUS.md" })).toMatchObject(
          { ok: allowed },
        );
      }
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it("Agent 文档、项目和首次整理入口只存建议，用户已有决定保持不变，目标不能直接写", async () => {
  const root = mkdtempSync(join(tmpdir(), "kaitu-agent-decisions-"));
  try {
    const ws = await initWorkspace(root);
    const tools = new Map<string, { execute(args: unknown, exec: unknown): Promise<unknown> }>();
    registerWorkflowTools(
      {
        tools: {
          register: (tool: { name: string; execute: unknown }) => tools.set(tool.name, tool as never),
        },
      } as never,
      ws,
      async (run) => run(),
    );
    const call = (name: string, args: unknown) =>
      tools.get(name)?.execute(args, { signal: new AbortController().signal });
    const kept = { id: "user-next", title: "已确认的一步", status: "todo" };
    ws.writeText("health/STATUS.md", stringifyFrontmatter({ updated: null, next: [kept] }, "原文保留"));
    const suggestion = { id: "ai-next", title: "AI 新的一步", status: "todo", by: "user" };
    const result = await call("kaitu_workspace", {
      operation: "write",
      files: [
        {
          path: "health/STATUS.md",
          content: stringifyFrontmatter({ updated: null, next: [kept, suggestion] }, "原文保留"),
        },
        {
          path: "NOW.md",
          content: stringifyFrontmatter({
            date: "2026-10-19",
            blocks: [
              {
                id: "ai-block",
                title: "合成日程",
                start: "10:00",
                end: "11:00",
                kind: "event",
                status: "confirmed",
              },
            ],
          }),
        },
      ],
    });
    expect(result).toMatchObject({ ok: true, result: { version: expect.any(String) } });
    const next = parseFrontmatter<{ next: unknown[] }>(ws.readText("health/STATUS.md")).data.next;
    expect(next).toEqual([kept, { ...suggestion, status: "proposed", by: "agent" }]);
    expect(parseFrontmatter<{ blocks: unknown[] }>(ws.readText("NOW.md")).data.blocks).toEqual([
      expect.objectContaining({ id: "ai-block", kind: "proposal", status: "pending" }),
    ]);
    expect(
      await call("kaitu_workspace", {
        operation: "write",
        files: [{ path: "me/goals.json", content: '[{"id":"ai-goal","title":"AI 决定","status":"active"}]' }],
      }),
    ).toMatchObject({ ok: false, error: expect.any(String) });
    expect(ws.readJson("me/goals.json")).toEqual([]);
    const project = await createProject(ws, { title: "合成项目", kind: "personal" });
    expect(
      await call("kaitu_projects", { operation: "set", slug: project.slug, patch: { next: [suggestion] } }),
    ).toMatchObject({ ok: true });
    expect(
      parseFrontmatter<{ next: unknown[] }>(ws.readText(`projects/${project.slug}/STATUS.md`)).data.next,
    ).toEqual([{ ...suggestion, status: "proposed", by: "agent" }]);
    const matter = await saveOnboardingMatter(ws, "合成原文");
    const draft = { goal: "合成目标", current: "合成现状", next: "合成下一步" };
    expect(
      await call("kaitu_onboarding", { action: "matter-draft", source: matter.source, draft }),
    ).toMatchObject({ ok: true });
    expect(readRecords(ws, "task")).toEqual([]);
    expect(ws.readJson("me/goals.json")).toEqual([]);
    expect(
      parseFrontmatter<{ next: { status: string }[] }>(ws.readText("me/STATUS.md")).data.next.every(
        (item) => item.status === "proposed",
      ),
    ).toBe(true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
