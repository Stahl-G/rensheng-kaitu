import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { AI_NETWORK_RULES } from "./ai-instructions.js";
import { templateDir } from "./assets.js";
import { parseFrontmatter } from "./frontmatter.js";
import { INBOX_FORMATS } from "./inbox-formats.js";
import { renderRecordReference } from "./record-reference.js";
import type { Workspace } from "./workspace.js";

const USER_SECTION = "<!-- 以下内容由你自己维护，重新生成时保留 -->";
const routes = [
  {
    request: "记一顿饭",
    use: "log-meal",
    read: "无需先读资料；字段不确定才查 meal",
    done: "写入回执有 id；云盘投递仍待处理",
    skill: "log-meal",
    match: /log-meal|早餐|午餐|晚餐|加餐|吃了|记.*(?:饭|餐|饮食)|breakfast|lunch|dinner|log.*meal/i,
  },
  {
    request: "记训练",
    use: "log-workout",
    read: "上次同动作一条",
    done: "回执有 id，并给有依据的下次建议",
    skill: "log-workout",
    match: /log-workout|训练|深蹲|卧推|硬拉|跑步|骑行|游泳|workout|log.*exercise/i,
  },
  {
    request: "加个待办",
    use: "kaitu task add --title 事项 --by agent",
    read: "无需先读资料",
    done: "回执有 id",
    skill: undefined,
    match: /待办|todo|to-do|task add/i,
  },
  {
    request: "整理项目今天的进展",
    use: "project-review",
    read: "该项目 STATUS、日志与 view.json；有 gh 时读当天 PR 和 issue",
    done: "日志有今天的日报，view.json 的 daily- 积木已更新并通过校验",
    skill: "project-review",
    match: /项目日报|项目.*今天|今天.*项目|project.*(?:review|today)|daily.*project/i,
  },
  {
    request: "项目推进了",
    use: "project",
    read: "该项目 STATUS.md，必要时读 log.md",
    done: "STATUS/日志已更新，回执有版本",
    skill: "project",
    match: /项目|project/i,
  },
  {
    request: "存一篇文章去学 / 接着学",
    use: "learn-topic；有命令行时 kaitu learning start / save",
    read: "该主题 STATUS 与 notes；新主题只读用户给的材料",
    done: "回执有 topic；记下的理解只来自用户原话",
    skill: "learn-topic",
    match: /学习|接着学|学一下|这篇文章|存.*文章|learn|article/i,
  },
  {
    request: "帮我做个决定",
    use: "decision",
    read: "decisions/ 下同名档案与相关记忆",
    done: "analysis.md 与 STATUS 已写；用户选定前保持待决定",
    skill: "decision",
    match: /做.*决定|决策|拿主意|decide|decision/i,
  },
  {
    request: "记住一件事",
    use: "kaitu memory add --type preference --name 名称 --text 内容",
    read: "无需先读资料",
    done: "回执有 file 后说「已记住」",
    skill: undefined,
    match: /记住|偏好|remember|preference/i,
  },
  {
    request: "设目标或改规则",
    use: "先提具体改动，确认后写入",
    read: "goals.json 或 rules.md，必要时读相关状态",
    done: "用户确认、保存回执与读回一致",
    skill: undefined,
    match: /目标|规则|goal|rule/i,
  },
];

function skills() {
  const dir = join(templateDir(), ".agents/skills");
  return readdirSync(dir)
    .sort()
    .map((name) => ({ name, text: readFileSync(join(dir, name, "SKILL.md"), "utf8") }));
}

