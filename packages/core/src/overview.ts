import { readdirSync } from "node:fs";
import { parseFrontmatter } from "./frontmatter.js";
import { INBOX_FORMATS } from "./inbox-formats.js";
import { renderRecordReference } from "./record-reference.js";
import { schemas } from "./schema.js";
import { readStatus } from "./status.js";
import { syncMode } from "./sync-location.js";
import { timeZoneNotice } from "./time.js";
import type { Workspace } from "./workspace.js";

export function renderAgentReadme(ws: Workspace, now = new Date()): string {
  return `# 开图云端 Agent 入口

${timeZoneNotice(ws.timeZone(), now)}

## 接手顺序

1. AGENT-README.md。
2. handoffs/daily/ 里最新的每日整理；没有就读 OVERVIEW.md。
3. handoffs/ 根目录下比它新的交接记录，按时间排序。
4. inbox/agents/ 里比它新的文件。
5. 需要细节时再读 NOW.md、<模块>/STATUS.md、me/、memory/。

## 两个角色与文件

- 接力者（任何 Agent）：只在 inbox/agents/* 和 handoffs/<YYYYMMDDTHHMM>-<agent>.md 新建唯一文件，不建子目录、不改已有文件。
- 整理员（用户设定的夜间定时任务）：按 ORGANIZER.md 写 handoffs/daily/<YYYY-MM-DD>.md，更新各模块 STATUS.md 的下一步，归档已整理的交接。
- ORGANIZER.md、AGENT-README.md、OVERVIEW.md、AGENTS.md、<模块>/data/、me/* 由本机 kaitu 维护，云端只读。

## 交接记录

只要做过任何事，结束前新建 handoffs/<YYYYMMDDTHHMM>-<agent>.md，例如：

\`\`\`markdown
---
agent: grok-bot
at: 2026-10-16T09:12:00+08:00
follows: handoffs/20261016T0830-dot.md
---
## 做了什么
- 记录午饭：inbox/agents/grok-bot-20261016T0912.records.jsonl
## 当前下一步
- health：周四练背 40 分钟（已完成）
- health：周六有氧 30 分钟
## 未决 / 需要用户
- 无
\`\`\`

follows 可选，指向接续的上一份交接或每日整理。「当前下一步」写完整清单，不只写改动。
两份交接接续同一份时，把两份都读，在自己的交接里合并「当前下一步」。
记录交到 inbox/agents/；格式不确定时写 *.note.md。
本机 kaitu ui 或 kaitu inbox process 处理，成功原件归档到 inbox/processed/YYYY-MM-DD/，错误部分转到 inbox/notes/YYYY-MM-DD/ 待整理。

## 收件箱格式

${INBOX_FORMATS}

不接受删除、恢复、规则或目标修改。日程建议须用户在工作台确认；敏感记忆须用户明确要求。

## 资讯投递

先读 [collect-news](.agents/skills/collect-news/SKILL.md)，所有 Agent 遵守通用规则，再按来源补充采集。
Agent 新闻必填 summary、details、comment、published_at；X 仅由能读取 X 的 Agent 采集，其他 Agent 跳过。
news_item 的 kind 缺省 article；X 热门用 trend.samples 放原帖，posts 仍为数量。
可交 *.news.jsonl 或 *.records.jsonl，缺字段转待整理并注明原因。

## 记录格式

${renderRecordReference(ws)}

project_metric 的 project 填已存在的共享项目 slug；不接受仅本机项目。photo 只记录已有文件引用，上传原件用本机 kaitu photo add。
`;
}

export function renderOrganizer(): string {
  return `# 开图夜间整理员

任何 Agent 都可承担此角色。由用户设定夜间定时任务（建议凌晨 3 点），多家任务错开半小时互为备份。
日期按 me/rules.md 的 timezone 判断。

1. handoffs/daily/<今天>.md 已存在：今晚已经有人整理过，直接结束。
2. 读最新的每日整理（没有就读 OVERVIEW.md），再读它之后的全部交接记录和 inbox/agents/ 文件。
3. 让各模块 STATUS.md 的 next 与最新交接一致，同时更新 updated。改之前先重读；只改这两个字段，不动其他字段和正文。
4. 写 handoffs/daily/<今天>.md，frontmatter 为 organizer（你的 Agent 名）、date（YYYY-MM-DD）。
   正文包含「昨天做了什么」（附来源文件）、「当前下一步」（完整清单）、「未决事项」、「收件箱里还没导入的记录」。
5. 把已整理的交接记录移到 handoffs/archive/<今天>/。不删除文件，不动收件箱，留给本机导入。
   无法移动时，在每日整理中列出已整理的文件；接手者只读比每日整理新的交接。
6. 拿不准的地方（如两份交接互相矛盾）写进每日整理的「未决事项」，不要猜。

不能做：删除任何文件；改 NOW.md、inbox/、<模块>/data/、me/、memory/ 和本机生成的文件；写外部日历或替用户联系任何人。
`;
}

function recentHandoffs(ws: Workspace) {
  const entries: { file: string; agent: string; at: string; next: string }[] = [];
  if (!ws.exists("handoffs")) return entries;
  for (const entry of readdirSync(ws.resolve("handoffs"), { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    const file = `handoffs/${entry.name}`;
    if (ws.scanText(file) === undefined) continue;
    try {
      const { data, body } = parseFrontmatter<{ agent: string; at: string }>(ws.readText(file));
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
      const plan = parseFrontmatter<{
        date: string;
        blocks: { start?: string; end?: string; title: string; status: string }[];
      }>(ws.readText("NOW.md")).data;
      lines.push("", `## 最近计划（${plan.date}）`, "");
      for (const block of plan.blocks)
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
  if (syncMode(ws.root) === "drive") {
    put(ws, "AGENT-README.md", renderAgentReadme(ws, now));
    put(ws, "ORGANIZER.md", renderOrganizer());
  }
  const text = lines.join("\n");
  // 内容不变时保留原生成时间，避免派生文件持续改动。
  const withoutTime = (value: string) => value.replace(/^生成时间：.*$/m, "");
  if (!ws.exists("OVERVIEW.md") || withoutTime(ws.scanText("OVERVIEW.md") ?? "") !== withoutTime(text)) {
    put(ws, "OVERVIEW.md", text);
  }
}
