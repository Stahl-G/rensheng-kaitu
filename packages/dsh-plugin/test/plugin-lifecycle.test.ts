import { existsSync, renameSync, rmSync } from "node:fs";
import { Context } from "@deepseek-ai/cordis";
import * as history from "@kaitu/core";
import { expect, test, vi } from "vitest";
import { setStateBinding } from "../../core/src/state-binding.js";
import { clonedWorkspace } from "../../core/test/helpers.js";
import type { ToolDefinition } from "../src/dsh.js";
import { apply } from "../src/index.js";

function pluginContext() {
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
  return { ctx, tools };
}

test("云盘文件未下载时仍注册宿主服务，保留占位文件，下载后重启再升级", async () => {
  const original = await clonedWorkspace();
  const config = original.readJson<Record<string, unknown>>(".kaitu/config.json");
  config.template_version = "synthetic-old";
  original.writeJson(".kaitu/config.json", config, { internal: true });
  original.writeText("me/pending.md", "synthetic cloud content");
  setStateBinding(original.root, original.resolve(".kaitu", { internal: true }), "icloud");
  const file = original.resolve("me/pending.md");
  const placeholder = original.resolve("me/.pending.md.icloud");
  renameSync(file, placeholder);
  const { ctx, tools } = pluginContext();
  const restarted = pluginContext();
  try {
    const ws = new history.Workspace(original.root);
    await expect(history.upgradeWorkspace(ws)).rejects.toMatchObject({ code: "CLOUD_UNAVAILABLE" });
    await apply(ctx, { workspace: ws.root, automation: false });
    expect(ctx.get("kaitu")).toBeDefined();
    expect(tools.has("kaitu_workspace")).toBe(true);
    expect(ws.readJson(".kaitu/config.json")).toEqual(config);
    expect(existsSync(placeholder)).toBe(true);
    expect(() => ws.readText("me/pending.md")).toThrow("还没从云盘下载");

    await ctx.fiber.dispose();
    renameSync(placeholder, file);
    await apply(restarted.ctx, { workspace: ws.root, automation: false });
    expect(restarted.ctx.get("kaitu")).toBeDefined();
    expect(ws.readJson<Record<string, unknown>>(".kaitu/config.json").template_version).not.toBe(
      config.template_version,
    );
    expect(ws.readText("me/pending.md")).toBe("synthetic cloud content");
  } finally {
    await ctx.fiber.dispose();
    await restarted.ctx.fiber.dispose();
    rmSync(original.root, { recursive: true, force: true });
  }
});

test("非云盘升级错误仍阻止插件启动并保留原始错误", async () => {
  const ws = await clonedWorkspace();
  const failure = new Error("synthetic upgrade failure");
  const upgrade = vi.spyOn(history, "upgradeWorkspace").mockRejectedValueOnce(failure);
  const { ctx } = pluginContext();
  try {
    await expect(apply(ctx, { workspace: ws.root, automation: false })).rejects.toBe(failure);
    expect(ctx.get("kaitu")).toBeUndefined();
  } finally {
    upgrade.mockRestore();
    await ctx.fiber.dispose();
    rmSync(ws.root, { recursive: true, force: true });
  }
});

test("插件卸载等待已进入写队列的工作完成", async () => {
  const ws = await clonedWorkspace();
  const { ctx, tools } = pluginContext();
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
