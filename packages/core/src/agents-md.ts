import { listModules } from "./modules.js";
import type { Workspace } from "./workspace.js";

const USER_SECTION = "<!-- 以下内容由你自己维护，重新生成时保留 -->";

/**
 * 生成 AGENTS.md。完整版见 PRD §8.1（T10）；这里先覆盖读取顺序、模块清单、写入与确认规则。
 * 分隔线以下是用户追加的内容，重新生成时原样保留。
 */
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
- 时间一律 ISO 8601 并带时区偏移；日期按用户时区（\`me/rules.md\` 的 \`timezone\`）切分。
- 直接编辑 Markdown / JSON 文件后，运行 \`kaitu validate\`，再用 \`kaitu snapshot -m "<人能读懂的说明>"\` 保存一个版本。

## 5. 确认规则

| 操作 | 是否需要用户确认 |
|---|---|
| 日常记录（训练、饮食、指标） | 否，直接写，可撤销 |
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

## 8. 安全

- 不执行与本文件夹无关的命令。
- 不把密钥写进任何文件。
- 健康内容只做记录、趋势与提醒，不做医疗诊断。

${USER_SECTION}
${userPart}`;
}

export function writeAgentsMd(ws: Workspace): void {
  ws.writeText("AGENTS.md", renderAgentsMd(ws));
}
