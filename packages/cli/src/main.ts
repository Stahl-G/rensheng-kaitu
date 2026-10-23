#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  type By,
  type FileImportSource,
  KaituError,
  type MemoryInput,
  type MemoryPatch,
  type OnboardingAi,
  type OnboardingChoices,
  type OnboardingMatterSuggestion,
  type OnboardingSetupInput,
  type Pose,
  type ProjectLink,
  type ProjectStatus,
  Workspace,
  addMemory,
  addPhoto,
  addRecord,
  addTask,
  agentReadingPack,
  bindGithub,
  cancelOnboardingPreview,
  cancelTask,
  completeTask,
  confirmOnboardingMemory,
  confirmOnboardingSetup,
  createProject,
  defaultRoot,
  deleteRecord,
  disableSync,
  doctor,
  draftOnboardingMatter,
  enableSync,
  fileImportSources,
  findRecordType,
  githubCliStatus,
  history,
  importMemoryFile,
  importSources,
  inboxNoteDone,
  inboxNotes,
  initWorkspace,
  installProjectMemory,
  linkProject,
  listInvestments,
  listLearning,
  listMemories,
  listProjects,
  listTasks,
  logProject,
  mcpToken,
  normalizeLocale,
  onboardingStatus,
  previewOnboardingMemory,
  previewOnboardingSetup,
  processInbox,
  projectMemoryContext,
  readLearning,
  readOnboardingMatter,
  readProject,
  readRecords,
  readStatus,
  recordReference,
  recordReferences,
  recordTypeSummary,
  reindexChats,
  removeMemory,
  removePhoto,
  renderRecordReference,
  resetOnboarding,
  restore,
  restoreWorkspaceBackup,
  runPhone,
  saveLearningCheckin,
  saveOnboardingChoices,
  saveProjectArchitecture,
  searchChats,
  searchMemories,
  setGithubToken,
  setProject,
  snapshot,
  startLearning,
  syncProject,
  syncProjects,
  syncStatus,
  syncWorkspaceBackup,
  updateMemory,
  updateRecord,
  upgradeWorkspace,
  validateWorkspace,
  workspaceBackupRequest,
  workspaceBackupStatus,
  writeAgentsMd,
} from "@kaitu/core";

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { channelsCommand, installShutdown } from "./channels.js";
import { dshCommand, installDsh } from "./dsh.js";
import { importFeishuFolder } from "./feishu.js";
import { startMcpHttp } from "./mcp/http.js";
import { createMcpServer } from "./mcp/server.js";
import { startUi } from "./ui/server.js";

