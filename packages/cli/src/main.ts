#!/usr/bin/env node
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  type By,
  KaituError,
  type MemoryInput,
  type MemoryPatch,
  Workspace,
  addMemory,
  addRecord,
  defaultRoot,
  deleteRecord,
  doctor,
  findRecordType,
  history,
  importAppleHealth,
  importChatgptConversations,
  importIcs,
  importNutAi,
  initWorkspace,
  listMemories,
  readRecords,
  reindexChats,
  removeMemory,
  restore,
  searchChats,
  searchMemories,
  snapshot,
  updateMemory,
  updateRecord,
  validateWorkspace,
  writeAgentsMd,
} from "@kaitu/core";

const HELP = `开图 kaitu

用法：
  kaitu init [目录] [--timezone Asia/Shanghai]   创建工作区（默认 ~/kaitu）
  kaitu doctor                                     检查工作区
  kaitu validate [路径]                            按 schema 校验
  kaitu agents-md                                  重新生成 AGENTS.md
  kaitu record add <类型> --json '{...}'           写入一条记录
  kaitu record update <类型> <id> --json '{...}'   修改记录
  kaitu record rm <类型> <id>                      删除记录
  kaitu record list <类型> [--from 日期] [--to 日期]
  kaitu memory add --type <类型> --name <名称> --text <内容> [--source 路径] [--sensitive]
  kaitu memory update <文件名> [--type 类型] [--name 名称] [--text 内容] [--sensitive | --no-sensitive]
  kaitu memory rm <文件名>                          删除记忆
  kaitu memory list                                列出记忆
  kaitu memory search <词>                          搜索记忆
  kaitu import chatgpt-conversations <文件> [--dry-run]
  kaitu import apple-health <export.zip|export.xml> [--dry-run]
  kaitu import ics <文件.ics> [--calendar 名称] [--from 日期] [--to 日期] [--dry-run]
  kaitu import nut-ai <backup.json> [--dry-run]
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
  dir: { type: "string" },
  json: { type: "string" },
  "json-out": { type: "boolean" },
  by: { type: "string" },
  from: { type: "string" },
  to: { type: "string" },
  limit: { type: "string" },
  timezone: { type: "string" },
  message: { type: "string", short: "m" },
  type: { type: "string" },
  name: { type: "string" },
  text: { type: "string" },
  source: { type: "string" },
  sensitive: { type: "boolean" },
  "no-sensitive": { type: "boolean" },
  "dry-run": { type: "boolean" },
  calendar: { type: "string" },
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

function workspace(values: Values): Workspace {
  const ws = new Workspace(values.dir ? resolve(values.dir) : defaultRoot());
  if (!ws.exists(".kaitu/config.json"))
    throw new KaituError(`${ws.root} 还不是开图工作区，先运行 kaitu init`, "NOT_INITIALIZED");
  return ws;
}

async function run(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({ args: argv, options, allowPositionals: true });
  const [cmd, ...args] = positionals;
  if (!cmd || values.help) {
    console.log(HELP);
    return 0;
  }

  switch (cmd) {
    case "init": {
      const root = resolve(args[0] ?? values.dir ?? defaultRoot());
      const ws = await initWorkspace(root, { timeZone: values.timezone });
      out(
        values,
        { root: ws.root },
        `已创建开图工作区：${ws.root}\n下一步：在这个文件夹里打开 Codex，说「开始使用开图」。`,
      );
      return 0;
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
      const ws = workspace(values);
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
    case "agents-md": {
      const ws = workspace(values);
      writeAgentsMd(ws);
      await snapshot(ws, "重新生成了 AGENTS.md");
      out(values, { ok: true }, "已重新生成 AGENTS.md。");
      return 0;
    }
    case "record": {
      const [sub, type, id] = args;
      const ws = workspace(values);
      const t = need(type, "类型");
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
        result = updateRecord(ws, t, need(id, "id"), parseJson(values.json), { by });
        message = `${who(by)}修改了${ref.module.def.name}模块的 1 条${label}`;
      } else if (sub === "rm") {
        result = deleteRecord(ws, t, need(id, "id"), { by });
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
      if (source === "apple-health" || source === "ics" || source === "nut-ai") {
        const ws = workspace(values);
        const input = need(file, "文件");
        const opts = { dryRun: values["dry-run"] };
        const result =
          source === "apple-health"
            ? await importAppleHealth(ws, input, opts)
            : source === "nut-ai"
              ? await importNutAi(ws, input, opts)
              : await importIcs(ws, input, {
                  ...opts,
                  calendar: values.calendar,
                  from: values.from,
                  to: values.to,
                });
        const labels: Record<string, string> = {
          metric: "指标",
          sleep: "睡眠",
          activity: "活动",
          meal: "饮食",
          event: "日程",
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
      if (source !== "chatgpt-conversations") {
        throw new KaituError(`未知导入来源：${source ?? ""}`, "BAD_ARGS");
      }
      const result = await importChatgptConversations(workspace(values), need(file, "文件"), {
        dryRun: values["dry-run"],
      });
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
