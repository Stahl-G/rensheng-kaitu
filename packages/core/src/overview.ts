import { readdirSync } from "node:fs";
import { parseFrontmatter } from "./frontmatter.js";
import { INBOX_FORMATS } from "./inbox-formats.js";
import { renderRecordReference } from "./record-reference.js";
import { schemas } from "./schema.js";
import { readStatus } from "./status.js";
import { timeZoneNotice } from "./time.js";
import type { Workspace } from "./workspace.js";

export function renderAgentReadme(ws: Workspace, now = new Date()): string {
  return `# 开图云端 Agent 入口

${timeZoneNotice(ws.timeZone(), now)}

## 接手顺序

1. AGENT-README.md → LOCK.json。
2. OVERVIEW.md，记下开头的生成时间。
3. NOW.md、相关模块的 <模块>/STATUS.md；背景见 me/profile.md、me/rules.md、memory/MEMORY.md。
4. handoffs/YYYY-MM/ 中比 OVERVIEW.md 生成时间新的交接记录，按时间排序，最多最近 10 份。
5. inbox/agents/ 中未处理的文件也算现状；回答进度时与交接记录、OVERVIEW.md 合起来看。

## 三类文件

- 只追加，不用锁：inbox/agents/*、handoffs/YYYY-MM/<时间>-<agent>.md。只新建唯一文件名，不改已有文件。
- 状态，须持锁：NOW.md、各模块 <模块>/STATUS.md（含 learning/<topic>/STATUS.md、decisions/<slug>/STATUS.md、projects/<slug>/STATUS.md）。
- 云端只读，由本机生成：OVERVIEW.md、AGENT-README.md、AGENTS.md、<模块>/data/、me/goals.json、me/rules.md 及其余文件。

## 状态锁（Drive 模式）

1. 读根目录 LOCK.json；不存在或 expires_at 已过期才能写自己的锁。
2. 写入 {"holder":"你的 agent 名","purpose":"本次目的","acquired_at":"带时区的 ISO 时间","expires_at":"最多 15 分钟后"}。
3. 等几秒重读 LOCK.json，holder 仍是自己才算取锁成功。每个状态文件改前重读，只改需要的部分；超过 10 分钟未完成就续期。
4. 完成后把 LOCK.json 的 expires_at 改为当前时间，不删除文件。
5. 未取到锁就不改状态文件；可继续追加收件箱与交接记录，在「未决」写明想改什么，并告诉用户「<holder> 正在更新，稍后再试」。

持锁人为 kaitu-local 时是本机开图在写，同样等它过期或放锁。

## 交接记录

只要动过任何东西，结束前新建 handoffs/YYYY-MM/<时间>-<agent>.md，例如：

\`\`\`markdown
---
agent: grok-bot
at: 2026-10-16T09:12:00+08:00
---
## 做了什么
- 记录午饭：inbox/agents/grok-bot-20261016T0912.records.jsonl
## 下一步
- 周六有氧 30 分钟
## 未决 / 需要用户
- 无
\`\`\`

记录交到 inbox/agents/，不直接改 <模块>/data/。格式不确定时写 *.note.md；错误部分会转为待整理笔记。
本机 kaitu ui 或 kaitu inbox process 处理，成功原件归档到 inbox/processed/YYYY-MM-DD/，待整理内容在 inbox/notes/YYYY-MM-DD/。

## 收件箱格式

${INBOX_FORMATS}

不接受删除、恢复、规则或目标修改。日程建议须用户在工作台确认；敏感记忆须用户明确要求。

## 记录格式

${renderRecordReference(ws)}

project_metric 的 project 填已存在的共享项目 slug；不接受仅本机项目。photo 只记录已有文件引用，上传原件用本机 kaitu photo add。
`;
}

function recentHandoffs(ws: Workspace) {
  const entries: { file: string; agent: string; at: string; next: string }[] = [];
  if (!ws.exists("handoffs")) return entries;
  for (const month of readdirSync(ws.resolve("handoffs"), { withFileTypes: true })) {
    if (!month.isDirectory() || !/^\d{4}-\d{2}$/.test(month.name)) continue;
    const dir = `handoffs/${month.name}`;
    for (const entry of readdirSync(ws.resolve(dir), { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
      const file = `${dir}/${entry.name}`;
      try {
        const { data, body } = parseFrontmatter<{ agent: string; at: string }>(ws.readText(file));
        if (!schemas().builtin("handoff.schema.json")(data)) continue;
        const section = body.split(/^## 下一步[^\S\n]*\r?\n/m)[1]?.split(/^## /m)[0] ?? "";
        const next = /^\s*(?:[-*+]|\d+[.)]) (.+)$/m.exec(section)?.[1] ?? "待补";
        entries.push({ file, ...data, next });
      } catch {
        // 格式错误交给 validate 报告，不阻断现状刷新。
      }
    }
  }
  return entries
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || b.file.localeCompare(a.file))
    .slice(0, 3);
}

const deferred = new WeakMap<Workspace, number>();

export function overviewDeferred(ws: Workspace): boolean {
  return (deferred.get(ws) ?? 0) > 0;
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
  if (!ws.exists(file) || ws.readText(file) !== text) ws.writeText(file, text);
}

export function refreshOverview(ws: Workspace, now = new Date()): void {
  if (!ws.exists(".kaitu/config.json") || !ws.exists("NOW.md") || !ws.exists("me/rules.md")) return;
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
      `### ${project.title}（${project.kind === "work" ? "工作" : "个人"} / ${project.stage}）`,
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
  put(ws, "AGENT-README.md", renderAgentReadme(ws, now));
  const text = lines.join("\n");
  // 内容不变时保留原生成时间，避免派生文件持续改动。
  const withoutTime = (value: string) => value.replace(/^生成时间：.*$/m, "");
  if (!ws.exists("OVERVIEW.md") || withoutTime(ws.readText("OVERVIEW.md")) !== withoutTime(text)) {
    put(ws, "OVERVIEW.md", text);
  }
}
