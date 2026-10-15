import {
  type Workspace,
  addMemory,
  assertPublicProject,
  listMemories,
  listProjects,
  logProject,
  proposeBlock,
  publicProject,
  readAgentFile,
  readRecords,
  readStatus,
  recordReferences,
  removeMemory,
  searchChats,
  searchMemories,
  snapshot,
  syncProject,
  syncProjects,
  updateMemory,
  writeAgentRecord,
  writeDigest,
} from "@kaitu/core";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export type ToolSet = "remote" | "all";
type Operation = () => Promise<unknown>;
export function writeQueue() {
  let queue: Promise<unknown> = Promise.resolve();
  return (operation: Operation): Promise<unknown> => {
    const next = queue.then(operation);
    queue = next.catch(() => {});
    return next;
  };
}

export function createMcpServer(ws: Workspace, tools: ToolSet = "all", write = writeQueue()) {
  const server = new McpServer({ name: "kaitu", version: "0.0.0" });
  const actor = () => {
    const name = (server.server.getClientVersion()?.name ?? "unknown")
      .replace(/[\p{Cc}\p{Cf}]/gu, "")
      .slice(0, 100);
    return `Agent（MCP:${name}）`;
  };
  const result = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value) }] });
  const wrap = async (operation: () => unknown | Promise<unknown>) => {
    try {
      return result(await operation());
    } catch (error) {
      return {
        content: [{ type: "text" as const, text: error instanceof Error ? error.message : "操作失败" }],
        isError: true,
      };
    }
  };
  const register = <T extends z.ZodRawShape>(
    name: string,
    description: string,
    inputSchema: T,
    operation: (input: z.infer<z.ZodObject<T>>) => unknown | Promise<unknown>,
    mutates = false,
  ) => {
    const shape: z.ZodRawShape = inputSchema;
    server.registerTool(
      name,
      {
        description,
        inputSchema: shape,
        annotations: { readOnlyHint: !mutates },
      },
      (input) =>
        wrap(() =>
          mutates
            ? write(() => Promise.resolve(operation(input as z.infer<z.ZodObject<T>>)))
            : operation(input as z.infer<z.ZodObject<T>>),
        ),
    );
  };
  const text = z.string().min(1);
  const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
  const type = text.describe("module.json 中已定义的记录类型，如 workout、meal");
  const data = z.record(z.string(), z.unknown()).describe("记录字段，按工作区 schema 校验");
  const memory = {
    type: z.enum(["preference", "fact", "context", "person", "decision"]),
    name: text,
    text,
    source: z.string().optional(),
    sensitive: z.boolean().optional(),
  };
  register("status", "读取今天计划、待确认数量、模块进度与近 7 天数据，无需确认。", {}, () =>
    readStatus(ws, new Date(), tools === "remote"),
  );
  register("record_types", "列出全部记录类型、字段约束和合法示例，只读。", {}, () => recordReferences(ws));
  register(
    "record_list",
    "按用户时区的日期范围查询记录，无需确认。",
    { type, from: date.optional(), to: date.optional() },
    ({ type, from, to }) =>
      readRecords(ws, type, { from, to }).filter(
        (row) => tools !== "remote" || type !== "project_metric" || publicProject(ws, row.project),
      ),
  );
  register("memory_list", "列出已保存记忆，无需确认。", {}, () => listMemories(ws));
  register("memory_search", "按关键词查找记忆，无需确认。", { query: text }, ({ query }) =>
    searchMemories(ws, query),
  );
  register(
    "search_chats",
    "检索历史对话，无需确认；结果包含来源路径。",
    { query: text, limit: z.number().int().min(1).max(100).optional() },
    ({ query, limit }) => searchChats(ws, query, { limit }),
  );
  register(
    "read_file",
    "只读工作区内 .md / .json，不读 .kaitu/ 和版本库目录，无需确认。",
    { path: text },
    ({ path }) => readAgentFile(ws, path, tools === "remote"),
  );
  register(
    "record_add",
    "新增一条日常记录，无需确认，可从历史撤销；批量导入须先由用户确认。",
    { type, data },
    ({ type, data }) => writeAgentRecord(ws, "add", type, actor(), data),
    true,
  );
  register(
    "memory_save",
    "保存一条记忆，无需确认；有对应模块的内容写模块，敏感信息仅在用户明确要求时保存。",
    memory,
    (input) => addMemory(ws, input, { actor: actor() }),
    true,
  );
  register(
    "write_digest",
    "写当天或指定日期的动态简报，无需确认；按客户端来源合并，同一来源再次提交只替换自己的小节。",
    { date, content: text.max(500000) },
    ({ date, content }) =>
      writeDigest(ws, date, content, actor(), server.server.getClientVersion()?.name ?? "unknown"),
    true,
  );
  register(
    "propose_block",
    "往今天 NOW.md 追加待确认日程建议；须用户在工作台确认，不写外部日历。",
    {
      title: text,
      start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
      end: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$|^24:00$/),
      module: text.optional(),
      ref: text.optional(),
    },
    (input) => proposeBlock(ws, input, actor()),
    true,
  );
  register("project_list", "列出项目进度与下一步。", {}, () =>
    listProjects(ws, { publicOnly: tools === "remote" }),
  );
  register(
    "project_log",
    "记录项目进展。",
    { slug: text, text, date: date.optional() },
    async (input) => {
      if (tools === "remote") assertPublicProject(ws, input.slug);
      return logProject(ws, input.slug, input.text, { date: input.date, by: "agent" });
    },
    true,
  );
  if (tools === "all") {
    register(
      "project_sync",
      "只读链接文件夹并同步项目计数。",
      { slug: text.optional() },
      ({ slug }) => (slug ? syncProject(ws, slug) : syncProjects(ws)),
      true,
    );
    register(
      "record_update",
      "修改一条记录，无需确认，可撤销。",
      { type, id: text, data },
      ({ type, id, data }) => writeAgentRecord(ws, "update", type, actor(), data, id),
      true,
    );
    register(
      "record_delete",
      "删除一条记录，可撤销；同一批删除超过 10 条须先由用户确认。",
      { type, id: text },
      ({ type, id }) => writeAgentRecord(ws, "delete", type, actor(), {}, id),
      true,
    );
    register(
      "memory_update",
      "更新记忆，无需确认；敏感内容仅在用户明确要求时保存。",
      {
        file: text,
        patch: z.object({
          type: memory.type.optional(),
          name: text.optional(),
          text: text.optional(),
          sensitive: z.boolean().optional(),
        }),
      },
      ({ file, patch }) => updateMemory(ws, file, patch, { actor: actor() }),
      true,
    );
    register(
      "memory_delete",
      "删除一条记忆，可从历史撤销。",
      { file: text },
      ({ file }) => removeMemory(ws, file, { actor: actor() }),
      true,
    );
    register(
      "snapshot",
      "保存工作区当前改动为一个版本，无需确认；不代替修改规则或目标所需的用户确认。",
      { message: text.max(500) },
      async ({ message }) => ({ version: await snapshot(ws, `${actor()}保存版本：${message}`) }),
      true,
    );
  }
  return server;
}
