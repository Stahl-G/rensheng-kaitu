import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { AI_NETWORK_RULES } from "./ai-instructions.js";
import { templateDir } from "./assets.js";
import { normalizeHandoff, normalizeNow } from "./doc-input.js";
import { parseFrontmatter } from "./frontmatter.js";
import { schemas } from "./schema.js";
import { readStatus } from "./status.js";
import { syncMode } from "./sync-location.js";
import { timeZoneNotice } from "./time.js";
import { refreshUserProfile } from "./user-profile.js";
import { workspaceBackupEnabled } from "./workspace-backup.js";
import type { Workspace } from "./workspace.js";

export function renderAgentReadme(ws: Workspace, now = new Date()): string {
  return `# 开图云端 Agent：任务入口

${timeZoneNotice(ws.timeZone(), now)}

按根目录 \`AGENTS.md\` 的路由选择当前任务，只读相关摘要、技能和必要格式；外部 Agent 从文件读取入口。接续任务才读相关交接，整理员按 \`ORGANIZER.md\` 执行。

## 投递与结果

在 \`inbox/agents/<agent>-<唯一时间>.records.jsonl\` 新建文件，每行一个带 type 的对象，以换行结束。类型从相关模块的 module.json.records 查，字段与示例按类型读 \`RECORDS.md\` 的相关类型；其他收件箱格式见 \`RECORDS.md\`。
原始文字用唯一的 \`*.note.md\`：它保存原文，后续如何记由用户决定。放进收件箱只能说「已投递」；原文保存与餐食入账分别核对，只有处理结果和记录回读才能确认餐食已保存。不要重复投递同一餐来试探是否入账。
本机工作台或 \`kaitu inbox process\` 处理文件，成功原件归档到 \`inbox/processed/YYYY-MM-DD/\`，错误部分附原因保存在 \`inbox/notes/YYYY-MM-DD/\`。

## 写入边界

- 交新文件，不建收件箱子目录、不覆盖已有文件。只更新自己做过的项目 STATUS.md 与 log.md；项目链接目录只读。
- 档案、偏好、目标、规则保留原内容，建议交到收件箱；用户明确授权的修改按确认范围执行。收件箱不接受删除、恢复、规则或目标修改。
- 日程建议等待用户确认；敏感记忆须用户明确要求。记忆替换只交 replaces 候选，用户确认前保留旧条。
- \`.kaitu/\`、版本库、密钥由程序管理。RECORDS.md、ORGANIZER.md、AGENT-README.md、AGENTS.md、OVERVIEW.md 与 RECORDS.md由本机维护；手机文件只按 ORGANIZER.md 的授权范围更新。
- 密钥保留在本机，不写入投递文件或日志。健康只做记录、趋势与提醒。

${AI_NETWORK_RULES}

## 完成后交接

新建 \`handoffs/<YYYYMMDDTHHMM>-<agent>.md\`，frontmatter 写 agent、带时区的 at；接续已有交接时可写 follows 路径。正文写「做了什么」「当前下一步」「未决 / 需要用户」，列实际投递路径和已核对结果；下一步保留该任务的完整清单。接续同一任务的多份交接保留各方未完成项，不把无关项目加入读取清单。
`;
}

let organizer: string | undefined;

export function renderOrganizer(): string {
  organizer ??= readFileSync(join(templateDir(), "ORGANIZER.md"), "utf8");
  return organizer;
}

