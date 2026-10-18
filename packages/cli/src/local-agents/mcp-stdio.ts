import { Workspace } from "@kaitu/core";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer } from "../mcp/server.js";

const root = process.argv[2];
if (typeof root !== "string" || !root) throw new Error("开图工作区路径无效 / Invalid Kaitu workspace");
const ws = new Workspace(root);
await createMcpServer(ws).connect(new StdioServerTransport());
