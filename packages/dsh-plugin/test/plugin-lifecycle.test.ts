import { Context } from "@deepseek-ai/cordis";
import * as history from "@kaitu/core";
import { expect, test, vi } from "vitest";
import { clonedWorkspace } from "../../core/test/helpers.js";
import type { ToolDefinition } from "../src/dsh.js";
import { apply } from "../src/index.js";

test("插件卸载等待已进入写队列的工作完成", async () => {
  const ws = await clonedWorkspace();
  const ctx = new Context();
  const tools = new Map<string, ToolDefinition>();
  ctx.provide("tools", {
    register: (tool: ToolDefinition) => {
      tools.set(tool.name, tool);
      return () => tools.delete(tool.name);
    },
  });
  ctx.provide("skills", { registerProvider: () => () => {} });
  ctx.provide("typert", { register: () => () => {} });
  await apply(ctx, { workspace: ws.root, automation: false });
  let release!: () => void;
  let entered!: () => void;
  const gated = new Promise<null>((resolve) => {
    release = () => resolve(null);
  });
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const snapshot = vi.spyOn(history, "snapshot").mockImplementationOnce(() => {
    entered();
    return gated;
  });
  let disposed = false;
  const tool = tools.get("kaitu_workspace");
  if (!tool) throw new Error("Missing workspace tool");
  const job = tool.execute(
    { operation: "snapshot", message: "synthetic queued write" },
    { signal: new AbortController().signal },
  );
  await started;
  const disposing = ctx.fiber.dispose().then(() => {
    disposed = true;
  });
  try {
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(disposed).toBe(false);
  } finally {
    release();
    await job;
    await disposing;
    snapshot.mockRestore();
  }
  expect(disposed).toBe(true);
});
