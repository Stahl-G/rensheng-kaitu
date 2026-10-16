import { realpathSync } from "node:fs";
import { extname, relative, sep } from "node:path";
import { KaituError } from "./errors.js";
import { isExperienceControlType } from "./experience-imports.js";
import { isExplorationType } from "./exploration.js";
import { parseFrontmatter, stringifyFrontmatter } from "./frontmatter.js";
import { snapshot } from "./history.js";
import { findRecordType, listModules } from "./modules.js";
import { removePhoto } from "./photos.js";
import { type ExperienceInput, addExperiences } from "./places.js";
import { assertPublicProject } from "./projects.js";
import { addRecord, deleteRecord, readRecords, updateRecord } from "./records.js";
import { schemas } from "./schema.js";
import { isoInZone, localDate } from "./time.js";
import { ulid } from "./ulid.js";
import type { TodayPlan } from "./workbench.js";
import type { Workspace } from "./workspace.js";

export function readAgentFile(ws: Workspace, file: string, publicOnly = false): string {
  const abs = ws.resolve(file);
  // 同时检查请求路径和真实路径，不能借工作区内链接读取程序状态。
  const paths = [
    relative(ws.root, abs).split(sep).join("/"),
    relative(realpathSync(ws.root), realpathSync(abs)).split(sep).join("/"),
  ];
  for (const path of paths) {
    if (
      path.split("/").some((part) => part === ".kaitu" || part === ".git") ||
      ![".md", ".json"].includes(extname(path))
    ) {
      throw new KaituError("只允许读取工作区内的 .md / .json，不读 .kaitu/ 或版本库目录", "OUT_OF_SCOPE");
    }
  }
  if (publicOnly) {
    const financialModules = [
      "finance",
      ...listModules(ws)
        .filter((m) => m.def.id === "finance" || m.dir === "finance")
        .map((m) => m.dir),
    ];
    for (const path of paths) {
      if (financialModules.some((dir) => path === dir || path.startsWith(`${dir}/`)))
        throw new KaituError("财务明细只允许在本机读取", "OUT_OF_SCOPE");
      const slug = /^projects\/([^/]+)\//.exec(path)?.[1];
      if (slug && !["data", "module.json"].includes(slug)) assertPublicProject(ws, slug);
    }
  }
  return ws.readText(file);
}

export async function writeAgentRecord(
  ws: Workspace,
  operation: "add" | "update" | "delete",
  type: string,
  actor: string,
  data: Record<string, unknown> = {},
  id = "",
) {
  if (isExperienceControlType(type))
    throw new KaituError("足迹来源与导入控制由用户在界面处理", "USER_DECISION");
  if (isExplorationType(type))
    throw new KaituError("方向与实验使用 exploration_write，保留版本与用户决定", "USE_EXPLORATION_API");
  if (type === "experience" && operation === "add")
    return addExperiences(ws, [data as unknown as ExperienceInput], "agent");
  if (["project_metric", "github_snapshot"].includes(type)) {
    const current = operation === "add" ? undefined : readRecords(ws, type).find((row) => row.id === id);
    assertPublicProject(ws, data.project ?? current?.project);
  }
  const ref = findRecordType(ws, type);
  if (type === "photo" && operation === "delete") return removePhoto(ws, id, { by: "agent", actor });
  const result =
    operation === "add"
      ? addRecord(ws, type, data)
      : operation === "update"
        ? updateRecord(ws, type, id, data)
        : deleteRecord(ws, type, id);
  const message = operation === "add" ? "记录了" : operation === "update" ? "修改了" : "删除了";
  const version = await snapshot(
    ws,
    `${actor}在${ref.module.def.name}模块${message} 1 条${ref.def.label ?? type}`,
  );
  return { ...result, version };
}

export async function writeDigest(
  ws: Workspace,
  date: string,
  content: string,
  actor: string,
  source = actor,
) {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    Number.isNaN(Date.parse(date)) ||
    new Date(date).toISOString().slice(0, 10) !== date
  ) {
    throw new KaituError("简报日期不合法", "BAD_ARGS");
  }
  const file = `feed/digests/${date}.md`;
  const name =
    source
      .trim()
      .replace(/[\r\n\p{Cc}\p{Cf}]/gu, " ")
      .slice(0, 100) || "cloud-agent";
  const heading = `## 来自 ${name}`;
  const body = parseFrontmatter(content).body.trim();
  // 来源正文从三级标题开始，避免正文标题被识别为来源分节。
  const nested = body.replace(
    /^(#{1,5}) /gm,
    (_match, hashes: string) => `${"#".repeat(Math.min(6, hashes.length + 2))} `,
  );
  const section = `${heading}\n\n${nested}\n`;
  const existing = ws.exists(file) ? ws.readText(file) : "";
  const headings = [...existing.matchAll(/^## 来自 .+$/gm)];
  const current = headings.find((match) => match[0] === heading);
  let merged: string;
  if (current?.index !== undefined) {
    const start = current.index;
    const end = headings.find((match) => (match.index ?? 0) > start)?.index ?? existing.length;
    merged = `${existing.slice(0, start)}${section}\n${existing.slice(end)}`;
  } else {
    merged = `${existing.trimEnd()}\n\n${section}`.trimStart();
  }
  ws.writeText(file, merged);
  return { file, version: await snapshot(ws, `${actor}写入了 ${date} 的动态简报`) };
}

export interface ProposedBlock {
  title: string;
  start: string;
  end: string;
  module?: string;
  ref?: string;
}

export async function proposeBlock(ws: Workspace, input: ProposedBlock, actor: string, now = new Date()) {
  const date = localDate(now, ws.timeZone());
  const current = parseFrontmatter<TodayPlan>(ws.readText("NOW.md"));
  const parsed = current.data.date === date ? current : { data: { date, blocks: [] } as TodayPlan, body: "" };
  if (input.end <= input.start) throw new KaituError("结束时间必须晚于开始时间", "BAD_ARGS");
  const block = { ...input, id: ulid(), kind: "proposal" as const, status: "pending" as const };
  parsed.data.blocks.push(block);
  const data = { ...parsed.data, generated_at: isoInZone(now, ws.timeZone()) };
  if (!schemas().builtin("now.schema.json")(data)) throw new KaituError("日程建议不合法", "BAD_ARGS");
  ws.writeText("NOW.md", stringifyFrontmatter(data, parsed.body));
  return { block, version: await snapshot(ws, `${actor}提出了日程建议：${block.title}`) };
}
