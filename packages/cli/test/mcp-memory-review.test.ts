import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { history, listMemories, restore } from "@kaitu/core";
import * as core from "@kaitu/core";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  type ElicitRequest,
  ElicitRequestSchema,
  type ElicitResult,
  LoggingMessageNotificationSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { expect, it, vi } from "vitest";
import { clonedWorkspace } from "../../core/test/helpers.js";
import { createMcpServer, writeQueue } from "../src/mcp/server.js";

const text =
  "[偏好] 我暂时只考虑上海的岗位（至少到 2027 年 3 月）。来源：2026-10-25 Claude 对话\n[决定] 先完成纸桥模型，再报名比赛（2026-10-25）";
const call = { name: "onboarding_memory_review", arguments: { text, ai: "claude" } };
const body = (response: Awaited<ReturnType<Client["callTool"]>>) =>
  JSON.parse((response.content as { text: string }[])[0]?.text ?? "null");

it("MCP 候选等待客户端人工选择，保留原话来源，重复不入账且整批能撤销", async () => {
  const root = mkdtempSync(join(tmpdir(), "kaitu-memory-review-"));
  const client = new Client(
    { name: "synthetic-review", version: "1" },
    { capabilities: { elicitation: { form: {} } } },
  );
  const ws = await clonedWorkspace(undefined, root);
  const write = writeQueue();
  const snapshotNow = core.snapshotNow;
  const saving = Promise.withResolvers<void>();
  const finishVersion = Promise.withResolvers<void>();
  vi.spyOn(core, "snapshotNow").mockImplementationOnce(async (...args) => {
    saving.resolve();
    await finishVersion.promise;
    return snapshotNow(...args);
  });
  const server = createMcpServer(ws, "remote", write);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const shown = Promise.withResolvers<ElicitRequest>();
  const choice = Promise.withResolvers<ElicitResult>();
  let forms = 0;
  client.setRequestHandler(ElicitRequestSchema, (request) => {
    forms++;
    shown.resolve(request);
    return choice.promise;
  });
  try {
    await server.connect(serverSide);
    await client.connect(clientSide);
    const before = await history(ws);
    const goals = ws.readText("me/goals.json");
    const pending = client.callTool(call);
    const request = await shown.promise;
    expect(request.params.mode).toBe("form");
    if (request.params.mode === "url") throw new Error("Expected a form");
    expect(request.params.requestedSchema.properties.selected).toMatchObject({
      items: {
        anyOf: [
          { const: "line-1", title: text.split("\n")[0] },
          { const: "line-2", title: text.split("\n")[1] },
        ],
      },
    });
    expect(listMemories(ws)).toEqual([]);
    expect(await history(ws)).toEqual(before);
    expect(ws.readText("me/goals.json")).toBe(goals);
    // 用户还在核对时，其他写操作仍可进入原队列。
    expect(await write(async () => "available")).toBe("available");
    choice.resolve({ action: "accept", content: { selected: ["line-1"] } });
    const response = await pending;
    expect(response.isError).not.toBe(true);
    const saved = body(response);
    expect(saved.entries).toHaveLength(1);
    expect(saved.version).toBeNull();
    await saving.promise;
    expect(await history(ws)).toEqual(before);
    expect(listMemories(ws)[0]).toMatchObject({
      text: text.split("\n")[0]?.replace("[偏好] ", ""),
      source: "从 Claude 搬来",
    });
    expect(ws.readText("me/goals.json")).toBe(goals);
    let nextWrite = false;
    const queued = write(async () => {
      nextWrite = true;
    });
    await Promise.resolve();
    expect(nextWrite).toBe(false);
    finishVersion.resolve();
    await queued;
    expect(await history(ws)).toHaveLength(before.length + 1);
    expect(
      body(await client.callTool({ ...call, arguments: { ...call.arguments, text: text.split("\n")[0] } })),
    ).toEqual({ candidates: [] });
    expect(forms).toBe(1);
    expect(await history(ws)).toHaveLength(before.length + 1);
    const reread = await client.callTool({ name: "memory_list", arguments: {} });
    expect(body(reread)[0]).toMatchObject({ source: "从 Claude 搬来", text: saved.entries[0].text });
    const firstVersion = (await history(ws))[0]?.oid;
    const second = body(
      await client.callTool({ ...call, arguments: { text: text.split("\n")[1], ai: "claude" } }),
    );
    await write(async () => {});
    expect(second.before).toBe(firstVersion);
    await restore(ws, second.before);
    expect(listMemories(ws)).toHaveLength(1);
    await restore(ws, saved.before);
    expect(listMemories(ws)).toEqual([]);
  } finally {
    finishVersion.resolve();
    vi.restoreAllMocks();
    await client.close();
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});

it("没有确认能力、取消、空选、错误选择、过期或传输失败时不写资料", async () => {
  const root = mkdtempSync(join(tmpdir(), "kaitu-memory-review-reject-"));
  const ws = await clonedWorkspace(undefined, root);
  const before = await history(ws);
  const goals = ws.readText("me/goals.json");
  try {
    for (const scenario of [
      "unsupported",
      "cancel",
      "decline",
      "empty",
      "invalid",
      "expired",
      "transport",
      "goal",
      "write",
    ] as const) {
      const client = new Client(
        { name: "synthetic-review", version: "1" },
        { capabilities: scenario === "unsupported" ? {} : { elicitation: { form: {} } } },
      );
      const server = createMcpServer(ws);
      const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
      if (scenario !== "unsupported")
        client.setRequestHandler(ElicitRequestSchema, async () => {
          if (scenario === "transport") throw new Error("Synthetic client disconnected");
          if (scenario === "write")
            vi.spyOn(ws, "writeText").mockImplementation(() => {
              throw new Error("Synthetic memory write failure");
            });
          if (scenario === "expired") vi.spyOn(Date, "now").mockReturnValue(Date.now() + 31 * 60000);
          if (scenario === "cancel" || scenario === "decline") return { action: scenario };
          return {
            action: "accept",
            content: {
              selected: scenario === "empty" ? [] : [scenario === "invalid" ? "line-999" : "line-1"],
            },
          };
        });
      try {
        await server.connect(serverSide);
        await client.connect(clientSide);
        const response = await client.callTool(
          scenario === "goal" ? { ...call, arguments: { ...call.arguments, text: "[目标] 合成目标" } } : call,
        );
        if (["unsupported", "invalid", "expired", "transport", "goal", "write"].includes(scenario))
          expect(response.isError).toBe(true);
        else expect(body(response).action).toBe(scenario === "empty" ? "cancel" : scenario);
        expect(listMemories(ws)).toEqual([]);
        expect(ws.readText("me/goals.json")).toBe(goals);
        expect(await history(ws)).toEqual(before);
      } finally {
        vi.restoreAllMocks();
        await client.close();
        await server.close();
      }
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it("关闭 MCP 等待后台版本，版本失败通知客户端且文件仍可回读", async () => {
  const root = mkdtempSync(join(tmpdir(), "kaitu-memory-version-"));
  const ws = await clonedWorkspace(undefined, root);
  const client = new Client(
    { name: "synthetic-review", version: "1" },
    { capabilities: { elicitation: { form: {} } } },
  );
  const write = writeQueue();
  const server = createMcpServer(ws, "remote", write);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const failures: unknown[] = [];
  client.setNotificationHandler(LoggingMessageNotificationSchema, (message) => {
    failures.push(message.params);
  });
  client.setRequestHandler(ElicitRequestSchema, async () => ({
    action: "accept",
    content: { selected: ["line-1"] },
  }));
  const finishVersion = Promise.withResolvers<void>();
  const snapshotNow = core.snapshotNow;
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  const save = vi.spyOn(core, "snapshotNow").mockResolvedValueOnce(null);
  try {
    await server.connect(serverSide);
    await client.connect(clientSide);
    const failed = body(await client.callTool(call));
    expect(failed.entries).toHaveLength(1);
    await write(async () => {});
    expect(listMemories(ws)[0]?.text).toBe(failed.entries[0].text);
    expect(errors).toHaveBeenCalled();
    expect(failures).toEqual([expect.objectContaining({ level: "error" })]);
    save.mockImplementationOnce(async (...args) => {
      await finishVersion.promise;
      return snapshotNow(...args);
    });
    const saved = body(
      await client.callTool({ ...call, arguments: { text: text.split("\n")[1], ai: "claude" } }),
    );
    expect(saved.entries).toHaveLength(1);
    let closed = false;
    const closing = server.close().then(() => {
      closed = true;
    });
    await Promise.resolve();
    expect(closed).toBe(false);
    finishVersion.resolve();
    await closing;
    expect((await history(ws))[0]?.oid).not.toBe(saved.before);
    // 即使上次存版本失败，整批恢复仍按已返回的 before 执行。
    await restore(ws, failed.before);
    expect(listMemories(ws)).toEqual([]);
  } finally {
    finishVersion.resolve();
    vi.restoreAllMocks();
    await client.close();
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});
