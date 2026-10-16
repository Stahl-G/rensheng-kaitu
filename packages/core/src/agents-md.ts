import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { templateDir } from "./assets.js";
import { parseFrontmatter } from "./frontmatter.js";
import { listModules } from "./modules.js";
import { ONBOARDING } from "./onboarding.js";
import { renderRecordReference } from "./record-reference.js";
import type { Workspace } from "./workspace.js";

const USER_SECTION = "<!-- 以下内容由你自己维护，重新生成时保留 -->";

function skills() {
  const dir = join(templateDir(), ".agents/skills");
  return readdirSync(dir)
    .sort()
    .map((name) => {
      const text = readFileSync(join(dir, name, "SKILL.md"), "utf8");
      const { data } = parseFrontmatter<{ name: string; description: string }>(text);
      return { name, text, description: data.description };
    });
}

/** 分隔线以下是用户追加的内容，重新生成时原样保留。 */
export function renderAgentsMd(ws: Workspace): string {
  const modules = listModules(ws);
  const moduleRows = modules
    .map((m) => {
      const types = Object.entries(m.def.records ?? {})
        .map(([t, d]) => `\`${t}\`${d.label ? `（${d.label}）` : ""}`)
        .join("、");
      const vis = m.def.visibility === "nav" ? "导航页面" : "Agent 管理";
      return `| \`${m.dir}/\` | ${m.def.name} | ${m.def.description ?? ""} | ${types || "—"} | ${vis} |`;
    })
    .join("\n");
  const instructions = modules
    .filter((m) => m.def.agent?.instructions)
    .map((m) => `- **${m.def.name}**：${m.def.agent?.instructions}`)
    .join("\n");

  let userPart = "";
  if (ws.exists("AGENTS.md")) {
    const old = ws.readText("AGENTS.md");
    const i = old.indexOf(USER_SECTION);
    if (i >= 0) userPart = old.slice(i + USER_SECTION.length).replace(/^\n+/, "");
  }

  return `# 开图工作区（给 Agent 的入口说明）

这个文件夹是用户的个人生活数据。读完本文件，你就知道用户是谁、在做什么、下一步该做什么。

本文件由 \`kaitu agents-md\` 生成；要补充说明，写在文末分隔线以下。

## 1. 用户是谁

- 档案：\`me/profile.md\`
- 记忆索引：\`memory/MEMORY.md\`（每条一行，详情在同目录的单独文件里）

## 2. 进入后的读取顺序

1. \`me/profile.md\`
2. \`me/rules.md\`（作息与排程约束，frontmatter 是机器可读的规则）
3. \`NOW.md\`（今天的计划）
4. 各模块的 \`STATUS.md\`（进度与下一步）
5. 需要细节时再读各模块的 \`data/\`

## 3. 模块

| 路径 | 名称 | 用途 | 记录类型 | 显示 |
|---|---|---|---|---|
${moduleRows}

${instructions}

## 4. 写入规则

- 只写本文件夹之内；不要改 \`.kaitu/\`（程序状态与密钥）。
- 记录类数据（训练、饮食、睡眠、指标、日程……）**只通过命令写入**，不要直接编辑 JSONL：
  - 新增：\`kaitu record add <类型> --json '{...}'\`（自动生成 id、ts、by 并校验）
  - 修改：\`kaitu record update <类型> <id> --json '{...}'\`
  - 删除：\`kaitu record rm <类型> <id>\`
  - 查询：\`kaitu record list <类型> [--from YYYY-MM-DD] [--to YYYY-MM-DD]\`
- 财务流水可选保留 source_status、source_direction、account_last4；退款关联原交易号。银行通知只进入本机待核对候选，不直接记入流水。
- 健康症状写 \`symptom\`（普通症状填 severity，食欲变化只填 appetite_change）；心理状态写 \`mood\`（七级 valence）；设备心率通知写 \`heart_notification\`，不写日历 event。
- 地点经历用 MCP \`experience_add\` 或 dsh \`kaitu_add_experience\`，只给城市名和国家代码；计划用 planned，坐标由城市表提供。
- 方向与实验通过 MCP \`exploration_read\` / \`exploration_write\`（dsh 加 kaitu_ 前缀），修改带预期版本；AI 提议先标 suggested，用户采纳后才是 active。行动完成不自动支持假设。
- 待办用 \`kaitu task add --title "事项" [--due 日期或时间] [--remind-at 时间] [--project slug]\`，新建为 open。
- \`kaitu task list [--all]\` 查询，\`kaitu task done <id>\` 完成，\`kaitu task cancel <id>\` 取消；状态变化追加修订并保存版本。
- 时间一律 ISO 8601 并带时区偏移；日期按用户时区（\`me/rules.md\` 的 \`timezone\`）切分。
- 项目内容在链接的文件夹里，只读；用 \`kaitu project\` 管理档案与同步进度。仅本机项目不写进共享计划、复盘或记忆。
- 体态照片用 \`kaitu photo add <图片> --pose front|side|back|other\`；原件在 \`health/files/photos/\`。
- 照片查询用 \`kaitu photo list\`，删除用 \`kaitu photo rm <id>\`（含原件，可恢复）。
- 直接编辑 Markdown / JSON 文件后，运行 \`kaitu validate\`，再用 \`kaitu snapshot -m "<人能读懂的说明>"\` 保存一个版本。

### 记录格式参考

${renderRecordReference(ws)}

本机 \`kaitu record add <类型> --json\` 只传示例中 type 以外的字段；date 简写与 source 自动补齐仅用于收件箱。
用 \`kaitu record types\` 列出类型，\`kaitu record schema <类型>\` 查看单个类型。

## 5. 确认规则

| 操作 | 是否需要用户确认 |
|---|---|
| 日常记录（训练、饮食、指标、待办） | 否，直接写，可撤销 |
| 自动记忆 | 否，直接写，告诉用户「已记住：……」 |
| 写入外部日历 | 是 |
| 批量导入 | 是（一屏列出，默认全选） |
| 删除模块、删除超过 10 条记录 | 是 |
| 修改 \`me/rules.md\`、\`me/goals.json\` | 是：先提出修改建议，用户确认后再改 |

## 6. 撤销与历史

- 每次写入都会生成一个版本。\`kaitu history [路径]\` 查看，\`kaitu restore <版本> [路径]\` 恢复。
- 对用户说「版本」「历史」「恢复」，不要说 git。

## 7. 记忆规则

- 用户说「记住……」时，用 \`kaitu memory add --type <类型> --name "<名称>" --text "<内容>"\` 保存。
- 自动提取默认开启：保存值得记住的内容，告诉用户「已记住：……」，可用版本历史撤销；用户要求暂停时停止提取。
- 有对应模块的内容写进模块，不进记忆。健康诊断等敏感信息仅在用户明确要求时保存，并加 \`--sensitive\`。
- 晚间复盘合并重复、处理矛盾并刷新档案摘要。用 \`kaitu chats search <词>\` 检索历史对话。

### 首次使用

- 四步：${ONBOARDING.steps.join(" → ")}。
- 起步选项：${ONBOARDING.starts.map((item) => item.title).join("、")}。
- 先运行 \`kaitu onboarding status\`，或 MCP \`onboarding_status\`；DSH 使用 \`kaitu_onboarding\` 的 status。
- AI 列表、记忆位置提示、提示词与所需数据源取返回值 content，按 onboarding 技能带用户完成四步，每步均可跳过。
- 记忆先 preview 展示候选，确认后传 token 与 selected；数据源先预览再确认，来源、版本与撤销点以工具回执为准。
- 选择用 onboarding choose 保存，完成情况实时计算；reset 只重置本机选择，不删除资料。不要手改配置或打勾完成状态。

## 8. 日常节奏

- 早间（morning-plan）：读规则、目标、日程、下一步、今天到期与提醒的待办和昨晚睡眠，按训练频率排今天，建议保留 pending。
- 晚间（evening-review）：把笔记待办整理为 task、提醒过期项、核对完成情况、更新模块状态、写日报、整理记忆，最后保存版本。
- 周复盘（weekly-review）：汇总本周进展和障碍，更新下周下一步。
- 月复盘（monthly-review）：汇总整月，满两个月后做有数据支持的现状分析；规则和目标变更仍须确认。
- 自动任务由用户在问问或设置中确认启用；首次使用选择不自动创建定时任务。

## 9. 技能与常用命令

正本在 \`.agents/skills/\`，同步副本在 \`.claude/skills/\`；\`kaitu agents-md\` 同时更新两处。

| 技能 | 何时使用 |
|---|---|
${skills()
  .map((s) => `| ${s.name} | ${s.description} |`)
  .join("\n")}

- \`kaitu status [--json-out]\`：今天的块和待确认数量、模块进度与 next、近 7 天训练和营养睡眠数据，以及项目进度和今天到期 / 过期 / 提醒的待办。
- \`kaitu memory import --file <候选.json> [--dry-run]\`：确认后的记忆数组一次导入、一个版本。
- \`kaitu import apple-health|nut-ai|ics <文件> --dry-run\`：先预览，用户确认后移除 --dry-run。
- \`kaitu upgrade [--dry-run]\`：升级内置模块与技能，保留自定义配置。
- \`kaitu doctor\` 检查工作区，\`kaitu validate [路径]\` 校验格式。

## 10. 工作台

独立 Kaitu.app 有总览、开图、记录、问问四个入口；DSH 插件保留三个资料入口与原生会话。运行 \`kaitu ui\` 可直接浏览资料与保存原文，无需模型；详情、连接与高级设置按需进入。
工作区不在默认位置时，命令加 \`--dir <绝对路径>\` 或设置 \`KAITU_DIR\`。

## 11. 存放位置与云端接力

- 本机、iCloud、Google Drive 三选一；用 \`kaitu sync enable icloud|drive [--dir <同步目录>]\` 开启，换云盘前先 disable。
- 个人数据存到 Drive，版本历史与密钥留在本机状态目录；\`kaitu drive disable [--to <目录>]\` 搬回本机。
- 云端 Agent 白天只追加（规则见 \`AGENT-README.md\`）；整理员每天整理一次（规则见 \`ORGANIZER.md\`）。
- 接受 digest.md（date frontmatter）、records.jsonl（每行 type）、memory.json（候选数组）、proposal.json（title/start/end）。
- 格式不确定时直接写 \`*.note.md\`，用自然语言即可，不会被拒；结构化文件写对会立即生效，写错的部分会转为待整理笔记。
- 可带 agent 来源；收件箱不接受删除、恢复、规则与目标修改。\`kaitu inbox process\` 手动处理，工作台运行时自动处理。
- Apple 健康 export.zip / export.xml 与快捷指令 *.health.json 放进 \`inbox/health/\`，稳定后自动导入；健康原件归档但不进版本。
- 每份成功文件一个版本，原件归档到 \`inbox/processed/YYYY-MM-DD/\`；写错的部分附原因转为 \`inbox/notes/YYYY-MM-DD/\` 待整理笔记。
- 只有 Drive 模式维护云端接力入口；本机与 iCloud 同样维护 OVERVIEW.md。iCloud 供多台 Mac 同步，云端 Agent 接力请选择 Drive。

## 12. MCP

- 本机：\`kaitu mcp\` 用 stdio。Claude Code 读取本目录 \`.mcp.json\`。
- Codex：在工作区运行 \`codex mcp add kaitu -- kaitu mcp\`；非默认目录先设置 \`KAITU_DIR\`。
- 云端：\`kaitu mcp --http\` 只监听 127.0.0.1:4871，默认精简 remote 工具，须 Bearer token。
- \`kaitu mcp token\` 查看 token，\`kaitu mcp token --rotate\` 轮换；不把 token 放进版本文件或日志。
- MCP 可读状态、记录、记忆和对话，可写记录、记忆、简报和待确认建议；不提供恢复、改规则或目标、任意文件写入。
- 资讯采集先读 \`.agents/skills/collect-news/SKILL.md\`，遵守通用规则与来源补充。Agent 新闻须有 summary/details/comment/published_at。
- 新闻用 \`news_item\` 投递并写明 \`relevance.reason\`，X 热门用 \`trend\`；复用新增记录工具或收件箱。\`news_read\` 读取资讯，\`news_try\` 生成 proposed 下一步，\`news_dismiss\` 标记单条新闻不相关。
- 公网连接需用户自行配置隧道，方法与边界见项目文档 \`docs/remote-agents.md\`。

## 13. 安全

- 不执行与本文件夹无关的命令。
- 不把密钥写进任何文件。
- 健康内容只做记录、趋势与提醒，不做医疗诊断。

${USER_SECTION}
${userPart}`;
}

export function writeAgentsMd(ws: Workspace): void {
  for (const skill of skills()) {
    for (const base of [".agents", ".claude"]) {
      ws.writeText(`${base}/skills/${skill.name}/SKILL.md`, skill.text);
    }
  }
  ws.writeText("AGENTS.md", renderAgentsMd(ws));
}