/** 文件入口与内置 Agent 注入共用；不附带用户档案或全量格式。 */
export function workspaceAgentGuide(): string {
  return `# 开图资料工作区

这里是用户的个人资料。时区在 me/rules.md 的 timezone；时间用带偏移的 ISO 8601，日期按用户时区切分。

## 按当前任务做

| 用户说 | 用 | 最多读什么 | 做完的标志 |
|---|---|---|---|
${routes.map((route) => `| ${route.request} | ${route.use} | ${route.read} | ${route.done} |`).join("\n")}

只加载这次任务的一个相关 Skill：正本在 .agents/skills/<技能>/SKILL.md，.claude/skills/ 是副本。缺口只问一个会改变下一步的问题，已知信息直接用。了解现状才读 OVERVIEW.md 的相关摘要，需要背景时再读档案与相关记忆；整理员按 ORGANIZER.md 执行。
字段不确定时用 kaitu record schema <类型>（DSH 用 kaitu_status 带 type；MCP 用 record_types）。类型从相关 module.json.records 或 kaitu record types 查。只能读写云盘、没有命令时，格式不确定才读 RECORDS.md 的相关类型，投递边界见 AGENT-README.md；不安装 CLI 来绕路。

媒体引用写成 media:年/月/原始文件名，根目录由每台设备按工作区单独选择（默认工作区旁的 kaitu-media）；只按用户本机绑定解析，未绑定或未下载时保留文字和引用，不把媒体放进工作区、版本库或资料包，不凭原片保留的位置字段推定允许外发。人工说明只写同名 XMP 的 dc:description／Iptc4xmpExt:PersonInImage，没写说明或标人不新建 XMP。

## 边界

1. 只写工作区内；程序状态、版本库和密钥由程序管理。记录用专用工具写入，保留 ID 和追加修订，不直接改数据 JSONL；项目链接目录只读。
2. 改目标/规则/长期投入、外部日历、批量导入、删除模块或超过 10 条记录、自动任务、记忆归档/替换先确认。AI 待办提议保持 proposed，不自行填 by/user、source、confirmed 或 status 绕过；用户在界面采纳后才进入今天。其他 AI 提议保持 suggested/pending，用户采纳才生效。批量导入先预览；项目可见性变更须用户明确选择，云端旧副本由用户清理。
3. 日常记录可直接保存、可撤销；自动记忆保存后告知，用户要求暂停时停止。敏感记忆须用户明确要求并标 sensitive；归档/替换只提候选，确认前保留旧条，文件名稳定，保留原正文与来源。健康只做记录、趋势和提醒。activity 的 source_exported_at 由健康导入器保存来源导出时间，手工记录不填写或修改。
4. 普通文档修改后校验相关路径并保存版本；对用户说版本、历史、恢复。回执有 id/file 才确认数据已保存，有版本才确认版本已保存；只有结果不确定或用户要求核对时才读回。云盘新建文件只说「已投递」，note 只保存原文，不能当餐食入账。
5. 摘要可能不完整。CLOUD_UNAVAILABLE 表示未下载或暂不可读，不是文件不存在；说明缺口后停止读取。其他错误只用原工具重试一次，第二次失败就报告缺口，不换工具/别名/整目录扫描循环读取。写入结果未知时核对原回执或复用原幂等标识，不另建记录重试。
6. ${AI_NETWORK_RULES}

工作区不在默认位置时加 --dir <绝对路径> 或设置 KAITU_DIR。工具与文件的实际权限继续生效；凭据留在本机，不写进资料或日志。
`;
}

/** 只为明确匹配的一个常用任务补齐现有技能，歧义交给运行时的技能发现。 */
export function workspaceTaskSkill(request: string): { name: string; text: string } | undefined {
  const matches = routes.filter((route) => route.match.test(request));
  if (matches.length !== 1 || !matches[0]?.skill) return;
  const name = matches[0].skill;
  return {
    name,
    text: parseFrontmatter(
      readFileSync(join(templateDir(), ".agents/skills", name, "SKILL.md"), "utf8"),
    ).body.trim(),
  };
}

/** 分隔线以下是用户追加的内容，重新生成时原样保留。 */
export function renderAgentsMd(ws: Workspace): string {
  const old = ws.exists("AGENTS.md") ? ws.readText("AGENTS.md") : "";
  const index = old.indexOf(USER_SECTION);
  const userPart = index >= 0 ? old.slice(index + USER_SECTION.length).replace(/^\n+/, "") : "";
  return `${workspaceAgentGuide()}\n${USER_SECTION}\n${userPart}`;
}

export function writeAgentsMd(ws: Workspace): void {
  for (const skill of skills()) {
    for (const base of [".agents", ".claude"])
      ws.writeText(`${base}/skills/${skill.name}/SKILL.md`, skill.text);
  }
  ws.writeText(
    "RECORDS.md",
    `# 按需查询的记录格式\n\n按相关类型标题取字段与示例；这些参考由实际 schema 生成。修改模块或 schema 后运行 kaitu agents-md 刷新。\n\n${INBOX_FORMATS}\n\n${renderRecordReference(ws)}\n`,
  );
  if (ws.exists("feed/module.json"))
    ws.writeText("feed/COLLECT.md", readFileSync(join(templateDir(), "feed/COLLECT.md"), "utf8"));
  ws.writeText("AGENTS.md", renderAgentsMd(ws));
}
