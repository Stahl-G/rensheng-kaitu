import {
  type AgentConnectionId,
  type OnboardingAi,
  type Workspace,
  addExperiences,
  addMemory,
  agentCanRead,
  agentReadingPack,
  cancelOnboardingPreview,
  captureMemory,
  completeTask,
  confirmOnboardingMemory,
  deferSnapshots,
  dismissNews,
  explorationCommandSchema,
  inboxNoteDone,
  inboxNotes,
  learningCheckinSchema,
  lifeMap,
  listInvestments,
  listLearning,
  listMemories,
  listProjects,
  listTasks,
  logProject,
  memoryCaptureSchema,
  memoryInput,
  memoryType,
  onboardingContent,
  onboardingStatus,
  pendingWorkspaceFiles,
  pick,
  previewOnboardingMemory,
  projectGithub,
  proposeBlock,
  proposeTask,
  publicRecords,
  readAgentFile,
  readExperienceImports,
  readExploration,
  readLearning,
  readNews,
  readPhases,
  readRecords,
  readStatus,
  recordOnboardingAiConnection,
  recordReferences,
  removeMemory,
  resolvePlace,
  saveLearningCheckin,
  searchChats,
  searchMemories,
  snapshot,
  snapshotNow,
  startLearning,
  startLearningSchema,
  syncProject,
  syncProjects,
  tryNews,
  updateMemory,
  writeAgentRecord,
  writeDigest,
  writeExploration,
  writeProjectView,
} from "@kaitu/core";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export type ToolSet = "remote" | "all";
type Operation = () => Promise<unknown>;
export function writeQueue() {
  let queue: Promise<unknown> = Promise.resolve();
  return (operation: Operation, after?: () => Promise<void>): Promise<unknown> => {
    const next = queue.then(operation);
    // 回执只等文件写完；后台版本仍先于后续写入，保留每批撤销的边界。
    queue = next.then(() => after?.()).catch(() => {});
    return next;
  };
}

