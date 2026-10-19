import { createHash } from "node:crypto";
import { readdirSync } from "node:fs";
import { z } from "zod";
import { normalizeStatus } from "./doc-input.js";
import { readDoing } from "./doing-page.js";
import { KaituError } from "./errors.js";
import { parseFrontmatter, stringifyFrontmatter } from "./frontmatter.js";
import { snapshot } from "./history.js";
import { schemas } from "./schema.js";
import { isoInZone } from "./time.js";
import { ulid } from "./ulid.js";
import type { ModuleStatus } from "./workbench.js";
import type { Workspace } from "./workspace.js";

const short = z.string().trim().min(1).max(500);
const topicId = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .max(100);
export const learningSourceSchema = z
  .object({
    title: short,
    url: z
      .url()
      .refine((url) => /^https?:\/\//i.test(url), "只支持 http/https 来源")
      .optional(),
    text: z
      .string()
      .max(128 * 1024)
      .optional(),
  })
  .strict();
export const startLearningSchema = z
  .object({
    title: short,
    topic: topicId.optional(),
    source: learningSourceSchema.optional(),
  })
  .strict();
export const learningCheckinSchema = z
  .object({
    topic: topicId,
    understanding: z
      .string()
      .trim()
      .max(16 * 1024),
    questions: z
      .string()
      .trim()
      .max(16 * 1024),
    next: z.string().trim().max(500),
    completedNextId: short.optional(),
    completedNextTitle: short.optional(),
    operationId: z.string().trim().min(8).max(100),
  })
  .strict()
  .refine((v) => !v.completedNextId || !!v.completedNextTitle, "完成下一步前请先读取并传入原任务标题")
  .refine(
    (v) => v.understanding || v.questions || v.next || v.completedNextId,
    "请写下一点理解、疑问或下一步",
  );
export type StartLearningInput = z.infer<typeof startLearningSchema>;
export type LearningCheckinInput = z.infer<typeof learningCheckinSchema>;
export interface LearningTopic {
  topic: string;
  title: string;
  notes: string;
  sources: { file: string; title: string; text: string; url?: string }[];
  next: NonNullable<ModuleStatus["next"]>;
}

function directory(topic: string) {
  return `learning/${topicId.parse(topic)}`;
}
function status(ws: Workspace, topic: string) {
  const file = `${directory(topic)}/STATUS.md`;
  if (!ws.exists(file)) throw new KaituError("找不到这个学习主题", "NOT_FOUND");
  const parsed = ws.scanParsed(file, "learning-status", (text) => {
    const parsed = parseFrontmatter(text);
    const value = {
      ...parsed,
      data: normalizeStatus(parsed.data) as unknown as ModuleStatus & { title?: string },
    };
    if (!schemas().builtin("status.schema.json")(value.data))
      throw new KaituError(`状态文件格式不合法：${file}`, "INVALID_DOCUMENT");
    return value;
  });
  if (!parsed) throw new KaituError("主题还没有从云盘下载，请下载后重试", "CLOUD_UNAVAILABLE");
  return parsed;
}
export function readLearning(ws: Workspace, topic: string): LearningTopic {
  const dir = directory(topic);
  const { data, body } = status(ws, topic);
  const sourceDir = `${dir}/sources`;
  const sources = ws.exists(sourceDir)
    ? readdirSync(ws.resolve(sourceDir), { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
        .sort((a, b) => a.name.localeCompare(b.name))
        .flatMap((entry) => {
          const file = `${sourceDir}/${entry.name}`;
          const text = ws.scanText(file);
          return text === undefined
            ? []
            : [
                {
                  file,
                  title: text.match(/^# (.+)$/m)?.[1] ?? entry.name,
                  text,
                  ...(text.match(/^来源：(https?:\/\/\S+)$/m)?.[1]
                    ? { url: text.match(/^来源：(https?:\/\/\S+)$/m)?.[1] }
                    : {}),
                },
              ];
        })
    : [];
  return {
    topic,
    title: data.title ?? body.match(/^# (.+)$/m)?.[1] ?? topic,
    notes: ws.exists(`${dir}/notes.md`) ? ws.readText(`${dir}/notes.md`) : "",
    sources,
    next: data.next ?? [],
  };
}
export function listLearning(ws: Workspace) {
  return readDoing(ws).learning.map((item) => ({
    topic: item.file.split("/")[1] ?? "",
    title: item.title,
    next: item.next,
  }));
}
async function saved(ws: Workspace, topic: string, scheduleVersion?: (message: string) => void) {
  let version: string | null = null;
  let versionError: string | undefined;
  try {
    if (scheduleVersion) scheduleVersion("更新了学习主题");
    else version = await snapshot(ws, "更新了学习主题");
  } catch {
    versionError = "资料已保存，版本记录暂未完成";
  }
  return { ...readLearning(ws, topic), version, ...(versionError ? { versionError } : {}) };
}
export async function startLearning(
  ws: Workspace,
  input: StartLearningInput,
  now = new Date(),
  scheduleVersion?: (message: string) => void,
) {
  const value = startLearningSchema.parse(input);
  const slug = value.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 70)
    .replace(/-$/, "");
  const suffix = createHash("sha256").update(value.title).digest("hex").slice(0, 12);
  let topic = value.topic ?? (slug || `topic-${suffix}`);
  if (!value.topic && ws.exists(`${directory(topic)}/STATUS.md`)) {
    const existing = status(ws, topic);
    const existingTitle = existing.data.title ?? existing.body.match(/^# (.+)$/m)?.[1];
    if (existingTitle && existingTitle.toLowerCase() !== value.title.toLowerCase())
      topic = `${topic}-${suffix}`;
  }
  const dir = directory(topic);
  const file = `${dir}/STATUS.md`;
  if (ws.exists(file))
    status(ws, topic); // Reuse; never replace an existing topic's status or notes.
  else
    ws.writeText(
      file,
      stringifyFrontmatter(
        {
          title: value.title,
          kind: "learning",
          stage: "active",
          updated: isoInZone(now, ws.timeZone()),
          next: [],
        },
        `# ${value.title}\n`,
      ),
    );
  if (value.source) {
    const source = value.source;
    const id = createHash("sha256").update(JSON.stringify(source)).digest("hex").slice(0, 16);
    const path = `${dir}/sources/${id}.md`;
    if (!ws.exists(path))
      ws.writeText(
        path,
        `# ${source.title}\n\n${source.url ? `来源：${source.url}\n\n` : ""}保存于 ${isoInZone(now, ws.timeZone())}\n\n${source.text || "仅保存来源链接，尚未读取原文。"}\n`,
      );
  }
  return saved(ws, topic, scheduleVersion);
}
export async function saveLearningCheckin(
  ws: Workspace,
  input: LearningCheckinInput,
  now = new Date(),
  scheduleVersion?: (message: string) => void,
) {
  const value = learningCheckinSchema.parse(input);
  const { operationId, ...content } = value;
  const inputHash = createHash("sha256").update(JSON.stringify(content)).digest("hex");
  const receipt = `.kaitu/cache/learning-operations/${createHash("sha256").update(operationId).digest("hex")}.json`;
  if (ws.exists(receipt)) {
    const previous = ws.readJson<{ topic: string; inputHash: string }>(receipt);
    if (previous.topic !== value.topic || previous.inputHash !== inputHash)
      throw new KaituError("这次保存编号已用于其他内容，请为新记录使用新编号", "BAD_ARGS");
    return { ...readLearning(ws, value.topic), version: null, replayed: true };
  }
  const dir = directory(value.topic);
  const parsed = status(ws, value.topic);
  const stamp = isoInZone(now, ws.timeZone());
  const next = (parsed.data.next ?? []).map((item) => ({ ...item }));
  if (value.completedNextId) {
    const item = next.find(
      (item) =>
        item.id === value.completedNextId &&
        item.title === value.completedNextTitle &&
        ["todo", "proposed"].includes(item.status),
    );
    if (!item) throw new KaituError("这条下一步已变化，请重新读取后选择", "BAD_ARGS");
    item.status = "done";
  }
  if (
    value.next &&
    !next.some((item) => item.title === value.next && ["todo", "proposed"].includes(item.status))
  )
    next.unshift({ id: ulid(now.getTime()), title: value.next, status: "todo" });
  const notesFile = `${dir}/notes.md`;
  const previous = ws.exists(notesFile) ? ws.readText(notesFile) : "";
  const entry = [
    value.understanding && `### 我的理解\n\n${value.understanding}`,
    value.questions && `### 还没弄懂\n\n${value.questions}`,
    value.next && `### 下一步\n\n${value.next}`,
    value.completedNextId && `完成了下一步：${next.find((item) => item.id === value.completedNextId)?.title}`,
  ]
    .filter(Boolean)
    .join("\n\n");
  ws.writeText(notesFile, `${previous.trimEnd()}\n\n## ${stamp}\n\n${entry}\n`.trimStart());
  ws.writeText(
    `${dir}/STATUS.md`,
    stringifyFrontmatter({ ...parsed.data, updated: stamp, next }, parsed.body),
  );
  ws.writeJson(receipt, { topic: value.topic, inputHash }, { internal: true });
  return { ...(await saved(ws, value.topic, scheduleVersion)), replayed: false };
}