function recentHandoffs(ws: Workspace) {
  const entries: { file: string; agent: string; at: string; next: string }[] = [];
  if (!ws.exists("handoffs")) return entries;
  for (const entry of readdirSync(ws.resolve("handoffs"), { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    const file = `handoffs/${entry.name}`;
    if (ws.scanText(file) === undefined) continue;
    try {
      const parsed = parseFrontmatter<{ agent: string; at: string }>(ws.readText(file));
      const body = parsed.body;
      const data = normalizeHandoff(parsed.data, file, ws.timeZone()) as { agent: string; at: string };
      if (!schemas().builtin("handoff.schema.json")(data)) continue;
      const section = body.split(/^## (?:当前)?下一步[^\S\n]*\r?\n/m)[1]?.split(/^## /m)[0] ?? "";
      const next = /^\s*(?:[-*+]|\d+[.)]) (.+)$/m.exec(section)?.[1] ?? "待补";
      entries.push({ file, ...data, next });
    } catch {
      // 格式错误交给 validate 报告，不阻断现状刷新。
    }
  }
  return entries
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || b.file.localeCompare(a.file))
    .slice(0, 3);
}

export function latestDaily(ws: Workspace) {
  if (!ws.exists("handoffs/daily")) return;
  const entries: { file: string; date: string; organizer: string; body: string }[] = [];
  for (const entry of readdirSync(ws.resolve("handoffs/daily"), { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    const file = `handoffs/daily/${entry.name}`;
    if (ws.scanText(file) === undefined) continue;
    try {
      const { data, body } = parseFrontmatter<{ organizer: string; date: string }>(ws.readText(file));
      if (schemas().builtin("daily.schema.json")(data)) {
        entries.push({ file, date: data.date, organizer: data.organizer, body });
      }
    } catch {
      // 格式错误交给 validate 报告，不阻断现状刷新。
    }
  }
  return entries.sort((a, b) => b.date.localeCompare(a.date) || b.file.localeCompare(a.file))[0];
}

const deferred = new WeakMap<Workspace, number>();

export function overviewDeferred(ws: Workspace): boolean {
  return (deferred.get(ws) ?? 0) > 0;
}

/** 界面进程里写入后不再同步刷新现状，由文件监听在后台刷新。 */
export function holdOverview(ws: Workspace): void {
  deferred.set(ws, (deferred.get(ws) ?? 0) + 1);
}

export async function batchOverview<T>(ws: Workspace, operation: () => Promise<T>): Promise<T> {
  deferred.set(ws, (deferred.get(ws) ?? 0) + 1);
  try {
    return await operation();
  } finally {
    deferred.set(ws, (deferred.get(ws) ?? 1) - 1);
    if (!overviewDeferred(ws)) refreshOverview(ws);
  }
}

function put(ws: Workspace, file: string, text: string) {
  if (ws.exists(file) && ws.scanText(file) === undefined) return;
  if (!ws.exists(file) || ws.readText(file) !== text) ws.writeText(file, text);
}

export function refreshOverview(ws: Workspace, now = new Date()): void {
  try {
    refreshUserProfile(ws, now);
  } catch {
    /* Derived output cannot block original writes. */
  }
  if (!ws.exists(".kaitu/config.json") || !ws.exists("NOW.md") || !ws.exists("me/rules.md")) return;
  if ([".kaitu/config.json", "NOW.md", "me/rules.md"].some((file) => ws.scanText(file) === undefined)) return;
  const data = readStatus(ws, now, true);
  const lines = [
    `# 开图现状 · ${data.today}`,
    "",
    `生成时间：${now.toISOString()}`,
    "",
    timeZoneNotice(ws.timeZone(), now),
    "",
    `待确认建议：${data.now.pending}`,
    `${data.inboxNotes} 条待整理笔记`,
    "",
    `## 今天（${ws.timeZone()}）`,
    "",
  ];
  for (const block of data.now.blocks) {
    lines.push(`- ${block.start ?? ""}–${block.end ?? ""} ${block.title}（${block.kind} / ${block.status}）`);
  }
  if (!data.now.blocks.length) lines.push("暂无安排。");
  if (data.now.date !== data.today) {
    // 过期计划仍是接力证据，明确标出日期，避免把它混入今天或在更新时丢掉变化。
    try {
      const plan = normalizeNow(parseFrontmatter(ws.readText("NOW.md")).data) as {
        date: string;
        blocks: { start?: string; end?: string; title: string; status: string }[];
      };
      lines.push("", `## 最近计划（${plan.date}）`, "");
      for (const block of plan.blocks)
        if (block && typeof block.title === "string")
          lines.push(`- ${block.start ?? ""}–${block.end ?? ""} ${block.title}（${block.status}）`);
    } catch {
      // 格式问题已由 readStatus 的 warnings 报告。
    }
  }
  lines.push("", "## 最新每日整理", "");
  const daily = latestDaily(ws);
  lines.push(daily ? `- ${daily.date}（${daily.file}）` : "暂无每日整理。");
  lines.push("", "## 最近交接", "");
  const handoffs = recentHandoffs(ws);
  for (const handoff of handoffs) {
    lines.push(`- ${handoff.agent} · ${handoff.at} · 下一步：${handoff.next}（${handoff.file}）`);
  }
  if (!handoffs.length) lines.push("暂无交接记录。");
  lines.push("", "## 待办与提醒", "");
  for (const task of data.tasks) {
    const tags = [
      task.overdue && "已过期",
      task.dueToday && "今天到期",
      task.remindToday && "今天提醒",
    ].filter(Boolean);
    lines.push(
      `- ${task.title}（${tags.join(" / ")}）${task.due ? ` 截止：${task.due}` : ""}${task.remind_at ? ` 提醒：${task.remind_at}` : ""}`,
    );
  }
  if (!data.tasks.length) lines.push("今天没有到期或提醒的待办，也没有过期项。");
  lines.push("", "## 模块进度与下一步", "");
  for (const module of data.modules) {
    lines.push(`### ${module.module}（${module.file}）`, "");
    if (module.progress) {
      const p = module.progress;
      lines.push(`${p.label}：${p.current} / ${p.target} ${p.unit ?? ""}`, "");
    }
    for (const next of module.next ?? []) lines.push(`- ${next.title}（${next.status}）`);
    lines.push("");
  }
  lines.push("## 项目", "");
  for (const project of data.projects) {
    lines.push(
      `### ${project.title}（${project.kind === "work" ? "工作" : project.kind === "learning" ? "学习" : "个人"} / ${project.stage}）`,
      "",
      `近 7 天：字数变化 ${project.recent7.words ?? "待补"}；${project.recent7.commits} 次提交`,
      `最近进展：${project.lastLogDate ?? "待补"}`,
    );
    for (const next of project.next) lines.push(`- ${next.title}（${next.status}）`);
    lines.push("");
  }
  const r = data.recent7;
  lines.push(
    "## 最近 7 天",
    "",
    `${r.from} 至 ${r.to}`,
    "",
    `- 训练：${r.workouts} 次`,
    `- 日均睡眠：${r.averageSleepHours?.toFixed(1) ?? "待补"} 小时`,
    `- 日均蛋白质：${r.averageProteinG?.toFixed(1) ?? "待补"} g`,
    `- 最新体重：${r.latestWeight ? `${r.latestWeight.value} ${r.latestWeight.unit ?? "kg"}（${r.latestWeight.ts}）` : "待补"}`,
    ...data.warnings.map((warning) => `- ${warning}`),
    "",
  );
  // 接力说明与整理规则随版本维护，GitHub 与同步盘使用同一份入口。
  if (syncMode(ws.root) === "drive" || workspaceBackupEnabled(ws))
    put(ws, "AGENT-README.md", renderAgentReadme(ws, now));
  put(ws, "ORGANIZER.md", renderOrganizer());
  const text = lines.join("\n");
  // 内容不变时保留原生成时间，避免派生文件持续改动。
  const withoutTime = (value: string) => value.replace(/^生成时间：.*$/m, "");
  if (!ws.exists("OVERVIEW.md") || withoutTime(ws.scanText("OVERVIEW.md") ?? "") !== withoutTime(text)) {
    put(ws, "OVERVIEW.md", text);
  }
}
