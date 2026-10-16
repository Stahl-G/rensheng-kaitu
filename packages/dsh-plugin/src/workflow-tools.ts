import { readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import {
  ONBOARDING,
  type Workspace,
  addMemory,
  addPhoto,
  addTask,
  cancelOnboardingPreview,
  cancelTask,
  completeTask,
  confirmOnboardingMemory,
  confirmOnboardingSetup,
  createProject,
  disableDrive,
  draftOnboardingMatter,
  driveStatus,
  enableDrive,
  explorationCommandSchema,
  importAppleHealth,
  importChatgptConversations,
  importIcs,
  importMemories,
  importNutAi,
  inboxNoteDone,
  inboxNotes,
  lifeMap,
  linkProject,
  listMemories,
  listProjects,
  listTasks,
  logProject,
  onboardingMatterSuggestionSchema,
  onboardingSetupSchema,
  onboardingStatus,
  previewOnboardingMemory,
  previewOnboardingSetup,
  processInbox,
  projectDirectory,
  readAgentFile,
  readExperienceImports,
  readExploration,
  readOnboardingMatter,
  readProject,
  readRecords,
  recordOnboardingAiConnection,
  removeMemory,
  removePhoto,
  resolvePlace,
  restore,
  saveOnboardingChoices,
  searchChats,
  searchMemories,
  setProject,
  snapshot,
  syncProject,
  syncProjects,
  updateMemory,
  writeAgentRecord,
  writeAgentsMd,
  writeExploration,
  writeProjectView,
} from "@kaitu/core";
import { z } from "zod";
import type { Context, MutationQueue } from "./dsh.js";
import { archiveHandoffs, listFiles, writeFiles } from "./workspace-files.js";

const text = z.string().min(1);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
// 用户指定的本机导入原件可在工作区外；只有专用解析器读原件，写入仍经 Workspace。
function inputPath(ws: Workspace, path: string): string {
  return isAbsolute(path) ? path : ws.resolve(path);
}
const fields = z.record(z.string(), z.unknown());
const memory = z
  .object({
    type: z.enum(["preference", "fact", "context", "person", "decision"]),
    name: text,
    text,
    source: z.string().optional(),
    sensitive: z.boolean().optional(),
  })
  .strict();
const task = z
  .object({
    title: text,
    due: text.optional(),
    remind_at: text.optional(),
    project: text.optional(),
    notes: text.optional(),
    source: text.optional(),
  })
  .strict();
const link = z
  .object({ path: text, role: z.enum(["manuscript", "repo", "folder"]), include: z.array(text).optional() })
  .strict();
const next = z
  .object({
    id: text,
    title: text,
    status: z.enum(["todo", "proposed", "done", "skipped"]),
    priority: z.enum(["high", "normal", "low"]).optional(),
    due: text.nullable().optional(),
    estimate: text.nullable().optional(),
  })
  .passthrough();

export function registerWorkflowTools(ctx: Context, ws: Workspace, queue: MutationQueue) {
  function register<T extends z.ZodType>(
    name: string,
    description: string,
    schema: T,
    run: (input: z.infer<T>) => unknown | Promise<unknown>,
  ) {
    ctx.tools.register({
      name,
      description,
      parameters: { ...z.toJSONSchema(schema), type: "object" } as Record<string, unknown>,
      output: {
        schema: { type: "object", additionalProperties: true },
        render: (_args, value) => [{ type: "text", text: JSON.stringify(value) }],
      },
      execute: (args, exec) =>
        queue(async () => {
          try {
            exec.signal.throwIfAborted();
            recordOnboardingAiConnection(ws, "DSH");
            return { ok: true, result: await run(schema.parse(args)) };
          } catch (error) {
            return { ok: false, error: (error as Error).message };
          }
        }),
    });
  }
  register(
    "kaitu_onboarding",
    "首次使用：保存原文后的整理草稿、内容与清单、选择和记忆预览。草稿只进待核对，用户采纳才生成待办。",
    z.discriminatedUnion("action", [
      z.object({ action: z.literal("matter-read"), source: text }).strict(),
      z
        .object({ action: z.literal("matter-draft"), source: text, draft: onboardingMatterSuggestionSchema })
        .strict(),
      z.object({ action: z.literal("status") }).strict(),
      z
        .object({
          action: z.literal("choose"),
          choices: z
            .object({
              seen: z.boolean().optional(),
              starts: z.array(z.enum(ONBOARDING.starts.map((item) => item.id))).optional(),
              skipped: z
                .array(
                  z.enum(["memory", "ai", "plan", ...ONBOARDING.sources.map((item) => item.id)] as const),
                )
                .optional(),
              memoryAi: z.enum(ONBOARDING.ais.map((item) => item.id)).optional(),
              aiChoice: z.enum(ONBOARDING.aiChoices.map((item) => item.id)).optional(),
            })
            .strict(),
        })
        .strict(),
      z
        .object({ action: z.literal("preview"), text, ai: z.enum(ONBOARDING.ais.map((item) => item.id)) })
        .strict(),
      z.object({ action: z.literal("confirm"), token: text, selected: z.array(text) }).strict(),
      z.object({ action: z.literal("cancel"), token: text }).strict(),
      z.object({ action: z.literal("setup-preview"), input: onboardingSetupSchema }).strict(),
      z.object({ action: z.literal("setup-confirm"), token: text }).strict(),
    ]),
    (input) => {
      switch (input.action) {
        case "matter-read":
          return readOnboardingMatter(ws, input.source);
        case "matter-draft":
          return draftOnboardingMatter(ws, input.source, input.draft);
        case "setup-preview":
          return previewOnboardingSetup(ws, input.input);
        case "setup-confirm":
          return confirmOnboardingSetup(ws, input.token);
        case "status":
          return onboardingStatus(ws);
        case "choose":
          return saveOnboardingChoices(ws, input.choices);
        case "preview":
          return previewOnboardingMemory(ws, input.text, input.ai);
        case "confirm":
          return confirmOnboardingMemory(ws, input.token, input.selected);
        case "cancel":
          cancelOnboardingPreview(ws, input.token);
          return { ok: true };
      }
    },
  );
  register("kaitu_exploration_read", "读取方向、依据、尝试与认识变化。", z.object({}).strict(), () =>
    readExploration(ws),
  );
  register(
    "kaitu_experience_imports",
    "读取足迹来源与导入状态，来源与批次控制由用户在界面处理。",
    z.object({}).strict(),
    () => readExperienceImports(ws),
  );
  register(
    "kaitu_exploration_write",
    "记录方向建议、尝试与结果。修改带预期版本；AI 不能替用户决定方向状态。",
    z.object({ command: explorationCommandSchema }).strict(),
    ({ command }) => writeExploration(ws, command, "agent"),
  );
  register(
    "kaitu_records",
    "查询或修订记录。日期按工作区时区；删除超过十条须确认。",
    z.discriminatedUnion("operation", [
      z
        .object({ operation: z.literal("list"), type: text, from: date.optional(), to: date.optional() })
        .strict(),
      z.object({ operation: z.literal("update"), type: text, id: text, fields }).strict(),
      z.object({ operation: z.literal("delete"), type: text, id: text }).strict(),
    ]),
    (input) =>
      input.operation === "list"
        ? readRecords(ws, input.type, input)
        : writeAgentRecord(
            ws,
            input.operation,
            input.type,
            "DeepSeek",
            input.operation === "update" ? input.fields : {},
            input.id,
          ),
  );
  register(
    "kaitu_restore",
    "用户选择历史版本并确认后恢复工作区或指定路径，恢复前自动保存当前改动。",
    z.object({ version: text, path: text.optional(), confirmed: z.boolean().default(false) }).strict(),
    ({ version, path, confirmed }) => {
      if (!confirmed) throw new Error("恢复版本须先获得用户确认");
      return restore(ws, version, { path });
    },
  );
  register(
    "kaitu_search_chats",
    "检索已导入的历史对话，返回来源路径。",
    z.object({ query: text, limit: z.number().int().min(1).max(100).optional() }).strict(),
    ({ query, limit }) => searchChats(ws, query, { limit }),
  );
  register(
    "kaitu_workspace",
    "读写开图文档、列目录、保存版本或归档交接。批量文件会一起校验；规则与目标须先确认。",
    z.discriminatedUnion("operation", [
      z.object({ operation: z.literal("read"), path: text }).strict(),
      z.object({ operation: z.literal("list"), path: z.string() }).strict(),
      z
        .object({
          operation: z.literal("write"),
          files: z.array(z.object({ path: text, content: z.string() }).strict()).min(1),
        })
        .strict(),
      z.object({ operation: z.literal("snapshot"), message: text }).strict(),
      z.object({ operation: z.literal("agents-md") }).strict(),
      z.object({ operation: z.literal("archive-handoffs"), files: z.array(text).min(1), date }).strict(),
    ]),
    async (input) => {
      switch (input.operation) {
        case "read":
          return { path: input.path, content: readAgentFile(ws, input.path) };
        case "list":
          return listFiles(ws, input.path);
        case "write":
          return writeFiles(ws, input.files, false);
        case "snapshot":
          return { version: await snapshot(ws, `DeepSeek：${input.message}`) };
        case "agents-md":
          writeAgentsMd(ws);
          return { version: await snapshot(ws, "DeepSeek 刷新了 Agent 入口") };
        case "archive-handoffs":
          return archiveHandoffs(ws, input.files, input.date);
      }
    },
  );
  register(
    "kaitu_memory",
    "记忆增删查与批量导入。import 先 dryRun，用户确认后再执行；敏感内容须用户明确要求。",
    z.discriminatedUnion("operation", [
      z.object({ operation: z.literal("list") }).strict(),
      z.object({ operation: z.literal("search"), query: text }).strict(),
      z.object({ operation: z.literal("add"), entry: memory }).strict(),
      z
        .object({
          operation: z.literal("update"),
          file: text,
          patch: memory.omit({ source: true }).partial(),
        })
        .strict(),
      z.object({ operation: z.literal("delete"), file: text }).strict(),
      z
        .object({
          operation: z.literal("import"),
          entries: z.array(memory),
          dryRun: z.boolean().default(true),
          confirmed: z.boolean().default(false),
        })
        .strict(),
    ]),
    (input) => {
      switch (input.operation) {
        case "list":
          return listMemories(ws);
        case "search":
          return searchMemories(ws, input.query);
        case "add":
          return addMemory(ws, input.entry, { by: "agent", actor: "DeepSeek" });
        case "update":
          return updateMemory(ws, input.file, input.patch, { actor: "DeepSeek" });
        case "delete":
          return removeMemory(ws, input.file, { actor: "DeepSeek" });
        case "import":
          if (!input.dryRun && !input.confirmed) throw new Error("批量导入须先预览并获得用户确认");
          return importMemories(ws, input.entries, { dryRun: input.dryRun, by: "agent", actor: "DeepSeek" });
      }
    },
  );
  register(
    "kaitu_tasks",
    "新建、查询、完成或取消待办。",
    z.discriminatedUnion("operation", [
      z
        .object({
          operation: z.literal("list"),
          status: z.enum(["open", "done", "cancelled", "all"]).optional(),
          dueBefore: text.optional(),
        })
        .strict(),
      z.object({ operation: z.literal("add"), task }).strict(),
      z.object({ operation: z.enum(["done", "cancel"]), id: text }).strict(),
    ]),
    (input) =>
      input.operation === "list"
        ? listTasks(ws, input)
        : input.operation === "add"
          ? addTask(ws, input.task, { by: "agent", actor: "DeepSeek" })
          : input.operation === "done"
            ? completeTask(ws, input.id, { by: "agent", actor: "DeepSeek" })
            : cancelTask(ws, input.id, { by: "agent", actor: "DeepSeek" }),
  );
  register(
    "kaitu_inbox",
    "读取待整理笔记、完成后归档，或立即处理稳定的收件箱文件。",
    z.discriminatedUnion("operation", [
      z.object({ operation: z.enum(["notes", "process"]) }).strict(),
      z.object({ operation: z.literal("done"), path: text }).strict(),
    ]),
    (input) =>
      input.operation === "notes"
        ? inboxNotes(ws)
        : input.operation === "done"
          ? inboxNoteDone(ws, input.path, "DeepSeek")
          : processInbox(ws),
  );
  register(
    "kaitu_import",
    "导入用户指定的本机健康、日历或 ChatGPT 文件，path 可为绝对路径。先 dryRun 预览数量，用户确认后相同参数执行。",
    z
      .object({
        source: z.enum(["apple-health", "nut-ai", "ics", "chatgpt-conversations"]),
        path: text,
        dryRun: z.boolean().default(true),
        confirmed: z.boolean().default(false),
        calendar: text.optional(),
        from: date.optional(),
        to: date.optional(),
      })
      .strict(),
    (input) => {
      if (!input.dryRun && !input.confirmed) throw new Error("导入须先预览并获得用户确认");
      const path = inputPath(ws, input.path);
      if (input.source === "ics")
        return importIcs(ws, path, {
          dryRun: input.dryRun,
          calendar: input.calendar,
          from: input.from,
          to: input.to,
        });
      if (input.source === "apple-health") return importAppleHealth(ws, path, { dryRun: input.dryRun });
      if (input.source === "nut-ai") return importNutAi(ws, path, { dryRun: input.dryRun });
      return importChatgptConversations(ws, path, { dryRun: input.dryRun });
    },
  );
  register(
    "kaitu_photos",
    "保存用户指定的本机体态照片原件、列出照片或删除照片及记录。path 可为绝对路径。",
    z.discriminatedUnion("operation", [
      z.object({ operation: z.literal("list") }).strict(),
      z
        .object({
          operation: z.literal("add"),
          path: text,
          pose: z.enum(["front", "side", "back", "other"]),
          ts: text.optional(),
          notes: text.optional(),
        })
        .strict(),
      z.object({ operation: z.literal("delete"), id: text }).strict(),
    ]),
    (input) =>
      input.operation === "list"
        ? readRecords(ws, "photo")
        : input.operation === "delete"
          ? removePhoto(ws, input.id, { by: "agent", actor: "DeepSeek" })
          : addPhoto(ws, inputPath(ws, input.path), { ...input, by: "agent" }),
  );
  register(
    "kaitu_life_map",
    "查询人生地图或按城市名检索离线地点候选。",
    z.object({ name: text.optional(), country: text.optional() }).strict(),
    ({ name, country }) => (name ? resolvePlace(name, country) : lifeMap(ws)),
  );
  register(
    "project_view_write",
    "写入项目自定义 view.json，按 schema 校验。",
    z.object({ slug: text, view: z.unknown() }).strict(),
    ({ slug, view }) => writeProjectView(ws, slug, view),
  );
  register(
    "kaitu_projects",
    "项目建档、链接、进度同步和文档读写。链接目录只读。",
    z.discriminatedUnion("operation", [
      z.object({ operation: z.literal("list") }).strict(),
      z
        .object({
          operation: z.literal("new"),
          title: text,
          kind: z.enum(["work", "personal"]),
        })
        .strict(),
      z.object({ operation: z.literal("show"), slug: text }).strict(),
      z.object({ operation: z.literal("sync"), slug: text.optional() }).strict(),
      z.object({ operation: z.literal("link"), slug: text, link }).strict(),
      z
        .object({
          operation: z.literal("set"),
          slug: text,
          patch: z
            .object({
              stage: z.enum(["idea", "active", "paused", "done"]).optional(),
              next: z.array(next).optional(),
              progress: z
                .object({ label: text, current: z.number(), target: z.number(), unit: text.optional() })
                .nullable()
                .optional(),
              blocked: z.array(z.unknown()).optional(),
            })
            .strict(),
        })
        .strict(),
      z.object({ operation: z.literal("log"), slug: text, text, date: date.optional() }).strict(),
      z.object({ operation: z.literal("project-read"), slug: text, path: text }).strict(),
      z
        .object({
          operation: z.literal("project-write"),
          slug: text,
          path: z.enum(["notes.md", "log.md"]),
          content: z.string(),
        })
        .strict(),
      z
        .object({
          operation: z.literal("linked-read"),
          slug: text,
          linkIndex: z.number().int().min(0),
          path: text,
        })
        .strict(),
    ]),
    async (input) => {
      switch (input.operation) {
        case "list":
          return listProjects(ws);
        case "new":
          return createProject(ws, input);
        case "show":
          return readProject(ws, input.slug);
        case "sync":
          return input.slug ? syncProject(ws, input.slug) : syncProjects(ws);
        case "link":
          return linkProject(ws, input.slug, input.link);
        case "set":
          return setProject(ws, input.slug, input.patch);
        case "log":
          return logProject(ws, input.slug, input.text, { date: input.date, by: "agent" });
        case "project-read": {
          if (!["STATUS.md", "notes.md", "log.md", "view.json"].includes(input.path))
            throw new Error("只读取项目状态、笔记、日志和视图");
          return { content: ws.readText(`${projectDirectory(ws, input.slug)}/${input.path}`) };
        }
        case "project-write": {
          ws.writeText(`${projectDirectory(ws, input.slug)}/${input.path}`, input.content, {
            internal: true,
          });
          return { version: await snapshot(ws, "DeepSeek 更新了项目文档") };
        }
        case "linked-read": {
          const item = readProject(ws, input.slug).data.links[input.linkIndex];
          if (!item) throw new Error("链接不存在");
          const root = realpathSync(
            item.path.startsWith("~/") ? join(homedir(), item.path.slice(2)) : item.path,
          );
          const path = realpathSync(resolve(root, input.path));
          const rel = relative(root, path);
          if (
            rel.startsWith("..") ||
            rel.split(/[\\/]/).some((part) => part.startsWith(".")) ||
            !/\.md$/i.test(path)
          )
            throw new Error("只读链接目录内 Markdown");
          return { content: readFileSync(path, "utf8") };
        }
      }
    },
  );
  register(
    "kaitu_drive",
    "查看同步状态；用户选择开启或关闭后迁移工作区。不会安装或授权云端服务。",
    z.discriminatedUnion("operation", [
      z.object({ operation: z.literal("status") }).strict(),
      z
        .object({ operation: z.literal("enable"), driveDir: text.optional(), confirmed: z.boolean() })
        .strict(),
      z.object({ operation: z.literal("disable"), to: text.optional(), confirmed: z.boolean() }).strict(),
    ]),
    (input) => {
      if (input.operation === "status") return driveStatus(ws);
      if (!input.confirmed) throw new Error("迁移工作区须先获得用户确认");
      return input.operation === "enable"
        ? enableDrive(ws, { driveDir: input.driveDir })
        : disableDrive(ws, { to: input.to });
    },
  );
}
