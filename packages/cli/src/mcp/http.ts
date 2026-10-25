import { randomUUID, timingSafeEqual } from "node:crypto";
import { type IncomingMessage, type ServerResponse, createServer } from "node:http";
import { KaituError, type Workspace, mcpToken } from "@kaitu/core";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { type ToolSet, createMcpServer, writeQueue } from "./server.js";

function json(res: ServerResponse, status: number, error: string) {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify({ error }));
}
async function readBody(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1024 * 1024) throw new KaituError("请求过大", "TOO_LARGE");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export async function startMcpHttp(ws: Workspace, options: { port?: number; tools?: ToolSet } = {}) {
  const requestedPort = options.port ?? 4871;
  if (!Number.isInteger(requestedPort) || requestedPort < 0 || requestedPort > 65535) {
    throw new KaituError("端口必须是 1–65535 的整数", "BAD_ARGS");
  }
  mcpToken(ws);
  const sessions = new Map<
    string,
    { transport: StreamableHTTPServerTransport; server: ReturnType<typeof createMcpServer>; touched: number }
  >();
  const write = writeQueue();
  let port = requestedPort;
  const http = createServer(async (req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "no-store");
    if (![`localhost:${port}`, `127.0.0.1:${port}`].includes(req.headers.host ?? "")) {
      return json(res, 403, "拒绝非本机 Host");
    }
    try {
      const expected = Buffer.from(`Bearer ${mcpToken(ws)}`);
      const supplied = Buffer.from(req.headers.authorization ?? "");
      if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
        res.setHeader("WWW-Authenticate", "Bearer");
        return json(res, 401, "需要有效的 Bearer token");
      }
      if (req.url?.split("?")[0] !== "/mcp") return json(res, 404, "接口不存在");
      if (!["GET", "POST", "DELETE"].includes(req.method ?? "")) return json(res, 405, "请求方法不支持");
      const id = req.headers["mcp-session-id"];
      if (Array.isArray(id)) return json(res, 400, "会话 id 不合法");
      let session = id ? sessions.get(id) : undefined;
      if (id && !session) return json(res, 404, "MCP 会话不存在，请重新连接");
      const data: unknown = req.method === "POST" ? await readBody(req) : undefined;
      if (!session) {
        if (req.method !== "POST" || !isInitializeRequest(data)) return json(res, 400, "请先初始化 MCP 会话");
        if (sessions.size >= 64) return json(res, 503, "连接过多，请稍后重试");
        const server = createMcpServer(ws, options.tools ?? "remote", write);
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: randomUUID,
          enableJsonResponse: true,
        });
        session = { server, transport, touched: Date.now() };
        server.server.onclose = () => {
          if (transport.sessionId) sessions.delete(transport.sessionId);
        };
        await server.connect(transport);
        try {
          await transport.handleRequest(req, res, data);
          if (transport.sessionId) sessions.set(transport.sessionId, session);
          else await server.close();
        } catch (error) {
          await server.close();
          throw error;
        }
        return;
      }
      session.touched = Date.now();
      await session.transport.handleRequest(req, res, data);
    } catch (error) {
      if (!res.headersSent)
        json(
          res,
          error instanceof KaituError && error.code === "TOO_LARGE" ? 413 : 400,
          error instanceof KaituError ? error.message : "MCP 请求未完成，请检查格式",
        );
      else if (!res.writableEnded) res.end();
    }
  });
  await new Promise<void>((resolve, reject) => {
    http.once("error", reject);
    http.listen(requestedPort, "127.0.0.1", resolve);
  });
  const address = http.address();
  if (!address || typeof address === "string") throw new Error("无法取得监听端口");
  port = address.port;
  const expiry = setInterval(() => {
    for (const session of sessions.values()) {
      if (Date.now() - session.touched > 30 * 60000) void session.server.close();
    }
  }, 60000);
  expiry.unref();
  return {
    port,
    url: `http://127.0.0.1:${port}/mcp`,
    close: async () => {
      clearInterval(expiry);
      await Promise.all([...sessions.values()].map(({ server }) => server.close()));
      await new Promise<void>((resolve, reject) =>
        http.close((error) => (error ? reject(error) : resolve())),
      );
      await write(async () => {});
    },
  };
}
