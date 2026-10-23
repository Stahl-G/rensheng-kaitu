import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Context } from "@deepseek-ai/cordis";
import { history, listMemories, readRecords, snapshot } from "@kaitu/core";
import { expect, it } from "vitest";
import { freshWorkspace } from "../../core/test/helpers.js";
import type { ToolDefinition } from "../src/dsh.js";
import { KaituOverviewService } from "../src/overview-service.js";
import { registerWorkflowTools } from "../src/workflow-tools.js";

function modelTools(ws: Awaited<ReturnType<typeof freshWorkspace>>) {
  const tools = new Map<string, ToolDefinition>();
  registerWorkflowTools(
    {
      tools: {
        register(tool) {
          tools.set(tool.name, tool);
          return () => tools.delete(tool.name);
        },
      },
    },
    ws,
    async (run) => run(),
  );
  return async (name: string, args: object) => {
    const tool = tools.get(name);
    if (!tool) throw new Error(`Missing tool: ${name}`);
    return tool.execute(args, { signal: new AbortController().signal }) as Promise<{
      ok: boolean;
      result: Record<string, unknown>;
    }>;
  };
}

it("问问的文件和记忆导入只能预览；伪造确认与取消均不写资料，手动界面确认后才导入", async () => {
  const ws = await freshWorkspace();
  const ctx = new Context();
  try {
    const call = modelTools(ws);
    const ui = new KaituOverviewService(ctx, { workspace: ws.root });
    const bytes = readFileSync(new URL("../../../examples/apple-health/export.xml", import.meta.url));
    const path = join(dirname(ws.root), "synthetic-health.xml");
    writeFileSync(path, bytes);
    const before = await history(ws);
    expect(
      await call("kaitu_import", { source: "apple-health", path, dryRun: false, confirmed: true }),
    ).toMatchObject({ ok: false });
    const preview = await call("kaitu_import", { source: "apple-health", path });
    expect(preview.ok).toBe(true);
    expect(preview.result.added).toBeGreaterThan(0);
    expect(await call("kaitu_import", { source: "apple-health", path, dryRun: false })).toMatchObject({
      ok: false,
    });
    expect(
      await call("kaitu_memory", {
        operation: "import",
        entries: [{ type: "fact", name: "合成记忆", text: "只供测试" }],
        dryRun: false,
        confirmed: true,
      }),
    ).toMatchObject({ ok: false });
    const memoryPreview = await call("kaitu_memory", {
      operation: "import",
      entries: [{ type: "fact", name: "合成记忆", text: "只供测试" }],
    });
    expect(memoryPreview.result.entries).toHaveLength(1);
    const paste = "[事实] 合成记忆：只供测试";
    const modelPreview = await call("kaitu_onboarding", { action: "preview", text: paste, ai: "chatgpt" });
    expect(
      await call("kaitu_onboarding", {
        action: "confirm",
        token: modelPreview.result.token,
        selected: (modelPreview.result.candidates as { id: string }[]).map((entry) => entry.id),
      }),
    ).toMatchObject({ ok: false });
    await call("kaitu_onboarding", { action: "cancel", token: modelPreview.result.token });
    const cancelled = await ui.onboardingImportPreview(
      "apple-health",
      "synthetic.xml",
      bytes.toString("base64"),
    );
    await ui.onboardingCancel(cancelled.token);
    await expect(ui.onboardingImportConfirm(cancelled.token)).rejects.toThrow();
    expect(readRecords(ws, "metric")).toEqual([]);
    expect(listMemories(ws)).toEqual([]);
    expect(await history(ws)).toEqual(before);
    // The same services used by the existing UI keep the user's manual flow working.
    const file = await ui.onboardingImportPreview("apple-health", "synthetic.xml", bytes.toString("base64"));
    expect(readRecords(ws, "metric")).toEqual([]);
    await ui.onboardingImportConfirm(file.token);
    expect(readRecords(ws, "metric").length).toBeGreaterThan(0);
    const memory = await ui.onboardingMemoryPreview(paste, "chatgpt");
    expect(listMemories(ws)).toEqual([]);
    await ui.onboardingMemoryConfirm(
      memory.token,
      memory.candidates.map((entry) => entry.id),
    );
    expect(
      listMemories(ws)
        .map((entry) => entry.text)
        .join("\n"),
    ).toContain("只供测试");
    expect((await history(ws)).length).toBeGreaterThan(before.length);
  } finally {
    await ctx.fiber.dispose();
    rmSync(dirname(ws.root), { recursive: true, force: true });
  }
});

it("问问不能用 confirmed=true 恢复版本；查看建议或取消不改资料，界面确认恢复仍可撤销", async () => {
  const ws = await freshWorkspace();
  const ctx = new Context();
  try {
    const call = modelTools(ws);
    const ui = new KaituOverviewService(ctx, { workspace: ws.root });
    const original = ws.readText("me/rules.md");
    const target = (await history(ws))[0];
    if (!target) throw new Error("Missing initial version");
    const changed = `${original}\n合成修改，应保留至用户确认\n`;
    ws.writeText("me/rules.md", changed);
    const modified = await snapshot(ws, "合成修改");
    if (!modified) throw new Error("Missing modified version");
    const before = await history(ws);
    expect(await call("kaitu_restore", { version: target.oid, confirmed: true })).toMatchObject({
      ok: false,
    });
    expect(await call("kaitu_restore", { version: target.short })).toMatchObject({
      ok: true,
      result: { status: "requires_user_confirmation", version: { oid: target.oid } },
    });
    // Closing/cancelling the existing restore panel makes no remote write request.
    expect(ws.readText("me/rules.md")).toBe(changed);
    expect(await history(ws)).toEqual(before);
    await ui.restoreVersion(target.oid);
    expect(ws.readText("me/rules.md")).toBe(original);
    await ui.restoreVersion(modified);
    expect(ws.readText("me/rules.md")).toBe(changed);
  } finally {
    await ctx.fiber.dispose();
    rmSync(dirname(ws.root), { recursive: true, force: true });
  }
});