const HELP = `开图 kaitu

用法：
  kaitu init [目录] [--timezone Asia/Shanghai] [--sample]   创建工作区（默认 ~/kaitu-ai-memory）
  kaitu sync enable icloud|drive|nutstore [--dir <路径>] [--name kaitu-ai-memory]  选择同步文件夹（nutstore 为坚果云）
  kaitu sync disable [--to <目录>] | status          搬回本机 / 查看存放位置
  kaitu drive enable [--drive-dir <路径>] [--name kaitu-ai-memory]  开启 Google Drive 同步
  kaitu drive disable [--to <目录>]                  搬回本机
  kaitu drive status                                查看同步状态
  kaitu inbox notes | done <路径>                    列出待整理笔记 / 整理后归档
  kaitu inbox process                               处理 Agent 与健康数据收件箱
  kaitu phone run [--as <名字>]                     处理手机收件箱并重写手机快照
  kaitu feishu import --folder <文件夹 token> [--cli <lark-cli 路径>]  把飞书文件夹里的云文档存成原文
  kaitu ui [--port 4870] [--no-open] [--channels]   打开工作台，可同时启动手机通道
  kaitu dsh [--install] [--no-automation]         把开图装进 DeepSeek Harness 桌面应用（不加则打印网页版启动命令；开图 App 已在用同一工作区时加 --no-automation）
  kaitu channels setup <telegram|feishu|qq|weixin>  配置手机通道
  kaitu channels pair <通道>                       生成本人配对码
  kaitu channels start [--only <通道>]             前台启动手机通道
  kaitu channels status                            查看配置、配对与进程状态
  kaitu upgrade [--dry-run]                         升级内置模板与技能
  kaitu doctor                                     检查工作区
  kaitu validate [路径]                            按 schema 校验
  kaitu agents-md                                  重新生成 AGENTS.md
  kaitu mcp [--http] [--port 4871] [--tools remote|all]  启动 MCP 服务
  kaitu mcp token [--rotate]                      查看或轮换 HTTP token
  kaitu onboarding status | reset                  查看引导 / 重置本机选择
  kaitu onboarding matter-read <source>            读取已保存原文
  kaitu onboarding matter-draft <source> --json '<草稿>'  保存待核对草稿
  kaitu onboarding choose --json '<选择对象>'        保存引导选择
  kaitu onboarding preview --file <文本> --source <ai>  预览粘贴记忆
  kaitu onboarding confirm <token> --json '{"selected":["line-1"]}'  确认所选候选
  kaitu onboarding setup-preview --json '<项目或关注方向>'  预览数据源设置
  kaitu onboarding setup-confirm <token>           确认数据源设置
  kaitu onboarding cancel <token>                  放弃预览
  kaitu status [--json-out]                         今天、模块进度与最近 7 天数据
  kaitu reading-pack [--locale zh-CN|en] [--json-out] 按本机 Agent 权限读取最新近况，不落盘
  kaitu investments [--json]
  kaitu learning list | read <主题>                 学习主题与下一步
  kaitu learning start --json '{"title":"…","source":{"title":"…","url":"…","text":"…"}}'  存一篇材料、开一个主题（已有就沿用）
  kaitu learning save --json '{"topic":"…","understanding":"…","questions":"…","next":"…","operationId":"…"}'  记下用户说出的理解
  kaitu project new --title <标题> [--slug <英文短名>] --kind work|learning|personal [--link <路径>[:manuscript|repo|folder]]...
  kaitu project list | show <slug> | log <slug> --text <内容>
  kaitu project memory [--from <代码目录>] [--project <slug>] [--install]
  kaitu project architecture <slug> --file <Archify 生成的 HTML>  交回架构图，显示在项目页
  kaitu backup status | auth-status | sync
  kaitu backup connect <owner/repo> [--create] [--via gh|token] [--text|--no-text] [--records|--no-records]
  kaitu backup restore <owner/repo> --to <新目录> [--via gh|token]
  kaitu project link <slug> <路径> [--role manuscript|repo|folder] [--include <glob>]...
  kaitu project github <slug> <url>
  kaitu project github-token [--clear]  从 stdin 读取 token，仅保存在本机
  kaitu project sync [<slug>]
  kaitu project set <slug> [--stage idea|active|paused|done] [--next-json <数组>]
  kaitu task add --title <标题> [--due <日期或时间>] [--remind-at <时间>] [--project <slug>]
  kaitu task list [--all]                          列出未完成待办（--all 含已完成 / 取消）
  kaitu task done <id> | cancel <id>               完成 / 取消待办
  kaitu photo add <图片> [--pose front|side|back|other] [--ts 时间] [--notes 说明]
  kaitu photo list                                 列出体态照片
  kaitu photo rm <id>                              删除体态照片
  kaitu record types                              列出全部记录类型
  kaitu record schema <类型>                      查看字段与示例
  kaitu record add <类型> --json '{...}'           写入一条记录
  kaitu record update <类型> <id> --json '{...}'   修改记录
  kaitu record rm <类型> <id>                      删除记录
  kaitu record list <类型> [--from 日期] [--to 日期]
  kaitu memory add --type <类型> --name <名称> --text <内容> [--source 路径] [--sensitive]
  kaitu memory update <文件名> [--type 类型] [--name 名称] [--text 内容] [--sensitive | --no-sensitive]
  kaitu memory rm <文件名>                          删除记忆
  kaitu memory list                                列出记忆
  kaitu memory import --file <候选.json> [--dry-run]  批量导入记忆
  kaitu memory search <词>                          搜索记忆
  kaitu import <${fileImportSources.join("|")}> <文件> [--dry-run]
                                                   日历另可加 [--calendar 名称] [--from 日期] [--to 日期]
  kaitu chats search <词> [--limit N]               搜索历史对话
  kaitu chats reindex                              重建对话索引
  kaitu history [路径] [--limit N]                 版本历史
  kaitu restore <版本> [路径]                      恢复到某个版本
  kaitu snapshot -m <说明>                         手动保存一个版本

通用选项：
  --dir <目录>     工作区位置（也可用环境变量 KAITU_DIR）
  --by <来源>      user | agent | import:<来源>，默认 agent
  --json-out       以 JSON 输出结果
`;

const options = {
  via: { type: "string" },
  create: { type: "boolean" },
  "backup-text": { type: "boolean" },
  "no-text": { type: "boolean" },
  records: { type: "boolean" },
  "no-records": { type: "boolean" },
  channels: { type: "boolean" },
  install: { type: "boolean" },
  "no-automation": { type: "boolean" },
  only: { type: "string" },
  title: { type: "string" },
  slug: { type: "string" },
  due: { type: "string" },
  "remind-at": { type: "string" },
  project: { type: "string" },
  investment: { type: "string" },
  all: { type: "boolean" },
  kind: { type: "string" },
  stage: { type: "string" },
  role: { type: "string" },
  date: { type: "string" },
  link: { type: "string", multiple: true },
  include: { type: "string", multiple: true },
  "next-json": { type: "string" },
  "drive-dir": { type: "string" },
  sample: { type: "boolean" },
  http: { type: "boolean" },
  rotate: { type: "boolean" },
  clear: { type: "boolean" },
  tools: { type: "string" },
  pose: { type: "string" },
  ts: { type: "string" },
  notes: { type: "string" },
  file: { type: "string" },
  port: { type: "string" },
  "no-open": { type: "boolean" },
  dir: { type: "string" },
  json: { type: "string" },
  "json-out": { type: "boolean" },
  locale: { type: "string" },
  by: { type: "string" },
  from: { type: "string" },
  to: { type: "string" },
  limit: { type: "string" },
  timezone: { type: "string" },
  message: { type: "string", short: "m" },
  "expected-revision": { type: "string" },
  type: { type: "string" },
  name: { type: "string" },
  text: { type: "string" },
  source: { type: "string" },
  sensitive: { type: "boolean" },
  "no-sensitive": { type: "boolean" },
  "dry-run": { type: "boolean" },
  calendar: { type: "string" },
  as: { type: "string" },
  folder: { type: "string" },
  cli: { type: "string" },
  help: { type: "boolean", short: "h" },
} as const;

