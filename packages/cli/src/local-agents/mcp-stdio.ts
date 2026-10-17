import { Workspace } from "@kaitu/core";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer } from "../mcp/server.js";

const workspace = process.argv[2];
if (!workspace) throw new Error("缺少开图工作区");
await createMcpServer(new Workspace(workspace), "remote").connect(new StdioServerTransport());
