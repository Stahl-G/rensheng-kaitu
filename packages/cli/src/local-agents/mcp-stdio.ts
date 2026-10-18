import { Workspace } from "@kaitu/core";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer } from "../mcp/server.js";

const ws = new Workspace(process.argv[2] as string);
await createMcpServer(ws).connect(new StdioServerTransport());