type Values = ReturnType<typeof parseArgs<{ options: typeof options; allowPositionals: true }>>["values"];

function who(by: By): string {
  if (by === "user") return "你";
  if (by === "agent") return "Agent ";
  return `导入（${by.slice("import:".length)}）时`;
}

function parseBy(v: string | undefined): By {
  const by = v ?? "agent";
  if (by === "user" || by === "agent" || /^import:[a-z0-9-]+$/.test(by)) return by as By;
  throw new KaituError(`--by 只能是 user、agent 或 import:<来源>，收到 ${by}`, "BAD_ARGS");
}

function parseJson(v: string | undefined): Record<string, unknown> {
  if (!v) throw new KaituError("缺少 --json", "BAD_ARGS");
  let data: unknown;
  try {
    data = JSON.parse(v);
  } catch {
    throw new KaituError("--json 不是合法 JSON", "BAD_ARGS");
  }
  if (!data || typeof data !== "object" || Array.isArray(data))
    throw new KaituError("--json 必须是一个对象", "BAD_ARGS");
  return data as Record<string, unknown>;
}

function need(arg: string | undefined, name: string): string {
  if (!arg) throw new KaituError(`缺少参数：${name}`, "BAD_ARGS");
  return arg;
}

function out(values: Values, data: unknown, text: string): void {
  console.log(values["json-out"] ? JSON.stringify(data, null, 2) : text);
}

function workspace(values: Values, maintain = true, deferOverview = false): Workspace {
  const ws = new Workspace(values.dir ? resolve(values.dir) : defaultRoot(), { maintain, deferOverview });
  if (!ws.exists(".kaitu/config.json"))
    throw new KaituError(`${ws.root} 还不是开图工作区，先运行 kaitu init`, "NOT_INITIALIZED");
  return ws;
}

