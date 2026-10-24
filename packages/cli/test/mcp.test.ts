import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  addMemory,
  addRecord,
  calendarPushEntries,
  handoverPack,
  history,
  initWorkspace,
  mcpToken,
  parseFrontmatter,
  readRecords,
  setFinanceAccess,
} from "@kaitu/core";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { expect, it } from "vitest";
import { startMcpHttp } from "../src/mcp/http.js";
import { type ToolSet, createMcpServer } from "../src/mcp/server.js";

it("SDK 通过 stdio 列出 remote 工具、记录训练并保存客户端来源，不能调用删除", async () => {
  const root = mkdtempSync(join(tmpdir(), "kaitu-mcp-"));
  const client = new Client({ name: "grok-bot", version: "1" });
  const localState = mkdtempSync(join(tmpdir(), "kaitu-mcp-state-"));
  try {
    const ws = await initWorkspace(root);
    const before = (await history(ws)).length;
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [
          fileURLToPath(new URL("../dist/main.js", import.meta.url)),
          "mcp",
          "--dir",
          root,
          "--tools",
          "remote",
        ],
        stderr: "pipe",
        env: { KAITU_LOCAL_STATE_DIR: localState },
      }),
    );
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name)).toContain("record_add");
    expect(tools.map((tool) => tool.name)).not.toContain("record_delete");
    const response = await client.callTool({
      name: "record_add",
      arguments: {
        type: "workout",
        data: { exercise: "深蹲", sets: 3, reps: 12, weight_kg: 60, session_id: "mcp-session" },
      },
    });
    expect(response.isError).not.toBe(true);
    expect(readRecords(ws, "workout")[0]?.exercise).toBe("深蹲");
    const versions = await history(ws);
    expect(versions).toHaveLength(before + 1);
    expect(versions[0]?.message).toContain("MCP:grok-bot");
    // 只交标题和链接的新闻：发布方按网址补，交来的 Agent 记在 via。
    const news = await client.callTool({
      name: "record_add",
      arguments: { type: "news_item", data: { title: "合成新闻", url: "https://www.example.com/a" } },
    });
    expect(news.isError).not.toBe(true);
    expect(readRecords(ws, "news_item")[0]).toMatchObject({ source: "example.com", via: "grok" });
    const newsId = readRecords(ws, "news_item")[0]?.id;
    expect((await client.callTool({ name: "news_try", arguments: { id: newsId } })).isError).not.toBe(true);
    expect(readRecords(ws, "news_item")[0]).toMatchObject({ by: "agent", status: "tried" });
    expect((await client.callTool({ name: "news_dismiss", arguments: { id: newsId } })).isError).not.toBe(
      true,
    );
    expect(readRecords(ws, "news_item")[0]).toMatchObject({ by: "agent", status: "dismissed" });
    const deleted = await client.callTool({
      name: "record_delete",
      arguments: { type: "workout", id: readRecords(ws, "workout")[0]?.id },
    });
    expect(deleted.isError).toBe(true);
    expect(readRecords(ws, "workout")).toHaveLength(1);
  } finally {
    await client.close();
    rmSync(root, { recursive: true, force: true });
    rmSync(localState, { recursive: true, force: true });
  }
});

it("HTTP 拒绝缺失或错误 token 和错误 Host，有效 token 能连接，轮换后旧 token 失效", async () => {
  const root = mkdtempSync(join(tmpdir(), "kaitu-mcp-http-"));
  const ws = await initWorkspace(root);
  const http = await startMcpHttp(ws, { port: 0 });
  const client = new Client({ name: "remote-client", version: "1" });
  try {
    for (const authorization of [undefined, "Bearer wrong"]) {
      expect(
        (await fetch(http.url, { headers: authorization ? { Authorization: authorization } : {} })).status,
      ).toBe(401);
    }
    const token = mcpToken(ws);
    const wrongHost = await new Promise<number | undefined>((resolve, reject) => {
      const req = request(
        http.url,
        { headers: { Host: "attacker.example", Authorization: `Bearer ${token}` } },
        (res) => {
          res.resume();
          res.on("end", () => resolve(res.statusCode));
        },
      );
      req.on("error", reject);
      req.end();
    });
    expect(wrongHost).toBe(403);
    await client.connect(
      new StreamableHTTPClientTransport(new URL(http.url), {
        requestInit: { headers: { Authorization: `Bearer ${token}` } },
      }),
    );
    expect((await client.listTools()).tools.map((tool) => tool.name)).not.toContain("record_delete");
    mcpToken(ws, true);
    expect((await fetch(http.url, { headers: { Authorization: `Bearer ${token}` } })).status).toBe(401);
  } finally {
    await client.close();
    await http.close();
    rmSync(root, { recursive: true, force: true });
  }
});

