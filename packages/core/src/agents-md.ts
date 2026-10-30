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
    request: "自然说出事实、偏好或决定",
    use: "import-chatgpt-memory；memory_capture（DSH：kaitu_memory_capture）",
    read: "相关记忆；明确纠正时读原条",
    done: "回执含落盘回读 entry；个人档案可单条撤销",
    skill: "import-chatgpt-memory",
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

## 先读这几个

先读 USER.md（程序生成的一页画像，核对生成时间）→ NOW.md（核对计划日期）；其余按当前任务取。
USER.md 的领域入口与 phone/library.json 的 navigation 同源；后者只供支持 version=1 的读取端查找原文，不把人用 items 直接注入 AI。
USER.md 缺失或写着「暂不可用」时，改读 me/goals.json、me/profile.md 与 memory/MEMORY.md，再取必要的非敏感、未归档记忆；不把缺失当作没有资料。
有 reading_pack 工具或支持的 kaitu reading-pack 命令时，按当前连接权限现取近况；没有时直接读正本。共享画像不含财务，财务只经有权限的工具取得。
没有工具时，只往 inbox/agents/ 新建唯一命名的文件。普通原文用 <agent>-<唯一时间>.note.md；改画像、目标、规则或替换记忆都写成提议，等待用户处理，不直接改正本。
三条边界：① 不改 USER.md、生成指南或数据 JSONL；② 不把 AI 建议标成用户确认，纠正记忆用自动记录入口关联原条；③ 不写工作区之外、程序状态、版本库或密钥。

目录地图（只读本次需要的）：
- me/：档案、目标、规则与确认过的阶段；NOW.md：最近计划。
- memory/：记忆索引与条目；以索引/列表为当前状态；有 ended 或被其他活跃条目的 replaces 关联的是旧事实，不当作当前画像。
- 手机自然记忆仅在 today.mobile.actions 声明 capture_memory 时投递，沿用相同来源/幂等/纠正规则；以回执 memory.file/status 核对共享库结果，未支持时不得声称已入共享库。
- projects/、learning/、decisions/：项目、学习与决定的状态及日志。
- explore/、health/、feed/：方向与足迹、健康、资讯，按模块说明取。
- sleep 可选 stages 只保存原始阶段 start/end/stage；缺失阶段不猜造，awake/in_bed 不计睡眠总时长，原始重叠按睡眠区间并集计一次。
- inbox/agents/：新投递；inbox/notes/：待处理原文；handoffs/：接续任务的交接。

## 按当前任务做

| 用户说 | 用 | 最多读什么 | 做完的标志 |
|---|---|---|---|
${routes.map((route) => `| ${route.request} | ${route.use} | ${route.read} | ${route.done} |`).join("\n")}

只加载这次任务的一个相关 Skill：正本在 .agents/skills/<技能>/SKILL.md，.claude/skills/ 是副本。缺口只问一个会改变下一步的问题，已知信息直接用。需要更多现状才读 OVERVIEW.md 的相关摘要；整理员按 ORGANIZER.md 执行。
字段不确定时用 kaitu record schema <类型>（DSH 用 kaitu_status 带 type；MCP 用 record_types）。类型从相关 module.json.records 或 kaitu record types 查。只能读写云盘、没有命令时，格式不确定才读 RECORDS.md 的相关类型，投递边界见 AGENT-README.md；不安装 CLI 来绕路。

媒体引用写成 media:年/月/原始文件名，根目录由每台设备按工作区单独选择（默认工作区旁的 kaitu-media）；只按用户本机绑定解析，未绑定或未下载时保留文字和引用，不把媒体放进工作区、版本库或资料包，不凭原片保留的位置字段推定允许外发。人工说明只写同名 XMP 的 dc:description／Iptc4xmpExt:PersonInImage，没写说明或标人不新建 XMP。

## 边界

1. 只写工作区内；程序状态、版本库和密钥由程序管理。记录用专用工具写入，保留 ID 和追加修订，不直接改数据 JSONL；项目链接目录只读。
2. 改目标/规则/长期投入、外部日历、批量导入、删除模块或超过 10 条记录、自动任务先确认。普通个人记忆的自动保存、明确纠正与单条可恢复撤销无需重复确认。AI 待办提议保持 proposed，不自行填 by/user、source、confirmed 或 status 绕过；用户在界面采纳后才进入今天。其他 AI 提议保持 suggested/pending，用户采纳才生效。批量导入先预览；项目可见性变更须用户明确选择，云端旧副本由用户清理。
3. 日常个人事实、偏好、决定默认自动记录，不逐条确认；使用 memory_capture（DSH：kaitu_memory_capture），按 import-chatgpt-memory 技能保留来源、时间与原话。AI估算/建议标 origin 和 uncertainty，不升级为用户承诺；临时、引用、假设不作长期事实。纠正用 replaces/expected 追加关联原条；撤销在个人档案单条归档，保留历史。用户要求暂停时停止；敏感个人陈述自动标 sensitive，不进入共享资料包。健康只做记录、趋势和提醒。activity 的 source_exported_at 由健康导入器保存来源导出时间，手工记录不填写或修改。
4. 普通文档修改后校验相关路径并保存版本；对用户说版本、历史、恢复。回执有 id/file 才确认数据已保存，有版本才确认版本已保存；自动记忆由写入工具回读；其他记录只有结果不确定或用户要求核对时才读回。云盘新建文件只说「已投递」，note 只保存原文，不能当餐食入账。
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
