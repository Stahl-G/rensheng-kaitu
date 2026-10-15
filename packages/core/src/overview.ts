import { readStatus } from "./status.js";
import type { Workspace } from "./workspace.js";

const ENTRY = `# 开图云端 Agent 入口

这是用户的个人生活工作区。先读 OVERVIEW.md 了解今天、待确认事项与最近数据，
再读 me/profile.md、me/rules.md、NOW.md、memory/MEMORY.md；模块路径见 AGENTS.md。

只在 inbox/agents/ 新建唯一文件名，不能修改已有文件或直接修改数据。开图会校验、保存版本并归档。
- <唯一名>.digest.md：frontmatter 含 date: YYYY-MM-DD，可含 agent；正文为动态简报。
- <唯一名>.records.jsonl：每行 {"type":"workout","exercise":"深蹲","sets":3,"reps":12,"weight_kg":60,"session_id":"s1","agent":"你的名称"}。
- <唯一名>.memory.json：候选数组，每项含 type（preference / fact / context / person / decision）、name、text，可含 agent。
- <唯一名>.proposal.json：含 title、start、end（HH:mm）、可选 module 与 agent，写为待确认建议。

不要发送删除、恢复、规则或目标修改。日程建议须用户在工作台确认；敏感记忆须用户明确要求。
版本历史、密钥和索引由本机维护。收件箱成功原件在 inbox/processed/YYYY-MM-DD/，失败原因在 inbox/rejected/。
`;

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
  const lines = [`# 开图现状 · ${data.today}`, "", `待确认建议：${data.now.pending}`, "", "## 今天", ""];
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
  put(ws, "AGENT-README.md", ENTRY);
  put(ws, "OVERVIEW.md", lines.join("\n"));
}