it("本机和远程 MCP 按连接读取财务，列表、搜索、索引和别名都保留敏感记忆边界", async () => {
  const root = mkdtempSync(join(tmpdir(), "kaitu-mcp-sensitive-"));
  try {
    const ws = await initWorkspace(root);
    const open = await addMemory(ws, { type: "fact", name: "Open note", text: "合成公开记忆" });
    const secret = await addMemory(ws, {
      type: "fact",
      name: "Secret note",
      text: "合成敏感记忆",
      sensitive: true,
    });
    symlinkSync(ws.resolve(`memory/${secret.file}`), join(root, "alias.md"));
    const call = async (tools: ToolSet, name: string, args: Record<string, unknown>) => {
      const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
      const client = new Client({ name: "remote-client", version: "1" });
      await createMcpServer(ws, tools).connect(serverSide);
      await client.connect(clientSide);
      try {
        const response = await client.callTool({ name, arguments: args });
        return {
          error: response.isError === true,
          text: (response.content as { text: string }[])[0]?.text ?? "",
        };
      } finally {
        await client.close();
      }
    };
    for (const [name, args] of [
      ["memory_list", {}],
      ["memory_search", { query: "合成" }],
      ["read_file", { path: "memory/MEMORY.md" }],
    ] as const) {
      const remote = await call("remote", name, args);
      expect(remote.text).toContain("合成公开记忆");
      expect(remote.text).not.toContain("合成敏感记忆");
      expect((await call("all", name, args)).text).not.toContain("合成敏感记忆");
    }
    for (const path of [`memory/${secret.file}`, "alias.md"]) {
      expect((await call("remote", "read_file", { path })).error).toBe(true);
      expect((await call("all", "read_file", { path })).error).toBe(true);
    }
    expect((await call("remote", "read_file", { path: `memory/${open.file}` })).text).toContain(
      "合成公开记忆",
    );
    addRecord(ws, "finance_account", {
      name: "Synthetic wallet",
      kind: "wallet",
      source: "manual",
      currency: "CNY",
    });
    expect((await call("remote", "record_list", { type: "finance_account" })).text).not.toContain(
      "Synthetic wallet",
    );
    expect((await call("all", "record_list", { type: "finance_account" })).text).toContain(
      "Synthetic wallet",
    );
    for (const [tools, id] of [
      ["remote", "remote-mcp"],
      ["all", "local-mcp"],
    ] as const) {
      for (const allowed of [true, false]) {
        setFinanceAccess(ws, id, allowed);
        const records = await call(tools, "record_list", { type: "finance_account" });
        expect(records.text.includes("Synthetic wallet")).toBe(allowed);
        expect((await call(tools, "read_file", { path: "finance/STATUS.md" })).error).toBe(!allowed);
        const pack = await call(tools, "reading_pack", { locale: "en", finance: !allowed });
        expect(pack.error).toBe(false);
        expect(JSON.parse(pack.text)).toEqual(handoverPack(ws, "en", new Date(), allowed));
        expect(pack.text).not.toContain("合成敏感记忆");
      }
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it("MCP 日程回执仍待确认，模型不能伪造用户署名或经记录接口写目标", async () => {
  const root = mkdtempSync(join(tmpdir(), "kaitu-mcp-decisions-"));
  const client = new Client({ name: "synthetic-agent", version: "1" });
  const server = await initWorkspace(root);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  try {
    await createMcpServer(server).connect(serverSide);
    await client.connect(clientSide);
    const response = await client.callTool({
      name: "propose_block",
      arguments: { title: "合成日程", start: "10:00", end: "11:00" },
    });
    expect(response.isError).not.toBe(true);
    const receipt = JSON.parse((response.content as { text: string }[])[0]?.text ?? "");
    expect(receipt).toMatchObject({
      block: { kind: "proposal", status: "pending" },
      version: expect.any(String),
    });
    expect(parseFrontmatter<{ blocks: unknown[] }>(server.readText("NOW.md")).data.blocks).toContainEqual(
      receipt.block,
    );
    expect(calendarPushEntries(server)).toEqual([]);
    const spoof = await client.callTool({
      name: "record_add",
      arguments: { type: "task", data: { title: "伪造决定", status: "open", by: "user" } },
    });
    expect(spoof.isError).not.toBe(true);
    expect(readRecords(server, "task")).toEqual([
      expect.objectContaining({ title: "伪造决定", by: "agent", status: "proposed" }),
    ]);
    const task = readRecords(server, "task")[0];
    const promote = await client.callTool({
      name: "record_update",
      arguments: {
        type: "task",
        id: task?.id,
        data: { status: "open", by: "user", source: "manual", confirmed: true },
      },
    });
    expect(promote.isError).toBe(true);
    expect(readRecords(server, "task")).toEqual([task]);
    const goal = await client.callTool({
      name: "record_add",
      arguments: { type: "goal", data: { title: "未经确认的目标", status: "active" } },
    });
    expect(goal.isError).toBe(true);
    expect(server.readJson("me/goals.json")).toEqual([]);
    const event = await client.callTool({
      name: "record_add",
      arguments: {
        type: "event",
        data: {
          title: "绕过确认的日程",
          start: "2026-10-22T10:00:00Z",
          end: "2026-10-22T11:00:00Z",
          calendar: "work",
          source: "synthetic",
          by: "user",
        },
      },
    });
    expect(event.isError).toBe(true);
    expect(readRecords(server, "event")).toEqual([]);
  } finally {
    await client.close();
    rmSync(root, { recursive: true, force: true });
  }
});
