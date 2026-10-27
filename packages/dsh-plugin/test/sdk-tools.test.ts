import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Context } from "@deepseek-ai/cordis";
import * as core from "@kaitu/core";
import { afterEach, expect, test, vi } from "vitest";
import { clonedWorkspace } from "../../core/test/helpers.js";
import type { ToolDefinition } from "../src/dsh.js";
// @ts-expect-error Desktop entry points are native ESM.
const { apply } = await import("../../desktop/sdk-tools.mjs");

function context() {
  const ctx = new Context();
  const tools = new Map<string, ToolDefinition>();
  ctx.provide("tools", {
    register: (tool: ToolDefinition) => {
      tools.set(tool.name, tool);
      return () => tools.delete(tool.name);
    },
  });
  ctx.provide("systemPrompt", { section: () => () => {} });
  return { ctx, tools };
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

test.each([false, true])(
  "SDK registration and shutdown do not open or discover data (explicit root: %s)",
  async (explicit) => {
    const locate = vi.spyOn(core, "defaultRoot").mockImplementation(() => {
      throw new Error("synthetic unavailable data location");
    });
    const open = vi.spyOn(core.Workspace.prototype, "root", "set").mockImplementation(() => {
      throw new Error("synthetic stalled or invalid data");
    });
    const { ctx, tools } = context();
    try {
      apply(ctx, explicit ? { workspace: join(tmpdir(), `kaitu-missing-${randomUUID()}`) } : {});
      expect(tools.has("kaitu_workspace")).toBe(true);
      expect(tools.has("kaitu_add_record")).toBe(true);
      await ctx.fiber.dispose();
      expect(locate).not.toHaveBeenCalled();
      expect(open).not.toHaveBeenCalled();
    } finally {
      await ctx.fiber.dispose();
    }
  },
);

test("first data tool opens the selected workspace once and preserves file and connection permissions", async () => {
  const selected = await clonedWorkspace();
  const other = await clonedWorkspace();
  other.writeText("me/sdk-outside.md", "synthetic outside content");
  core.setFinanceAccess(selected, "phone-ask", false);
  vi.stubEnv("KAITU_DIR", other.root);
  const open = vi.spyOn(core.Workspace.prototype, "root", "set");
  const { ctx, tools } = context();
  const call = async (name: string, args: unknown) => {
    const tool = tools.get(name);
    if (!tool) throw new Error(`Missing tool: ${name}`);
    return tool.execute(args, { signal: new AbortController().signal });
  };
  try {
    apply(ctx, { workspace: selected.root, connection: "phone-ask" });
    expect(open).not.toHaveBeenCalled();
    expect(
      await call("kaitu_workspace", {
        operation: "write",
        files: [{ path: other.resolve("me/sdk-outside.md"), content: "rejected" }],
      }),
    ).toMatchObject({ ok: false });
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith(selected.root);
    expect(await call("kaitu_status", { type: "workout" })).toMatchObject({
      ok: true,
      workspace: selected.root,
    });
    expect(await call("kaitu_workspace", { operation: "read", path: "finance/STATUS.md" })).toMatchObject({
      ok: false,
    });
    expect(other.readText("me/sdk-outside.md")).toBe("synthetic outside content");
    expect(open).toHaveBeenCalledTimes(1);
  } finally {
    await ctx.fiber.dispose();
  }
});
