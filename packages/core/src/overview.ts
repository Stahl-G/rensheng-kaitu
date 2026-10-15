import { INBOX_FORMATS } from "./inbox-formats.js";
import { renderRecordReference } from "./record-reference.js";
import { readStatus } from "./status.js";
import { timeZoneNotice } from "./time.js";
import type { Workspace } from "./workspace.js";

export function renderAgentReadme(ws: Workspace, now = new Date()): string {
  return `# 开图云端 Agent 入口

${timeZoneNotice(ws.timeZone(), now)}

先读 OVERVIEW.md 了解今天与最近数据，再读 me/profile.md、me/rules.md、NOW.md、memory/MEMORY.md。
只在 inbox/agents/ 新建唯一文件名（如你的名称加时间戳），不改已有文件或数据。
格式不确定时直接写 *.note.md，用自然语言即可，不会被拒；结构化文件写对会立即生效，写错的部分会转为待整理笔记。
成功原件归档到 inbox/processed/YYYY-MM-DD/；待整理内容在 inbox/notes/YYYY-MM-DD/。
运行 kaitu ui 自动处理，或本机运行 kaitu inbox process。

## 收件箱格式

${INBOX_FORMATS}

不接受删除、恢复、规则或目标修改。日程建议须用户在工作台确认；敏感记忆须用户明确要求。

## 记录格式

${renderRecordReference(ws)}

project_metric 的 project 填已存在的共享项目 slug；不接受仅本机项目。photo 只记录已有文件引用，上传原件用本机 kaitu photo add。
`;
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
  put(ws, "OVERVIEW.md", lines.join("\n"));
}
