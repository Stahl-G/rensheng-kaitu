import { Workspace } from "@kaitu/core";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer } from "../mcp/server.js";

const ws = new Workspace(process.argv[2] as string);
const connection = process.env.KAITU_AGENT_CONNECTION === "phone-ask" ? "phone-ask" : "local-ask";
await createMcpServer(ws, "all", undefined, connection).connect(new StdioServerTransport());