export function createMcpServer(
  ws: Workspace,
  tools: ToolSet = "all",
  write = writeQueue(),
  connection: AgentConnectionId = tools === "remote" ? "remote-mcp" : "local-mcp",
) {
  const server = new McpServer({ name: "kaitu", version: "0.0.0" }, { capabilities: { logging: {} } });
  const close = server.close.bind(server);
  server.close = async () => {
    await close();
    await write(async () => {});
  };
  server.server.oninitialized = () => {
    recordOnboardingAiConnection(ws, server.server.getClientVersion()?.name ?? "MCP");
  };
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
    type: z.string().describe("preference、fact、context、person、decision"),
    name: z.string().optional().describe("不写时取正文开头"),
    text,
    source: z.string().optional(),
    sensitive: z.boolean().optional(),
  };
  register("onboarding_status", "读取首次使用内容、待核对草稿、已采纳下一步和实时开始清单。", {}, () =>
    onboardingStatus(ws),
  );
  register(
    "memory_capture",
    "自动保存本次自然表达的个人事实、偏好或决定，无须逐条确认；AI估算/建议须标来源和不确定性。临时/引用/假设不进长期记忆。返回落盘回读与撤销用file；更正用replaces和expected，不覆盖原条。先按实体、时间、单位和上下文消解，只有仍影响后续行为的冲突才交conflict。重试复用原idempotency_key。",
    memoryCaptureSchema.shape,
    (input) =>
      captureMemory(ws, input, {
        scheduleVersion: (message) => {
          void write(async () => {
            const version = await snapshotNow(ws, message);
            if (!version && (await pendingWorkspaceFiles(ws)).length) throw new Error("版本尚未保存");
          }).catch(async (error) => {
            await server
              .sendLoggingMessage({
                level: "error",
                data: `记忆文件已保存，可单条撤销；版本保存失败：${String(error)}`,
              })
              .catch(() => {});
          });
        },
      }),
    true,
  );
  server.registerTool(
    "onboarding_memory_review",
    {
      description:
        "仅在用户主动要求逐条审核时使用；默认自然记录用 memory_capture。把当前对话中用户明确说出的新事实、偏好、决定送入开图记忆预览；客户端向用户展示原文并勾选确认后才保存。只交本次变化，不交推断或全量历史。不支持用户确认表单时不写入，请复制到开图搬记忆入口。",
      inputSchema: {
        text: text
          .max(20000)
          .describe("每行一条用户原话，使用现有 [事实]、[偏好]、[决定] 标签，保留限定、日期和来源上下文"),
        ai: text.describe("onboarding_status.content.ais 中的来源 id；未知用 other"),
        locale: z.enum(["zh-CN", "en"]).default("zh-CN"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ text, ai, locale }, { signal }) => {
      let saved = false;
      const response = await wrap(async () => {
        if (!server.server.getClientCapabilities()?.elicitation?.form)
          throw new Error(
            pick(
              locale,
              "当前 AI 无法显示确认表单，尚未保存。请复制候选到开图「从常用的 AI 搬来记忆」预览并确认。",
              "This AI cannot show a confirmation form. Nothing was saved. Copy the candidates into Kaitu’s memory import to preview and confirm.",
            ),
          );
        const preview = previewOnboardingMemory(ws, text, ai as OnboardingAi, { locale });
        try {
          if (preview.candidates.some((entry) => entry.target !== "memory"))
            throw new Error(
              pick(
                locale,
                "此入口只记事实、偏好和决定；目标、项目和方向请在开图搬记忆预览中选择去处。",
                "Use Kaitu’s memory import to choose where goals, projects and directions belong.",
              ),
            );
          if (!preview.candidates.length) return { candidates: [] };
          const source = onboardingContent(locale).ais.find((item) => item.id === ai)?.name;
          const response = await server.server.elicitInput(
            {
              mode: "form",
              message: pick(
                locale,
                `记住这次变化（来源：${source}）。请核对原话、限定和日期，只勾选要保存到开图的记忆；取消不会写入。`,
                `Remember this change (source: ${source}). Check the wording, conditions and dates, then select the memories to save in Kaitu. Cancel saves nothing.`,
              ),
              requestedSchema: {
                type: "object",
                properties: {
                  selected: {
                    type: "array",
                    title: pick(locale, "要记住的变化", "Changes to remember"),
                    items: {
                      anyOf: preview.candidates.map((entry) => ({ const: entry.id, title: entry.original })),
                    },
                  },
                },
                required: ["selected"],
              },
            },
            { signal },
          );
          if (response.action !== "accept") return { action: response.action };
          const selected = z.array(z.string()).parse(response.content?.selected);
          if (!selected.length) return { action: "cancel" };
          const messages: string[] = [];
          // 等用户时不占写队列；到真正写入时再核对取消、预览期限与选择范围。
          return await write(
            async () => {
              signal.throwIfAborted();
              const resumeSnapshots = deferSnapshots(ws, (message) => messages.push(message));
              try {
                const result = await confirmOnboardingMemory(ws, preview.token, selected);
                saved = result.entries.length > 0;
                return result;
              } finally {
                resumeSnapshots();
              }
            },
            async () => {
              if (!messages.length) return;
              // 先把回执交给客户端，再在同一写队列中保存版本。
              await new Promise<void>((resolve) => setImmediate(resolve));
              try {
                const version = await snapshotNow(ws, [...new Set(messages)].join("；"));
                if (!version && (await pendingWorkspaceFiles(ws)).length)
                  throw new Error("Version was not saved");
              } catch (error) {
                const message = pick(
                  locale,
                  "记忆文件已保存，但版本保存失败。请检查文件夹权限，并在开图历史中核对后重试保存版本。",
                  "The memory files were saved, but saving the version failed. Check folder permissions, then review Kaitu’s history and retry saving the version.",
                );
                console.error(message, error);
                await server.sendLoggingMessage({ level: "error", data: message }).catch(() => {});
              }
            },
          );
        } finally {
          cancelOnboardingPreview(ws, preview.token);
        }
      });
      if (saved && !("isError" in response))
        response.content.push({
          type: "text",
          text: pick(locale, "已保存，正在存版本。", "Saved. Saving the version in the background."),
        });
      return response;
    },
  );
  register("status", "读取今天计划、待确认数量、模块进度与近 7 天数据，无需确认。", {}, () =>
    readStatus(ws, new Date(), connection),
  );
  register(
    "reading_pack",
    "现取与交接包相同的近况，不落盘；敏感记忆排除，财务按当前连接权限决定。",
    { locale: z.enum(["zh-CN", "en"]).optional() },
    ({ locale }) => agentReadingPack(ws, connection, locale),
  );
  register("inbox_notes", "读取未整理的收件箱笔记及来源。", {}, () => inboxNotes(ws));
  register("news_read", "读取近期新闻推荐、今天 X 热门和来源数量。", {}, () => readNews(ws));
  register(
    "news_try",
    "将新闻加入对应模块的建议下一步，保存版本。",
    { id: text },
    ({ id }) => tryNews(ws, id, { by: "agent", actor: actor() }),
    true,
  );
  register(
    "news_dismiss",
    "标记单条新闻不相关，保存版本。",
    { id: text },
    ({ id }) => dismissNews(ws, id, { by: "agent", actor: actor() }),
    true,
  );
  register("record_types", "列出全部记录类型、字段约束和合法示例，只读。", {}, () => recordReferences(ws));
  register(
    "record_list",
    "按用户时区的日期范围查询记录，无需确认。",
    { type, from: date.optional(), to: date.optional() },
    ({ type, from, to }) => {
      const rows = readRecords(ws, type, { from, to });
      return publicRecords(ws, type, rows, connection);
    },
  );
  register(
    "task_add",
    "新增待办，status 为 proposed，用户在今天页采纳后才为 open，保存版本。remind_at 供今天页与早间计划提醒。",
    {
      title: text,
      due: text.optional(),
      remind_at: text.optional(),
      project: text.optional(),
      investment: text.optional(),
      notes: text.optional(),
      source: text.optional(),
    },
    (input) => {
      return proposeTask(ws, input, actor());
    },
    true,
  );
  register(
    "task_list",
    "查询待办，默认 open；dueBefore 日期含当天，时间截止按用户时区判断。",
    {
      status: z.enum(["proposed", "open", "done", "cancelled", "all"]).optional(),
      dueBefore: text.optional(),
    },
    (input) => {
      const rows = listTasks(ws, { ...input });
      return publicRecords(ws, "task", rows, connection);
    },
  );
  const experience = z
    .object({
      place: z.object({ name: text, country: text.optional() }).strict(),
      event_type: z.enum(["lived", "worked", "studied", "travel", "visit", "other"]),
      fact_status: z.enum(["observed", "user_reported", "inferred", "planned", "suggested"]),
      start: text.optional(),
      end: text.optional(),
      time_precision: z.enum(["year", "month", "day", "unknown"]),
      title: text.optional(),
      notes: text.optional(),
      source: text,
    })
    .strict();
  register(
    "place_resolve",
    "按城市名和国家代码查询城市候选，只读。",
    { name: text, country: text.optional() },
    ({ name, country }) => resolvePlace(name, country),
  );
  register(
    "experience_add",
    "批量记录地点经历，只给城市名和国家代码，不给坐标；计划用 planned。",
    { items: z.array(experience).min(1) },
    ({ items }) => addExperiences(ws, items, "agent"),
    true,
  );
  register("investment_list", "列出项目、学习主题与长期投入。", {}, () => listInvestments(ws));
  register("phase_list", "读取阶段建议与用户回顾。", {}, () => readPhases(ws));
  register("exploration_read", "读取方向、依据、尝试与认识变化，只读。", {}, () => readExploration(ws));
  register(
    "exploration_write",
    "记录方向建议、尝试与结果。修改带预期版本；AI 不能替用户采纳、暂停或归档。",
    { command: explorationCommandSchema },
    async ({ command }) => {
      const result = await writeExploration(ws, command, "agent");
      return result;
    },
    true,
  );
  register("life_map", "读取人生地图、待核对经历与未知时间数量，只读。", {}, () => lifeMap(ws));
  register(
    "experience_imports",
    "读取足迹来源开关、导入批次及待恢复状态。来源与批次控制由用户在界面处理。",
    {},
    () => readExperienceImports(ws),
  );
  const visible = (memories: ReturnType<typeof listMemories>) =>
    memories.filter((memory) => agentCanRead(ws, `memory/${memory.file}`, connection));
  register("memory_list", "列出已保存记忆，无需确认。", {}, () => visible(listMemories(ws)));
  register("memory_search", "按关键词查找记忆，无需确认。", { query: text }, ({ query }) =>
    visible(searchMemories(ws, query)),
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
    ({ path }) => readAgentFile(ws, path, connection),
  );
  register(
    "record_add",
    "新增一条日常记录，无需确认，可从历史撤销；批量导入须先由用户确认。",
    { type, data },
    ({ type, data }) => {
      return writeAgentRecord(ws, "add", type, actor(), data);
    },
    true,
  );
  register(
    "memory_save",
    "兼容直接保存一条记忆；自然表达默认用 memory_capture 保留原话、分类和幂等标识。有对应模块的内容写模块，敏感个人内容标 sensitive。",
    memory,
    (input) => addMemory(ws, memoryInput(input), { actor: actor() }),
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
    (input) => {
      return proposeBlock(ws, input, actor());
    },
    true,
  );
  server.registerTool(
    "project_view_write",
    {
      description: "写入项目 view.json，按项目视图 schema 校验。",
      inputSchema: { slug: text, view: z.unknown().describe("项目视图 JSON 对象，blocks 或 html 二选一") },
      annotations: { readOnlyHint: false },
    },
    ({ slug, view }) => wrap(() => writeProjectView(ws, slug, view)),
  );
  register("learning_list", "列出学习主题与各自的下一步。", {}, () => listLearning(ws));
  register("learning_read", "读取一个学习主题的来源、学习记录和下一步。", { topic: text }, ({ topic }) =>
    readLearning(ws, topic),
  );
  register(
    "learning_start",
    "存一篇材料并开一个学习主题；已有主题就沿用，不覆盖笔记。没读到原文时只存链接，不编正文。",
    startLearningSchema.shape,
    (input) => startLearning(ws, input),
    true,
  );
  register(
    "learning_save",
    "追加用户自己说出的理解、没弄懂的问题和一个小的下一步；AI 的讲解不算用户理解。每次新保存用新的 operationId。",
    learningCheckinSchema.shape,
    (input) => saveLearningCheckin(ws, input),
    true,
  );
  register("project_list", "列出项目进度与下一步。", {}, () => listProjects(ws));
  register("project_github", "读取项目 GitHub 快照与同步状态。", { slug: text }, ({ slug }) => {
    return projectGithub(ws, slug);
  });
  register(
    "project_log",
    "记录项目进展。",
    { slug: text, text, date: date.optional() },
    async (input) => {
      return logProject(ws, input.slug, input.text, { date: input.date, by: "agent" });
    },
    true,
  );
  if (tools === "all") {
    register(
      "task_done",
      "完成待办，追加修订并保存版本。",
      { id: text },
      ({ id }) => completeTask(ws, id, { by: "agent", actor: actor() }),
      true,
    );
    register(
      "inbox_note_done",
      "将已整理的笔记归档并保存版本。",
      { path: text },
      ({ path }) => inboxNoteDone(ws, path, actor()),
      true,
    );
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
      { type, id: text, data, expected_revision: z.number().int().min(1).optional() },
      ({ type, id, data, expected_revision }) =>
        writeAgentRecord(ws, "update", type, actor(), data, id, expected_revision),
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
      ({ file, patch }) => {
        const type = patch.type === undefined ? undefined : memoryType(patch.type);
        if (patch.type !== undefined && !type)
          throw new Error("记忆类型只能是 preference、fact、context、person、decision");
        return updateMemory(ws, file, { ...patch, type }, { actor: actor() });
      },
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
