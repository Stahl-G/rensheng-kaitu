import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { AI_NETWORK_RULES } from "./ai-instructions.js";
import { templateDir } from "./assets.js";
import { parseFrontmatter } from "./frontmatter.js";
import { INBOX_FORMATS } from "./inbox-formats.js";
import { listModules } from "./modules.js";
import { renderRecordReference } from "./record-reference.js";
import type { Workspace } from "./workspace.js";

const USER_SECTION = "<!-- 以下内容由你自己维护，重新生成时保留 -->";

function skills() {
  const dir = join(templateDir(), ".agents/skills");
  return readdirSync(dir)
    .sort()
    .map((name) => {
      let text = readFileSync(join(dir, name, "SKILL.md"), "utf8");
      if (name === "record-format") text += `\n## 收件箱格式\n\n${INBOX_FORMATS}`;
      const { data } = parseFrontmatter<{ name: string; description: string }>(text);
      return { name, text, description: data.description };
    });
}

/** 分隔线以下是用户追加的内容，重新生成时原样保留。 */
export function renderAgentsMd(ws: Workspace): string {
  let userPart = "";
  if (ws.exists("AGENTS.md")) {
    const old = ws.readText("AGENTS.md");
    const i = old.indexOf(USER_SECTION);
    if (i >= 0) userPart = old.slice(i + USER_SECTION.length).replace(/^\n+/, "");
  }

  return `# 开图工作区：任务入口

由 \`kaitu agents-md\` 生成；用户补充写在文末分隔线以下。

先读根目录 \`SKILL.md\`，按当前任务只读相关摘要与技能。它是资料工作区的任务指引；外部运行时是否自动识别由其自身决定。
格式按类型查 \`kaitu record schema <类型>\`、DSH \`kaitu_status\` 的 type 或 \`skills/record-format/<类型>.md\`。类型从相关模块的 module.json.records 或 \`kaitu record types\` 发现，MCP 可用 record_types。

## 写入与确认

- 只写工作区内；\`.kaitu/\`、版本库和密钥由程序管理。记录通过 \`kaitu record add/update/rm\` 或对应 MCP/DSH 工具写入，保留现有 ID 与追加修订，勿直接编辑数据 JSONL。
- 普通 Markdown/JSON 修改后校验相关路径，再用 \`kaitu snapshot -m "说明"\` 保存版本；用 \`history\` / \`restore\` 查询与恢复。对用户称版本、历史、恢复。
- 日常记录可直接保存、可撤销；自动记忆默认开启，保存后告知，用户要求暂停时停止。有对应模块的内容进入模块；健康诊断等敏感记忆仅在用户明确要求时保存并标 sensitive。
- 修改 \`me/rules.md\`、\`me/goals.json\`、\`me/ongoing.json\`，写外部日历，批量导入，删除模块或超过 10 条记录，启用自动任务，记忆归档/替换，均先取得对应用户确认。批量导入先预览；规则与目标先给具体改动。
- 记忆文件名稳定，无 ended 才是当前记忆；归档/替换通过专用工具，AI 只提候选，确认前保留原条。档案与其他已有正文保留，来源与用户实际表达如实记录。
- AI 提议保持 suggested/pending，用户采纳后才生效。地点与方向用专用工具，计划与真实经历分开；项目链接目录只读，项目可见性变更须用户明确选择，云端旧副本由用户清理。
- 时间用带时区偏移的 ISO 8601，日期按 \`me/rules.md\` 的 timezone 切分。照片只填已保存的引用；健康只做记录、趋势与提醒。
- 只能读写云盘文件时按 \`AGENT-README.md\` 投递唯一文件；\`.note.md\` 保存原文，结构化记录是否入账以处理结果与回读为准。

## 对外工具

${AI_NETWORK_RULES}

工作区不在默认位置时，命令加 \`--dir <绝对路径>\` 或设置 \`KAITU_DIR\`。MCP 的读取与写入以实际工具权限为准；凭据留在本机，不写进工作区或日志。

${USER_SECTION}
${userPart}`;
}

/** 根技能与内置提示词使用同一模板，不携带用户资料。 */
export function workspaceAgentGuide(): string {
  return parseFrontmatter(readFileSync(join(templateDir(), "SKILL.md"), "utf8")).body.trim();
}

export function writeAgentsMd(ws: Workspace): void {
  ws.writeText("SKILL.md", readFileSync(join(templateDir(), "SKILL.md"), "utf8"));
  for (const skill of skills()) {
    for (const base of [".agents", ".claude"]) {
      ws.writeText(`${base}/skills/${skill.name}/SKILL.md`, skill.text);
    }
    // 云盘连接器可能不展示隐藏目录；复用同一技能正文，公开餐食步骤和格式查询入口。
    if (["record-format", "log-meal"].includes(skill.name))
      ws.writeText(`skills/${skill.name}/SKILL.md`, skill.text);
  }
  for (const module of listModules(ws)) {
    for (const type of Object.keys(module.def.records ?? {})) {
      let reference: string;
      try {
        reference = renderRecordReference(ws, type);
      } catch {
        reference = `Schema 尚未可用；用 kaitu record schema ${type} 查看原因。`;
      }
      ws.writeText(`skills/record-format/${type}.md`, `${reference}\n`);
    }
  }
  // 资讯采集规则和关注方向放在一起：云端 Agent 经云盘读文件时找不到隐藏文件夹里的技能。
  if (ws.exists("feed/module.json"))
    ws.writeText("feed/COLLECT.md", readFileSync(join(templateDir(), "feed/COLLECT.md"), "utf8"));
  ws.writeText("AGENTS.md", renderAgentsMd(ws));
}