async function run(argv: string[]): Promise<number> {
  const inputArgs =
    argv[0] === "backup"
      ? argv.map((arg) => (arg === "--text" ? "--backup-text" : arg))
      : argv[0] === "investments"
        ? argv.map((arg) => (arg === "--json" ? "--json-out" : arg))
        : argv;
  const { values, positionals } = parseArgs({ args: inputArgs, options, allowPositionals: true });
  const [cmd, ...args] = positionals;
  if (!cmd || values.help) {
    console.log(HELP);
    return 0;
  }

  switch (cmd) {
    case "backup": {
      const action = args[0];
      const via = values.via ?? "gh";
      if (!["gh", "token"].includes(via)) throw new KaituError("--via 只能是 gh 或 token", "BAD_ARGS");
      // gh 查询与恢复不构造原工作区，也不创建默认绑定。
      const ws =
        action === "auth-status" || (action === "restore" && via === "gh") ? undefined : workspace(values);
      let result: unknown;
      if (action === "auth-status") result = await githubCliStatus();
      else if (action === "restore") {
        result = await restoreWorkspaceBackup(resolve(need(values.to, "--to")), ws, {
          repo: need(args[1], "owner/repo"),
          via,
        });
      } else if (!ws) throw new KaituError("需要开图工作区", "NOT_INITIALIZED");
      else if (action === "status") result = workspaceBackupStatus(ws);
      else if (action === "connect") {
        if (values.create && via !== "gh")
          throw new KaituError("建库使用已登录的 gh；token 方式请连接已有仓库", "BAD_ARGS");
        if ((values["backup-text"] && values["no-text"]) || (values.records && values["no-records"]))
          throw new KaituError("同一范围不能同时启用和关闭", "BAD_ARGS");
        result = await workspaceBackupRequest(ws, values.create ? "create" : "connect", {
          repo: need(args[1], "owner/repo"),
          via,
          text: values["no-text"] ? false : values["backup-text"],
          records: values["no-records"] ? false : values.records,
        });
        await syncWorkspaceBackup(ws);
        result = workspaceBackupStatus(ws);
      } else if (action === "sync") {
        await syncWorkspaceBackup(ws);
        result = workspaceBackupStatus(ws);
      } else
        throw new KaituError(
          "使用 backup status / connect <owner/repo> [--create] [--via gh|token] / sync",
          "BAD_ARGS",
        );
      if (result && typeof result === "object") {
        const { ghLogin: _login, ...safe } = result as Record<string, unknown>;
        if (typeof safe.error === "string" && safe.error) throw new KaituError(safe.error, "BACKUP_SYNC");
        console.log(JSON.stringify(safe, null, 2));
      }
      return 0;
    }
    case "dsh": {
      let ws = new Workspace(values.dir ?? defaultRoot());
      if (!values.install && !ws.exists(".kaitu/config.json")) {
        ws = await initWorkspace(ws.root, { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone });
      }
      console.log(values.install ? installDsh(ws, !values["no-automation"]) : dshCommand(ws));
      return 0;
    }
    case "channels": {
      await channelsCommand(workspace(values), args, values.only, values["json-out"]);
      return 0;
    }
    case "learning": {
      const ws = workspace(values);
      const [action, topic] = args;
      const input = () =>
        JSON.parse(values.file ? readFileSync(values.file, "utf8") : need(values.json, "--json"));
      const result =
        action === "list"
          ? listLearning(ws)
          : action === "read"
            ? readLearning(ws, need(topic, "主题"))
            : action === "start"
              ? await startLearning(ws, input())
              : action === "save"
                ? await saveLearningCheckin(ws, input())
                : null;
      if (!result) throw new KaituError("使用 learning list / read / start / save", "BAD_ARGS");
      console.log(JSON.stringify(result, null, 2));
      return 0;
    }
    case "investments": {
      const rows = listInvestments(workspace(values));
      console.log(
        values.json !== undefined || values["json-out"]
          ? JSON.stringify(rows, null, 2)
          : rows.map((r) => `${r.ref} · ${r.title} · ${r.domain} / ${r.form} / ${r.status}`).join("\n"),
      );
      return 0;
    }
    case "project": {
      const ws = workspace(values);
      const [action, slug, path] = args;
      let result: unknown;
      if (action === "new") {
        const links = (values.link ?? []).map((input) => {
          const match = /:(manuscript|repo|folder)$/.exec(input);
          return {
            path: match ? input.slice(0, match.index) : input,
            role: match?.[1] ?? "folder",
          } as ProjectLink;
        });
        result = await createProject(ws, {
          title: need(values.title, "--title"),
          kind: need(values.kind, "--kind") as ProjectStatus["kind"],
          links,
          slug: values.slug,
        });
      } else if (action === "memory") {
        result = await (values.install ? installProjectMemory : projectMemoryContext)(
          ws,
          values.from ?? process.cwd(),
          values.project,
        );
      } else if (action === "architecture")
        result = saveProjectArchitecture(ws, need(slug, "slug"), need(values.file, "--file"));
      else if (action === "list") result = listProjects(ws);
      else if (action === "show") result = readProject(ws, need(slug, "slug"));
      else if (action === "log")
        result = await logProject(ws, need(slug, "slug"), need(values.text, "--text"), {
          date: values.date,
          by: parseBy(values.by),
        });
      else if (action === "link")
        result = await linkProject(ws, need(slug, "slug"), {
          path: need(path, "路径"),
          role: (values.role ?? "folder") as ProjectLink["role"],
          include: values.include,
        });
      else if (action === "github-token") {
        if (slug || path) throw new KaituError("GitHub token 请通过 stdin 输入", "BAD_ARGS");
        let token = "";
        if (!values.clear) {
          process.stdin.setEncoding("utf8");
          for await (const chunk of process.stdin) token += chunk;
        }
        setGithubToken(ws, values.clear ? null : token);
        console.log("已保存");
        return 0;
      } else if (action === "github") result = await bindGithub(ws, need(slug, "slug"), need(path, "url"));
      else if (action === "sync") result = slug ? await syncProject(ws, slug) : await syncProjects(ws);
      else if (action === "set")
        result = await setProject(ws, need(slug, "slug"), {
          ...(values["next-json"] ? { next: JSON.parse(values["next-json"]) } : {}),
          ...(values.stage ? { stage: values.stage as ProjectStatus["stage"] } : {}),
        });
      else
        throw new KaituError(
          "使用 project new / list / show / log / memory / architecture / link / github / github-token / sync / set",
          "BAD_ARGS",
        );
      out(values, result, JSON.stringify(result, null, 2));
      return 0;
    }
    case "sync":
    case "drive": {
      const action = args[0];
      const ws = workspace(cmd === "sync" && action === "enable" ? { ...values, dir: undefined } : values);
      const mode = cmd === "drive" ? "drive" : args[1];
      if (action === "enable" && mode !== "icloud" && mode !== "drive" && mode !== "nutstore")
        throw new KaituError("使用 sync enable icloud|drive|nutstore", "BAD_ARGS");
      const result =
        action === "enable"
          ? await enableSync(ws, mode === "icloud" ? "icloud" : "drive", {
              dir: cmd === "drive" ? values["drive-dir"] : values.dir,
              name: values.name,
              ...(mode === "nutstore" ? { provider: "nutstore" as const } : {}),
            })
          : action === "disable"
            ? await disableSync(ws, { to: values.to })
            : action === "status"
              ? syncStatus(ws)
              : undefined;
      if (!result)
        throw new KaituError("使用 sync enable icloud|drive|nutstore / disable / status", "BAD_ARGS");
      out(
        values,
        result,
        `模式：${result.mode}（${result.provider}）\n工作区：${result.root}\n状态目录：${result.stateDir}\n上次处理收件箱：${result.lastInboxProcessed ?? "尚未处理"}${result.hint ? `\n${result.hint}` : ""}`,
      );
      return 0;
    }
    case "phone": {
      if (args[0] !== "run") throw new KaituError("使用 phone run", "BAD_ARGS");
      if (values["dry-run"]) throw new KaituError("phone run 已不支持 --dry-run，本次未执行", "BAD_ARGS");
      const name = values.as;
      if (name !== undefined && (!name.trim() || [...name].length > 32))
        throw new KaituError("--as 需要 1–32 个字的整理员名字", "BAD_ARGS");
      const result = await runPhone(
        workspace(values),
        name === undefined ? { kind: "computer" } : { kind: "agent", name, spec: 1 },
      );
      out(values, result, JSON.stringify(result, null, 2));
      return 0;
    }
    case "feishu": {
      if (args[0] !== "import" || !values.folder)
        throw new KaituError("使用 feishu import --folder <文件夹 token>", "BAD_ARGS");
      const result = await importFeishuFolder(workspace(values), values.folder, values.cli);
      out(
        values,
        result,
        `${result.documents} 篇云文档：新存 ${result.imported.length} 条原文，${result.unchanged} 篇没变。`,
      );
      return 0;
    }
    case "inbox": {
      const ws = workspace(values);
      if (args[0] === "notes") {
        const notes = inboxNotes(ws);
        out(
          values,
          notes,
          notes.map((note) => `${note.path}（${note.agent}）\n${note.content}`).join("\n\n") ||
            "没有待整理笔记",
        );
        return 0;
      }
      if (args[0] === "done") {
        const result = await inboxNoteDone(ws, need(args[1], "路径"));
        out(values, result, `已归档：${result.path}`);
        return 0;
      }
      if (args[0] !== "process") throw new KaituError("使用 inbox process / notes / done <路径>", "BAD_ARGS");
      const result = await processInbox(ws);
      out(
        values,
        result,
        `已处理 ${result.processed.length}，转为待整理笔记 ${result.notes.length}，待同步完成 ${result.pending.length}`,
      );
      return 0;
    }
    case "init": {
      const root = resolve(args[0] ?? values.dir ?? defaultRoot());
      const adopted = existsSync(join(root, "kaitu-backup.json"));
      const ws = await initWorkspace(root, { timeZone: values.timezone, sample: values.sample });
      out(
        values,
        { root: ws.root, adopted },
        adopted
          ? `已接管这个记忆仓库：${ws.root}\n只补了缺的文件，已有资料没动；AGENTS.md、OVERVIEW.md 换成开图维护的版本。运行 kaitu phone run 生成手机内容。`
          : `已创建开图工作区：${ws.root}\n下一步：在这个文件夹里打开 Codex，说「开始使用开图」。`,
      );
      return 0;
    }
    case "ui": {
      const ws = workspace(values, true, true);
      const ui = await startUi(ws, {
        port: values.port === undefined ? undefined : Number(values.port),
        open: !values["no-open"],
      });
      installShutdown(async () => {
        await ui.close();
      });
      console.log(`开图工作台：${ui.url}\n按 Ctrl+C 关闭。`);
      return 0;
    }
    case "mcp": {
      const ws = workspace(values);
      if (args[0] === "token") {
        console.log(mcpToken(ws, values.rotate));
        return 0;
      }
      if (args.length) throw new KaituError("未知 mcp 子命令", "BAD_ARGS");
      const tools = values.tools ?? (values.http ? "remote" : "all");
      if (tools !== "remote" && tools !== "all")
        throw new KaituError("--tools 只能是 remote 或 all", "BAD_ARGS");
      if (values.http) {
        const http = await startMcpHttp(ws, {
          port: values.port === undefined ? undefined : Number(values.port),
          tools,
        });
        console.error(`开图 MCP：${http.url}（${tools}）\n用 kaitu mcp token 查看 token。`);
        const stop = () => {
          void http.close().then(
            () => process.exit(0),
            () => process.exit(1),
          );
        };
        process.once("SIGINT", stop);
        process.once("SIGTERM", stop);
      } else {
        const server = createMcpServer(ws, tools);
        await server.connect(new StdioServerTransport());
        const stop = () => {
          void server.close().then(
            () => process.exit(0),
            () => process.exit(1),
          );
        };
        process.once("SIGINT", stop);
        process.once("SIGTERM", stop);
      }
      return 0;
    }
    case "upgrade": {
      const ws = new Workspace(values.dir ? resolve(values.dir) : defaultRoot(), { maintain: false });
      if (!ws.exists(".kaitu/config.json")) throw new KaituError("先运行 kaitu init", "NOT_INITIALIZED");
      const result = await upgradeWorkspace(ws, { dryRun: values["dry-run"] });
      const problems = result.checks?.filter((check) => !check.ok) ?? [];
      const lines = result.changes.length
        ? [`${values["dry-run"] ? "将升级" : "已升级"}到 ${result.templateVersion}：`, ...result.changes]
        : ["内置模板已是当前版本，没有改动。"];
      if (result.checks) {
        lines.push(`校验：${result.validation?.length ? "有问题" : "通过"}`);
        lines.push(`doctor：${problems.length ? "有问题" : "通过"}`);
        lines.push(...problems.map((check) => `${check.name} ${check.detail ?? ""}`));
      }
      out(values, result, lines.join("\n"));
      return problems.length || result.validation?.length ? 1 : 0;
    }
    case "doctor": {
      const ws = new Workspace(values.dir ? resolve(values.dir) : defaultRoot());
      const checks = await doctor(ws);
      const ok = checks.every((c) => c.ok);
      out(
        values,
        { ok, checks },
        `${checks.map((c) => `${c.ok ? "✓" : "✗"} ${c.name}${c.detail ? `\n    ${c.detail.replace(/\n/g, "\n    ")}` : ""}`).join("\n")}\n\n${ok ? "全部通过。" : "有问题需要处理。"}`,
      );
      return ok ? 0 : 1;
    }
    case "validate": {
      const ws = workspace(values, false);
      const issues = validateWorkspace(ws, args[0]);
      out(
        values,
        { ok: issues.length === 0, issues },
        issues.length === 0
          ? "校验通过。"
          : `${issues.map((i) => `${i.file}${i.line ? `:${i.line}` : ""}  ${i.message}`).join("\n")}\n\n共 ${issues.length} 处问题。`,
      );
      return issues.length === 0 ? 0 : 1;
    }
    case "reading-pack": {
      const pack = agentReadingPack(workspace(values, false), "local-mcp", normalizeLocale(values.locale));
      out(values, pack, pack.text);
      return 0;
    }
    case "agents-md": {
      const ws = workspace(values);
      writeAgentsMd(ws);
      await snapshot(ws, "重新生成了 AGENTS.md");
      out(values, { ok: true }, "已重新生成 AGENTS.md。");
      return 0;
    }
    case "onboarding": {
      const ws = workspace(values);
      let result: unknown;
      switch (args[0]) {
        case "matter-read":
          result = readOnboardingMatter(ws, need(args[1], "source"));
          break;
        case "matter-draft":
          result = await draftOnboardingMatter(
            ws,
            need(args[1], "source"),
            parseJson(values.json) as unknown as OnboardingMatterSuggestion,
          );
          break;
        case "status":
          result = onboardingStatus(ws);
          break;
        case "reset":
          result = resetOnboarding(ws);
          break;
        case "choose":
          result = await saveOnboardingChoices(ws, parseJson(values.json) as OnboardingChoices);
          break;
        case "setup-preview":
          result = previewOnboardingSetup(ws, parseJson(values.json) as OnboardingSetupInput);
          break;
        case "setup-confirm":
          result = await confirmOnboardingSetup(ws, need(args[1], "token"));
          break;
        case "preview":
          result = previewOnboardingMemory(
            ws,
            readFileSync(need(values.file, "--file"), "utf8"),
            need(values.source, "--source") as OnboardingAi,
          );
          break;
        case "confirm":
          result = await confirmOnboardingMemory(
            ws,
            need(args[1], "token"),
            parseJson(values.json).selected as string[],
          );
          break;
        case "cancel":
          cancelOnboardingPreview(ws, need(args[1], "token"));
          result = { ok: true };
          break;
        default:
          throw new KaituError(
            "用法：kaitu onboarding status|reset|choose|matter-read|matter-draft|preview|confirm|setup-preview|setup-confirm|cancel",
            "BAD_ARGS",
          );
      }
      console.log(JSON.stringify(result, null, 2));
      return 0;
    }
    case "status": {
      const result = readStatus(workspace(values));
      const recent = result.recent7;
      const moduleLines = result.modules.flatMap((module) => {
        const progress = module.progress;
        const summary = progress
          ? `${progress.current}/${progress.target} ${progress.unit ?? ""}`
          : "未设进度";
        return [
          `${module.module}：${summary}`,
          ...(module.next ?? []).map((item) => `  ${item.title}（${item.status}）`),
        ];
      });
      const recentSummary = [
        `最近 7 天：训练 ${recent.workouts} 次`,
        `平均睡眠 ${recent.averageSleepHours?.toFixed(1) ?? "—"} 小时`,
        `平均蛋白质 ${recent.averageProteinG?.toFixed(0) ?? "—"} g`,
      ].join("，");
      out(
        values,
        result,
        [
          `${result.today} · ${result.now.pending} 条日程建议待确认`,
          `${result.inboxNotes} 条待整理笔记`,
          ...result.now.blocks.map((b) => `${b.start ?? "待办"} ${b.title}（${b.status}）`),
          ...result.tasks.map((task) => {
            const tags = [
              task.overdue && "已过期",
              task.dueToday && "今天到期",
              task.remindToday && "今天提醒",
            ].filter(Boolean);
            return `${task.title}（${tags.join(" / ")}）`;
          }),
          ...moduleLines,
          "项目：",
          ...result.projects.flatMap((project) => [
            `${project.title}（${project.kind === "work" ? "工作" : project.kind === "learning" ? "学习" : "个人"} / ${project.stage}）：近 7 天字数变化 ${project.recent7.words ?? "—"}，${project.recent7.commits} 次提交`,
            ...project.next.map((item) => `  ${item.title}（${item.status}）`),
          ]),
          recentSummary,
          `最新体重：${recent.latestWeight ? `${recent.latestWeight.value} ${recent.latestWeight.unit}` : "—"}`,
          ...result.warnings,
        ].join("\n"),
      );
      return 0;
    }
    case "task": {
      const [action, id] = args;
      const ws = workspace(values);
      if (action === "list") {
        const tasks = listTasks(ws, { status: values.all ? "all" : "open" });
        out(
          values,
          tasks,
          tasks
            .map(
              (task) =>
                `${task.id} ${task.title}（${task.status}）${task.due ? ` 截止：${task.due}` : ""}${task.remind_at ? ` 提醒：${task.remind_at}` : ""}`,
            )
            .join("\n") || "（没有待办）",
        );
        return 0;
      }
      const by = parseBy(values.by);
      const options = { by, actor: who(by) };
      const result =
        action === "add"
          ? await addTask(
              ws,
              {
                title: need(values.title, "--title"),
                due: values.due,
                remind_at: values["remind-at"],
                project: values.project,
                investment: values.investment,
              },
              options,
            )
          : action === "done"
            ? await completeTask(ws, need(id, "id"), options)
            : action === "cancel"
              ? await cancelTask(ws, need(id, "id"), options)
              : undefined;
      if (!result) throw new KaituError("使用 task add / list / done / cancel", "BAD_ARGS");
      const actionLabel = action === "add" ? "记下" : action === "done" ? "完成" : "取消";
      out(values, result, `${who(by)}${actionLabel}了待办：${result.record.title}\nid: ${result.record.id}`);
      return 0;
    }
    case "photo": {
      const [sub, arg] = args;
      const ws = workspace(values);
      if (sub === "list") {
        const photos = readRecords(ws, "photo").reverse();
        out(values, photos, photos.map((r) => JSON.stringify(r)).join("\n") || "（没有照片）");
      } else if (sub === "add") {
        const result = await addPhoto(ws, need(arg, "图片"), {
          pose: (values.pose ?? "other") as Pose,
          ts: values.ts,
          notes: values.notes,
          by: parseBy(values.by),
        });
        out(values, result, `已添加体态照片：${result.record.id}`);
      } else if (sub === "rm") {
        const result = await removePhoto(ws, need(arg, "id"), { by: parseBy(values.by) });
        out(values, result, "已删除体态照片。");
      } else throw new KaituError("未知 photo 子命令", "BAD_ARGS");
      return 0;
    }
    case "record": {
      const [sub, type, id] = args;
      const ws = workspace(values);
      if (sub === "types") {
        out(values, recordReferences(ws), recordTypeSummary(ws));
        return 0;
      }
      const t = need(type, "类型");
      if (sub === "schema") {
        out(values, recordReference(ws, t), renderRecordReference(ws, t));
        return 0;
      }
      if (sub === "list") {
        const records = readRecords(ws, t, { from: values.from, to: values.to });
        out(values, records, records.map((r) => JSON.stringify(r)).join("\n") || "（没有记录）");
        return 0;
      }
      const by = parseBy(values.by);
      const ref = findRecordType(ws, t);
      const label = ref.def.label ?? t;
      let result: Awaited<ReturnType<typeof addRecord>>;
      let message: string;
      if (sub === "add") {
        result = addRecord(ws, t, parseJson(values.json), { by });
        message = `${who(by)}在${ref.module.def.name}模块记录了 1 条${label}`;
      } else if (sub === "update") {
        result = updateRecord(ws, t, need(id, "id"), parseJson(values.json), {
          by,
          expected_revision: values["expected-revision"] ? Number(values["expected-revision"]) : undefined,
        });
        message = `${who(by)}修改了${ref.module.def.name}模块的 1 条${label}`;
      } else if (sub === "rm") {
        result = deleteRecord(ws, t, need(id, "id"), {
          by,
          expected_revision: values["expected-revision"] ? Number(values["expected-revision"]) : undefined,
        });
        message = `${who(by)}删除了${ref.module.def.name}模块的 1 条${label}`;
      } else {
        throw new KaituError(`未知子命令：record ${sub ?? ""}`, "BAD_ARGS");
      }
      const version = await snapshot(ws, message);
      out(values, { ...result, version }, `${message}（${result.file}）\nid: ${result.record.id}`);
      return 0;
    }
    case "memory": {
      const [sub, arg] = args;
      const ws = workspace(values);
      if (sub === "import") {
        const result = await importMemoryFile(ws, need(values.file, "--file"), {
          dryRun: values["dry-run"],
          by: parseBy(values.by),
        });
        out(values, result, `${values["dry-run"] ? "预览" : "已导入"} ${result.entries.length} 条记忆。`);
        return 0;
      }
      if (sub === "list" || sub === "search") {
        const memories = sub === "list" ? listMemories(ws) : searchMemories(ws, need(arg, "词"));
        out(
          values,
          memories,
          memories.map((m) => `${m.file}  ${m.name} —— ${m.text}`).join("\n") || "（没有记忆）",
        );
        return 0;
      }
      if (values.sensitive && values["no-sensitive"]) {
        throw new KaituError("--sensitive 与 --no-sensitive 不能同时使用", "BAD_ARGS");
      }
      const opts = { by: values.by ? parseBy(values.by) : undefined };
      if (sub === "add") {
        const entry = await addMemory(
          ws,
          {
            type: need(values.type, "--type") as MemoryInput["type"],
            name: need(values.name, "--name"),
            text: need(values.text, "--text"),
            source: values.source,
            sensitive: values.sensitive,
          },
          opts,
        );
        out(values, entry, `已记住：${entry.name}（memory/${entry.file}）`);
      } else if (sub === "update") {
        const patch: MemoryPatch = {};
        if (values.type !== undefined) patch.type = values.type as MemoryInput["type"];
        if (values.name !== undefined) patch.name = values.name;
        if (values.text !== undefined) patch.text = values.text;
        if (values.sensitive !== undefined) patch.sensitive = values.sensitive;
        if (values["no-sensitive"]) patch.sensitive = false;
        const entry = await updateMemory(ws, need(arg, "文件名"), patch, opts);
        out(values, entry, `已更新记忆：${entry.name}（memory/${entry.file}）`);
      } else if (sub === "rm") {
        const entry = await removeMemory(ws, need(arg, "文件名"), opts);
        out(values, entry, `已删除记忆：${entry.name}`);
      } else {
        throw new KaituError(`未知子命令：memory ${sub ?? ""}`, "BAD_ARGS");
      }
      return 0;
    }
    case "import": {
      const [source, file] = args;
      if (!source || !Object.hasOwn(importSources, source))
        throw new KaituError(`未知导入来源：${source ?? ""}`, "BAD_ARGS");
      const result = await importSources[source as FileImportSource].run(
        workspace(values),
        need(file, "文件"),
        {
          dryRun: values["dry-run"],
          calendar: values.calendar,
          from: values.from,
          to: values.to,
        },
      );
      if ("types" in result) {
        const labels: Record<string, string> = {
          metric: "指标",
          sleep: "睡眠",
          activity: "活动",
          meal: "饮食",
          workout: "训练",
          event: "日程",
          symptom: "症状",
          mood: "心理状态",
          heart_notification: "心率通知",
          unsupported: "未映射数据",
          incomplete_bp: "不完整血压",
          meals_without_items: "待分析餐食",
          exercise_entries: "有氧热量记录",
        };
        const summary = Object.entries(result.types).map(
          ([type, counts]) =>
            `${labels[type]}：新增 ${counts.added}，更新 ${counts.updated}，删除 ${counts.deleted}，跳过 ${counts.skipped}`,
        );
        const ignored = Object.entries(result.ignored)
          .filter(([, count]) => count > 0)
          .map(([reason, count]) => `${labels[reason]} ${count} 条`);
        out(
          values,
          result,
          `${values["dry-run"] ? "预览" : "导入完成"}：\n${summary.join("\n") || "没有可导入记录"}${
            ignored.length ? `\n另跳过：${ignored.join("，")}` : ""
          }。`,
        );
        return 0;
      }
      const actions = { added: "新增", updated: "更新", skipped: "跳过" };
      out(
        values,
        result,
        `${values["dry-run"] ? "预览：将" : "已"}新增 ${result.added} 段，更新 ${result.updated} 段，跳过 ${result.skipped} 段。\n${result.entries
          .map((entry) => `${actions[entry.action]}：${entry.title}`)
          .join("\n")}`,
      );
      return 0;
    }
    case "chats": {
      const [sub, query] = args;
      const ws = workspace(values);
      if (sub === "reindex") {
        const count = reindexChats(ws);
        out(values, { count }, `已重建 ${count} 段对话的索引。`);
      } else if (sub === "search") {
        const results = searchChats(ws, need(query, "词"), {
          limit: values.limit === undefined ? undefined : Number(values.limit),
        });
        out(
          values,
          results,
          results.map((r) => `${r.id}  ${r.title}  ${r.date}\n${r.file}\n${r.snippet}`).join("\n\n") ||
            "（没有匹配的对话）",
        );
      } else {
        throw new KaituError(`未知子命令：chats ${sub ?? ""}`, "BAD_ARGS");
      }
      return 0;
    }
    case "history": {
      const ws = workspace(values);
      const limit = values.limit ? Number.parseInt(values.limit, 10) : 20;
      const versions = await history(ws, { path: args[0], limit });
      out(
        values,
        versions,
        versions
          .map((v) => `${v.short}  ${v.time.replace("T", " ").slice(0, 19)}  ${v.message}`)
          .join("\n") || "（还没有版本）",
      );
      return 0;
    }
    case "restore": {
      const ws = workspace(values);
      const r = await restore(ws, need(args[0], "版本"), { path: args[1] });
      out(
        values,
        r,
        r.changed === 0
          ? "内容已经是这个版本，没有改动。"
          : `已恢复，改动了 ${r.changed} 个文件。可以用 kaitu history 查看，恢复本身也能撤销。`,
      );
      return 0;
    }
    case "snapshot": {
      const ws = workspace(values);
      const oid = await snapshot(ws, need(values.message, "-m <说明>"));
      out(values, { oid }, oid ? `已保存版本 ${oid.slice(0, 7)}。` : "没有改动，不需要保存。");
      return 0;
    }
    default:
      throw new KaituError(`未知命令：${cmd}\n\n${HELP}`, "BAD_ARGS");
  }
}

run(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (e: unknown) => {
    const err = e as Error & { code?: string };
    console.error(
      e instanceof KaituError || err.code === "ERR_PARSE_ARGS_UNKNOWN_OPTION" ? err.message : err.stack,
    );
    process.exitCode = 2;
  },
);
