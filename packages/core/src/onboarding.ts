import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, isAbsolute, join, resolve } from "node:path";
import { z } from "zod";
import { templateDir } from "./assets.js";
import type { CalendarSubscription } from "./calendar.js";
import { type ImportResult, listChatFiles, readChat } from "./chats.js";
import { localStateRoot } from "./drive.js";
import { KaituError } from "./errors.js";
import { parseFrontmatter, stringifyFrontmatter } from "./frontmatter.js";
import { type GithubProblem, bindGithub, parseGithubRepo, projectGithub } from "./github.js";
import { batchSnapshot, history, snapshot } from "./history.js";
import type { BatchImportResult } from "./importers/batch.js";
import { captureNote, findInboxNote, noteMetadata } from "./inbox-notes.js";
import { type Memory, type MemoryInput, type MemoryType, importMemories, listMemories } from "./memory.js";
import { type ProjectInput, createProject, driveProjects, listProjects, projectVersion } from "./projects.js";
import { updateRecord } from "./records.js";
import { schemas } from "./schema.js";
import { type Task, addTask, listTasks } from "./tasks.js";
import { isoInZone } from "./time.js";
import { type ImportSource, discardUpload, importUpload, stageUpload } from "./ui-imports.js";
import { type ModuleStatus, readWorkbench } from "./workbench.js";
import { type Workspace, stateDirectory } from "./workspace.js";

export const ONBOARDING = {
  welcome: {
    title: "让 AI 持续了解你，把想改变的事变成能推进、能查回的个人进度",
    first: "说出想改变的一件事",
    firstDescription: "直接写，或粘贴一段和 AI 聊过的对话",
  },
  matter: {
    entry: "说出想改变的一件事",
    question: "最近有什么想改变，却一直没推进？",
    examples: [
      { title: "吃饭和训练总坚持不了", text: "我想吃得健康点、每周练三次，但每次坚持不到两周就断了。" },
      {
        title: "不想再做现在的工作又不知道能做什么",
        text: "现在的工作做了四年，越来越没意思，但不知道自己还能做什么。",
      },
      {
        title: "六周内做完作品集",
        text: `我：我想六周内做完作品集，转岗去做产品设计。
ChatGPT：可以先挑 2–3 个最能体现你解决问题能力的项目，每个写清背景、你的决策和结果。
ChatGPT：建议每周固定两个晚上推进，第一周先选项目、列出缺的材料。
我：我手上有 4 个项目，其中「门店排班」那个还缺上线后的数据。
ChatGPT：那可以先选另外两个，排班项目等补到数据再加。`,
      },
    ],
  },
  steps: ["带来一件事", "先管哪些", "接上数据", "选一个 AI"],
  ais: [
    {
      id: "chatgpt",
      name: "ChatGPT",
      hint: "再到「设置 → 个性化 → 记忆 → 管理」，把列表也复制过来，ChatGPT 有时会漏掉几条。",
    },
    { id: "claude", name: "Claude", hint: "开了记忆的话，把「设置」里的记忆内容也一起复制过来。" },
    { id: "gemini", name: "Gemini", hint: "把「保存的信息」页面里的内容也一起复制过来。" },
    { id: "doubao", name: "豆包", hint: "开了记忆的话，把设置里的记忆列表也一起复制过来。" },
    { id: "other", name: "其他", hint: "任何 AI 都可以，回答格式对不上也没关系，对不上的行会原样留着。" },
  ],
  prompt: `请把你记住的关于我的所有信息完整列出来，尽量保持原文，不要总结或省略。包括：
1. 你保存的记忆条目
2. 我设置的自定义指令或个性化偏好
3. 你从我们的对话里了解到的我的情况：工作、目标、健康、作息、兴趣、正在做的项目、重要的人
按下面的格式输出，每条一行：
[类别] 内容 （如果知道记下的时间，写在最后）`,
  categories: {
    偏好: ["preference", "偏好和规则"],
    指令: ["preference", "偏好和规则"],
    preference: ["preference", "偏好和规则"],
    人物: ["person", "重要的人"],
    person: ["person", "重要的人"],
    事实: ["fact", "事实"],
    fact: ["fact", "事实"],
    决定: ["decision", "决定"],
    决策: ["decision", "决定"],
    decision: ["decision", "决定"],
    背景: ["context", "背景"],
    context: ["context", "背景"],
    工作: ["context", "工作"],
    项目: ["context", "在做的事"],
    目标: ["context", "目标"],
    健康: ["context", "健康"],
    作息: ["context", "健康"],
    兴趣: ["preference", "兴趣"],
    地点: ["fact", "地点"],
  },
  starts: [
    {
      id: "me",
      title: "了解自己的现状",
      summary: "把散在各处的情况放在一起，攒一段时间再看变化",
      sources: ["mail"],
      module: "me",
      next: "搬来记忆，补充自己的现状",
    },
    {
      id: "projects",
      title: "推进手上的项目",
      summary: "记下在做的事，AI 帮你盯里程碑和下一步",
      sources: ["projects"],
      module: "projects",
      next: "接上一个项目，写下下一步",
    },
    {
      id: "health",
      title: "吃好、睡好、练好",
      summary: "睡眠、训练、饮食和体检放在一起看",
      sources: ["health"],
      module: "health",
      next: "导入健康数据或记一餐、一次训练",
    },
    {
      id: "finance",
      title: "管好钱",
      summary: "账单、持仓和资产，一眼看到钱去了哪里",
      sources: ["finance", "mail"],
      module: "finance",
      next: "导入账单或持仓",
    },
    {
      id: "calendar",
      title: "把日程排明白",
      summary: "接上日历，AI 每天早上帮你排今天",
      sources: ["calendar"],
      module: "calendar",
      next: "导入日历，安排今天",
    },
    {
      id: "explore",
      title: "想清楚一个方向",
      summary: "比如要不要换城市、换工作，先写问题再慢慢试",
      sources: [],
      module: "explore",
      next: "记下一个想探索的问题",
    },
    {
      id: "news",
      title: "每天看点有用的资讯",
      summary: "只看和你在做的事有关的",
      sources: ["news"],
      module: "feed",
      next: "写下关注方向",
    },
  ],
  sources: [
    {
      id: "calendar",
      title: "日历",
      description: "订阅 Google 日历、iCloud 或 Outlook 的 ICS 地址，自动更新日程。",
      action: "添加日历订阅",
      target: "calendar",
      available: true,
    },
    {
      id: "health",
      title: "Apple 健康",
      description: "iPhone「健康」→ 右上角头像 → 导出所有健康数据，把压缩包导入。",
      action: "选择导出文件",
      target: "import:apple-health",
      available: true,
    },
    {
      id: "finance",
      title: "账单与持仓",
      description: "导入已有适配器支持的账单或持仓 CSV，先预览再确认。",
      action: "选择账单文件",
      target: "finance",
      available: true,
    },
    {
      id: "projects",
      title: "项目",
      description: "接上本机文件夹或 GitHub 仓库，确认后建立项目。",
      action: "选择项目",
      target: "setup:projects",
      available: true,
    },
    {
      id: "mail",
      title: "邮件和聊天",
      description: "在「AI 与连接」里接上邮箱或聊天账号，接收摘录与原文链接。",
      action: "设置邮件和聊天",
      target: "connections",
      available: true,
    },
    {
      id: "news",
      title: "关注方向",
      description: "写几个你关心的方向，比如「独立开发」「东南亚生活」。",
      action: "写下方向",
      target: "setup:news",
      available: true,
    },
  ],
  aiChoices: [
    {
      id: "builtin",
      title: "用开图里的「问问」",
      description: "填一个 AI 服务的 API Key（DeepSeek、OpenAI、Claude、Gemini、Kimi、智谱等都可以）",
      target: "ask",
    },
    {
      id: "mine",
      title: "在原来的 AI 里继续",
      description: "进入「AI 与连接」，设置你已有的 AI",
      target: "connections",
    },
    { id: "none", title: "先不用 AI", description: "随手记和导入都能用，等你连上再整理", target: "today" },
  ],
  checklist: {
    matter: "带来一件事并采纳第一个下一步",
    memory: "让开图认识你（可选）",
    starts: "选你想先管的事",
    sources: "接上数据",
    ai: "选一个 AI 帮你整理",
    plan: "拿到第一份今天计划",
    sourcePrefix: "接上",
    action: "去做",
  },
} as const;

export type OnboardingStart = (typeof ONBOARDING.starts)[number]["id"];
export type OnboardingSource = (typeof ONBOARDING.sources)[number]["id"];
export type OnboardingAi = (typeof ONBOARDING.ais)[number]["id"];
export interface OnboardingChoices {
  seen?: boolean;
  starts?: OnboardingStart[];
  skipped?: (OnboardingSource | "memory" | "ai" | "plan")[];
  memoryAi?: OnboardingAi;
  aiChoice?: (typeof ONBOARDING.aiChoices)[number]["id"];
}
export interface LocalOnboardingChoices {
  seenAt?: string;
  starts?: OnboardingStart[];
  skipped?: (OnboardingSource | "memory" | "ai" | "plan")[];
  memoryAi?: OnboardingAi;
  aiChoice?: "builtin" | "mine" | "none";
}
export interface OnboardingSourceInfo {
  id: string;
  title: string;
  description: string;
  action: string;
  target: string;
  available: boolean;
}
export interface OnboardingContent {
  welcome: { title: string; first: string; firstDescription: string };
  matter: { entry: string; question: string; examples: readonly { title: string; text: string }[] };
  steps: readonly string[];
  ais: readonly { id: string; name: string; hint: string }[];
  prompt: string;
  categories: Record<string, readonly string[]>;
  starts: readonly {
    id: string;
    title: string;
    summary: string;
    sources: readonly string[];
    module: string;
    next: string;
  }[];
  sources: readonly OnboardingSourceInfo[];
  aiChoices: readonly { id: string; title: string; description: string; target: string }[];
  checklist: {
    matter: string;
    memory: string;
    starts: string;
    sources: string;
    ai: string;
    plan: string;
    sourcePrefix: string;
    action: string;
  };
}
export interface OnboardingStatus {
  content: OnboardingContent;
  choices: LocalOnboardingChoices | null;
  showGuide: boolean;
  hasUserData: boolean;
  sources: readonly (OnboardingSourceInfo & { done: boolean; skipped: boolean })[];
  next: OnboardingNext | null;
  draft: OnboardingMatter | null;
  checklist: {
    items: {
      id: string;
      title: string;
      done: boolean;
      skipped: boolean;
      disabled: boolean;
      action: { kind: string; target: string; label: string };
    }[];
    completed: number;
    total: number;
    progress: number;
    visible: boolean;
  };
}
export interface OnboardingMemoryPreview {
  token: string;
  candidates: MemoryCandidate[];
}
export interface OnboardingMemoryResult {
  entries: Memory[];
  version: string | null;
  before: string | null;
  skipped: number;
}
export interface OnboardingImportPreview {
  token: string;
  preview: BatchImportResult | ImportResult;
}
export interface OnboardingImportResult {
  result: BatchImportResult | ImportResult;
  before: string | null;
}
export interface OnboardingChoiceResult {
  version: string | null;
  status: OnboardingStatus;
}
export interface OnboardingOptions {
  stateRoot?: string;
}

function localDirectory(ws: Workspace, options: OnboardingOptions): string {
  const key = createHash("sha256").update(realpathSync(ws.root)).digest("hex").slice(0, 24);
  return join(options.stateRoot ?? process.env.KAITU_LOCAL_STATE_DIR ?? localStateRoot(), "onboarding", key);
}
function localRead<T>(ws: Workspace, file: string, fallback: T, options: OnboardingOptions): T {
  const path = join(localDirectory(ws, options), file);
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as T) : fallback;
}
function localWrite(ws: Workspace, file: string, value: unknown, options: OnboardingOptions) {
  const dir = localDirectory(ws, options);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, file);
  const temp = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temp, `${JSON.stringify(value)}\n`, { mode: 0o600 });
  renameSync(temp, path);
}
function aiInfo(ai: unknown) {
  const info = ONBOARDING.ais.find((item) => item.id === ai);
  if (!info) throw new KaituError("请选择记忆来自哪个 AI", "BAD_ARGS");
  return info;
}

export interface MemoryCandidate extends MemoryInput {
  id: string;
  category: string;
  content: string;
  when: string | null;
  raw: boolean;
  original: string;
}
const withoutPrefix = (line: string) => line.replace(/^(?:[-*+]\s+|\d+[.)、]\s*)/, "").trim();

export function parseMemoryPaste(
  text: string,
  existing: readonly Pick<MemoryInput, "text">[] = [],
): MemoryCandidate[] {
  if (typeof text !== "string") throw new KaituError("请粘贴记忆文本", "BAD_ARGS");
  const seen = new Set(existing.map((entry) => withoutPrefix(entry.text.trim())));
  return text.split(/\r?\n/).flatMap((line, index) => {
    const original = line.trim();
    if (!original) return [];
    const match = /^\[([^\]]+)\]\s*(.+)$/.exec(withoutPrefix(original));
    const category = match?.[1]?.trim();
    let mapping =
      category && Object.hasOwn(ONBOARDING.categories, category)
        ? ONBOARDING.categories[category as keyof typeof ONBOARDING.categories]
        : undefined;
    let body = mapping ? (match?.[2]?.trim() ?? original) : original;
    let time = mapping ? /\s*[（(]([^（）()]+)[）)]$/.exec(body) : null;
    let content = time ? body.slice(0, time.index).trim() : body;
    if (!content) {
      mapping = undefined;
      body = original;
      content = original;
      time = null;
    }
    const raw = !mapping;
    const key = withoutPrefix(body);
    if (seen.has(key)) return [];
    seen.add(key);
    return [
      {
        id: `line-${index + 1}`,
        type: (mapping?.[0] ?? "context") as MemoryType,
        name: content.slice(0, 60),
        text: body,
        content,
        when: time?.[1] ?? null,
        category: mapping?.[1] ?? "其他",
        raw,
        original,
      },
    ];
  });
}

interface MemoryPreview {
  kind: "memory";
  ai: OnboardingAi;
  candidates: MemoryCandidate[];
  expires: number;
}
interface FilePreview {
  kind: "file";
  source: ImportSource;
  file: string;
  name: string;
  preview: BatchImportResult | ImportResult;
  expires: number;
}
export type OnboardingSetupInput =
  | { source: "projects"; project: ProjectInput; github?: string }
  | { source: "news"; keywords: string[] };
export interface OnboardingSetupPreview {
  token: string;
  input: OnboardingSetupInput;
}
export interface OnboardingSetupResult {
  version: string | null;
  before: string | null;
  slug?: string;
  github?: { repo: string; ok: boolean; problem: GithubProblem; error?: string };
}
interface SetupPreview {
  kind: "setup";
  input: OnboardingSetupInput;
  previousFeeds: string | null;
  expires: number;
}
type Preview = MemoryPreview | FilePreview | SetupPreview;
export const onboardingSetupSchema = z.discriminatedUnion("source", [
  z
    .object({
      source: z.literal("projects"),
      github: z.string().trim().min(1).optional(),
      project: z
        .object({
          title: z.string().trim().min(1).max(200),
          kind: z.enum(["work", "personal"]),
          local_only: z.boolean().optional(),
          links: z
            .array(
              z
                .object({
                  path: z.string().min(1),
                  role: z.enum(["manuscript", "repo", "folder"]),
                  include: z.array(z.string().min(1)).optional(),
                })
                .strict(),
            )
            .default([]),
        })
        .strict(),
    })
    .strict()
    .refine((input) => input.project.links.length > 0 || !!input.github),
  z
    .object({
      source: z.literal("news"),
      keywords: z.array(z.string().trim().min(1).max(200)).min(1).max(100),
    })
    .strict(),
]);
export function previewOnboardingSetup(
  ws: Workspace,
  value: OnboardingSetupInput,
  options: OnboardingOptions = {},
): OnboardingSetupPreview {
  const parsed = onboardingSetupSchema.safeParse(value);
  if (!parsed.success) throw new KaituError("请提供项目文件夹、GitHub 仓库或关注方向", "BAD_ARGS");
  const input = parsed.data;
  if (input.source === "projects") {
    if (!ws.exists("projects/module.json")) throw new KaituError("请先升级工作区以启用项目", "BAD_ARGS");
    if (input.github) input.github = parseGithubRepo(input.github);
    for (const link of input.project.links) {
      if (!isAbsolute(link.path) || !existsSync(link.path) || !statSync(link.path).isDirectory())
        throw new KaituError("项目链接必须是本机已有文件夹的绝对路径", "BAD_ARGS");
      link.path = resolve(link.path);
      if (link.include?.some((pattern) => isAbsolute(pattern) || pattern.split("/").includes("..")))
        throw new KaituError("正文范围必须在项目文件夹内", "BAD_ARGS");
    }
  } else input.keywords = [...new Set(input.keywords)];
  const previousFeeds =
    input.source === "news" && ws.exists("feed/feeds.json") ? ws.readText("feed/feeds.json") : null;
  const token = savePreview(
    ws,
    { kind: "setup", input, previousFeeds, expires: Date.now() + 30 * 60000 },
    options,
  );
  return { token, input };
}
export async function confirmOnboardingSetup(
  ws: Workspace,
  token: string,
  options: OnboardingOptions = {},
): Promise<OnboardingSetupResult> {
  const preview = readPreview(ws, token, options);
  if (preview.kind !== "setup") throw new KaituError("不是数据源设置预览", "BAD_ARGS");
  const before = (await history(ws, { limit: 1 }))[0]?.oid ?? null;
  let result: OnboardingSetupResult;
  if (preview.input.source === "projects") {
    const input = preview.input.project;
    const github = preview.input.github;
    input.links ??= [];
    if (!input.links.every((link) => existsSync(link.path) && statSync(link.path).isDirectory()))
      throw new KaituError("项目文件夹已变化，请重新预览", "CONFLICT");
    const existing = listProjects(ws).find(
      (project) =>
        project.title === input.title &&
        project.kind === input.kind &&
        project.local_only === (input.local_only ?? false) &&
        (!github || !project.github || project.github.repo.toLowerCase() === github.toLowerCase()) &&
        JSON.stringify(project.links) === JSON.stringify(input.links),
    );
    result = existing
      ? { slug: existing.slug, version: null, before: input.local_only && driveProjects(ws) ? null : before }
      : {
          ...(await createProject(ws, input)),
          before: input.local_only && driveProjects(ws) ? null : before,
        };
    if (github && result.slug) {
      try {
        const bound = await bindGithub(ws, result.slug, github);
        result.github = {
          repo: bound.repo,
          ok: bound.ok,
          problem: bound.problem,
          ...(bound.ok ? {} : { error: projectGithub(ws, result.slug)?.error ?? "GitHub 同步失败" }),
        };
        result.version = bound.version ?? result.version;
      } catch (error) {
        result.github = {
          repo: github,
          ok: false,
          problem:
            error instanceof KaituError && "problem" in error ? (error.problem as GithubProblem) : "network",
          error: error instanceof Error ? error.message : "GitHub 连接失败",
        };
      }
      result.version =
        (await projectVersion(ws, result.slug, "新手引导：保存项目与 GitHub 连接")) ?? result.version;
    }
  } else {
    const current = ws.exists("feed/feeds.json") ? ws.readText("feed/feeds.json") : null;
    if (current !== preview.previousFeeds) throw new KaituError("关注方向已变化，请重新预览", "CONFLICT");
    const feeds = current ? JSON.parse(current) : { feeds: [], keywords: [], muted: [] };
    if (!Array.isArray(feeds.keywords)) throw new KaituError("关注方向格式不合法", "BAD_ARGS");
    const keywords = [...new Set([...feeds.keywords, ...preview.input.keywords])];
    const changed = keywords.length !== feeds.keywords.length;
    if (changed) ws.writeJson("feed/feeds.json", { ...feeds, keywords });
    result = { before, version: changed ? await snapshot(ws, "新手引导：保存关注方向") : null };
  }
  if (!result.github || result.github.ok) cancelOnboardingPreview(ws, token, options);
  return result;
}
function previewFile(token: string) {
  if (typeof token !== "string" || !/^[a-f0-9-]{36}$/.test(token))
    throw new KaituError("无效的预览", "BAD_ARGS");
  return `preview-${token}.json`;
}
function readPreview(ws: Workspace, token: string, options: OnboardingOptions): Preview {
  const preview = localRead<Preview | null>(ws, previewFile(token), null, options);
  if (!preview || preview.expires < Date.now()) {
    if (preview) cancelOnboardingPreview(ws, token, options);
    throw new KaituError("预览已过期，请重新预览", "CONFLICT");
  }
  return preview;
}
function savePreview(ws: Workspace, value: Preview, options: OnboardingOptions) {
  const dir = localDirectory(ws, options);
  if (existsSync(dir))
    for (const file of readdirSync(dir)) {
      const token = /^preview-([a-f0-9-]{36})\.json$/.exec(file)?.[1];
      if (token && localRead<Preview>(ws, file, value, options).expires < Date.now())
        cancelOnboardingPreview(ws, token, options);
    }
  const token = randomUUID();
  localWrite(ws, previewFile(token), value, options);
  return token;
}
export function previewOnboardingMemory(
  ws: Workspace,
  text: string,
  ai: OnboardingAi,
  options: OnboardingOptions = {},
): OnboardingMemoryPreview {
  aiInfo(ai);
  const candidates = parseMemoryPaste(text, listMemories(ws));
  const token = savePreview(
    ws,
    { kind: "memory", ai, candidates, expires: Date.now() + 30 * 60000 },
    options,
  );
  return { token, candidates };
}
export async function confirmOnboardingMemory(
  ws: Workspace,
  token: string,
  selected: string[],
  options: OnboardingOptions = {},
): Promise<OnboardingMemoryResult> {
  const preview = readPreview(ws, token, options);
  if (
    preview.kind !== "memory" ||
    !Array.isArray(selected) ||
    selected.some((id) => !preview.candidates.some((item) => item.id === id))
  )
    throw new KaituError("确认范围不在预览内", "BAD_ARGS");
  const existing = new Set(listMemories(ws).map((entry) => withoutPrefix(entry.text.trim())));
  const inputs = preview.candidates
    .filter((entry) => selected.includes(entry.id) && !existing.has(withoutPrefix(entry.text)))
    .map(({ type, name, text }) => ({ type, name, text, source: `从 ${aiInfo(preview.ai).name} 搬来` }));
  const before = (await history(ws, { limit: 1 }))[0]?.oid ?? null;
  const result = await importMemories(ws, inputs, {
    by: `import:${preview.ai}`,
    actor: `从 ${aiInfo(preview.ai).name} 搬来：`,
  });
  cancelOnboardingPreview(ws, token, options);
  return { ...result, before, skipped: new Set(selected).size - inputs.length };
}
export function cancelOnboardingPreview(ws: Workspace, token: string, options: OnboardingOptions = {}) {
  const file = previewFile(token);
  const preview = localRead<Preview | null>(ws, file, null, options);
  if (preview?.kind === "file") discardUpload(ws, preview.file);
  rmSync(join(localDirectory(ws, options), file), { force: true });
}
export async function previewOnboardingImport(
  ws: Workspace,
  source: ImportSource,
  name: string,
  bytes: Uint8Array,
  options: OnboardingOptions = {},
): Promise<OnboardingImportPreview> {
  if (!["ics", "apple-health", "chatgpt-conversations"].includes(source))
    throw new KaituError("请使用对应数据源的导入预览", "BAD_ARGS");
  const file = stageUpload(ws, source, name, bytes);
  try {
    const preview = await importUpload(ws, source, file, true, name);
    const token = savePreview(
      ws,
      { kind: "file", source, file, name, preview, expires: Date.now() + 30 * 60000 },
      options,
    );
    return { token, preview };
  } catch (error) {
    discardUpload(ws, file);
    throw error;
  }
}
export async function confirmOnboardingImport(
  ws: Workspace,
  token: string,
  options: OnboardingOptions = {},
): Promise<OnboardingImportResult> {
  const preview = readPreview(ws, token, options);
  if (preview.kind !== "file") throw new KaituError("不是文件导入预览", "BAD_ARGS");
  const current = await importUpload(ws, preview.source, preview.file, true, preview.name);
  if (JSON.stringify(current) !== JSON.stringify(preview.preview))
    throw new KaituError("数据已变化，请重新预览", "CONFLICT");
  const before = (await history(ws, { limit: 1 }))[0]?.oid ?? null;
  const result = await importUpload(ws, preview.source, preview.file, false, preview.name);
  cancelOnboardingPreview(ws, token, options);
  return { result, before };
}

export function recordOnboardingAiConnection(ws: Workspace, client: string, options: OnboardingOptions = {}) {
  localWrite(ws, "ai.json", { client: client.slice(0, 100), connectedAt: new Date().toISOString() }, options);
}

function hasUserFiles(ws: Workspace): boolean {
  const ignored = new Set([
    ".kaitu",
    ".git",
    ".agents",
    ".claude",
    "AGENTS.md",
    "AGENT-README.md",
    "OVERVIEW.md",
    "ORGANIZER.md",
    ".mcp.json",
    ".gitignore",
    ".DS_Store",
  ]);
  function walk(dir: string): boolean {
    return readdirSync(ws.resolve(dir), { withFileTypes: true }).some((entry) => {
      if (ignored.has(entry.name) || entry.isSymbolicLink() || entry.name.endsWith(".tmp")) return false;
      const file = dir ? `${dir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) return walk(file);
      const template = join(templateDir(), file);
      if (!existsSync(template)) return statSync(ws.resolve(file)).size > 0;
      const text = ws.scanText(file);
      if (text === undefined) return true;
      const normalize = (value: string) =>
        file === "me/rules.md" ? value.replace(/^timezone:.*$/m, "") : value;
      return normalize(text) !== normalize(readFileSync(template, "utf8"));
    });
  }
  return walk("");
}
function hasCollectedMessages(ws: Workspace, dir = "inbox"): boolean {
  if (!ws.exists(dir)) return false;
  return readdirSync(ws.resolve(dir), { withFileTypes: true }).some((entry) => {
    if (entry.isSymbolicLink()) return false;
    const file = `${dir}/${entry.name}`;
    return entry.isDirectory()
      ? hasCollectedMessages(ws, file)
      : entry.isFile() && /^channel-[a-f0-9]{64}\.note\.md$/.test(entry.name);
  });
}
export function onboardingStatus(ws: Workspace, options: OnboardingOptions = {}): OnboardingStatus {
  const choices = localRead<LocalOnboardingChoices | null>(ws, "choices.json", null, options);
  const data = readWorkbench(ws);
  const count = (module: string) =>
    data.modules
      .filter((m) => m.def.id === module)
      .flatMap((m) => Object.keys(m.def.records ?? {}))
      .reduce((n, type) => n + (data.records[type]?.length ?? 0), 0);
  const calendarFile = join(stateDirectory(ws.root), "calendar-subscriptions.json");
  const calendars: CalendarSubscription[] = existsSync(calendarFile)
    ? JSON.parse(readFileSync(calendarFile, "utf8"))
    : [];
  const collected = hasCollectedMessages(ws);
  const sourceData: Record<OnboardingSource, boolean> = {
    calendar: !!data.records.event?.length || calendars.some((subscription) => !!subscription.syncedAt),
    health: count("health") + data.labs.length > 0,
    finance: count("finance") > 0,
    projects: data.projects.some((p) => p.links.length > 0 || !!p.github?.latest),
    mail: collected || listChatFiles(ws).some((file) => readChat(ws, file).messages.length > 0),
    news: data.feeds.feeds.length + data.feeds.keywords.length > 0 || count("feed") > 0,
  };
  const required = new Set(
    (choices?.starts ?? []).flatMap((id) => [
      ...(ONBOARDING.starts.find((item) => item.id === id)?.sources ?? []),
    ]),
  );
  const sources = ONBOARDING.sources
    .filter((source) => required.has(source.id))
    .map((source) => ({
      ...source,
      done: sourceData[source.id],
      skipped: choices?.skipped?.includes(source.id) ?? false,
    }));
  const planText = ws.exists("NOW.md") ? ws.scanText("NOW.md") : undefined;
  const plan = planText ? parseFrontmatter<{ generated_at?: string | null }>(planText).data : {};
  const connected = localRead<{ connectedAt?: string }>(ws, "ai.json", {}, options).connectedAt;
  const ai =
    !!connected || Object.values(data.records).some((rows) => rows.some((row) => row.by === "agent"));
  const adopted = listTasks(ws, { status: "all" }).filter(isOnboardingTask);
  const latest = adopted
    .filter((task) => task.status !== "cancelled")
    .sort((a, b) => b.ts.localeCompare(a.ts) || b.id.localeCompare(a.id))[0];
  const items = [
    {
      id: "matter",
      title: ONBOARDING.checklist.matter,
      done: adopted.length > 0,
      action: { kind: "matter", target: "matter" },
    },
    {
      id: "memory",
      title: ONBOARDING.checklist.memory,
      done: data.memories.length > 0,
      action: { kind: "memory", target: "memory" },
    },
    {
      id: "starts",
      title: ONBOARDING.checklist.starts,
      done: !!choices?.starts?.length,
      action: { kind: "starts", target: "starts" },
    },
    {
      id: "sources",
      title: ONBOARDING.checklist.sources,
      done: !!choices?.starts?.length && sources.every((source) => source.done),
      action: { kind: "source", target: "sources" },
    },
    {
      id: "ai",
      title: ONBOARDING.checklist.ai,
      done: ai || !!plan.generated_at,
      action: { kind: "ai", target: "ai" },
    },
    {
      id: "plan",
      title: ONBOARDING.checklist.plan,
      done:
        !!plan.generated_at ||
        data.now.data.blocks.some((block) => block.status === "confirmed" || block.status === "done"),
      action: { kind: "plan", target: "plan" },
    },
  ].map((item) => ({
    ...item,
    disabled: item.id === "sources" && !choices?.starts?.length,
    action: { ...item.action, label: ONBOARDING.checklist.action },
    skipped: choices?.skipped?.includes(item.id as OnboardingSource | "memory" | "ai" | "plan") ?? false,
  }));
  const completed = items.filter((item) => item.done).length;
  const hasUserData =
    calendars.length > 0 ||
    collected ||
    ws.unavailableFiles().length > 0 ||
    data.projects.length > 0 ||
    Object.values(data.records).some((rows) => rows.length > 0) ||
    hasUserFiles(ws);
  return {
    content: ONBOARDING,
    choices,
    showGuide: !choices && !hasUserData,
    hasUserData,
    sources,
    next: latest ? onboardingNext(ws, latest) : null,
    draft: pendingOnboardingMatter(ws),
    checklist: {
      items,
      completed,
      total: items.length,
      progress: completed / items.length,
      visible: !!choices?.seenAt && completed < items.length,
    },
  };
}

export async function saveOnboardingChoices(
  ws: Workspace,
  input: OnboardingChoices,
  options: OnboardingOptions = {},
): Promise<OnboardingChoiceResult> {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).some((key) => !["seen", "starts", "skipped", "memoryAi", "aiChoice"].includes(key))
  )
    throw new KaituError("引导选择不合法", "BAD_ARGS");
  if (input.seen !== undefined && typeof input.seen !== "boolean")
    throw new KaituError("引导选择不合法", "BAD_ARGS");
  for (const [ids, allowed] of [
    [input.starts, ONBOARDING.starts.map((item) => item.id)],
    [input.skipped, ["memory", "ai", "plan", ...ONBOARDING.sources.map((item) => item.id)]],
  ] as const) {
    if (
      ids !== undefined &&
      (!Array.isArray(ids) || ids.some((id) => !(allowed as readonly string[]).includes(id)))
    )
      throw new KaituError("引导选项不合法", "BAD_ARGS");
  }
  if (input.memoryAi !== undefined) aiInfo(input.memoryAi);
  if (input.aiChoice !== undefined && !ONBOARDING.aiChoices.some((item) => item.id === input.aiChoice))
    throw new KaituError("AI 选项不合法", "BAD_ARGS");
  const edits = [...new Set(input.starts ?? [])].flatMap((id) => {
    const start = ONBOARDING.starts.find((item) => item.id === id);
    if (!start) throw new KaituError("引导选项不合法", "BAD_ARGS");
    const file = `${start.module}/STATUS.md`;
    const doc = ws.exists(file)
      ? parseFrontmatter<ModuleStatus>(ws.readText(file))
      : { data: { updated: null } as ModuleStatus, body: "" };
    if (doc.data.next?.some((item) => item.id === `onboarding-${id}`)) return [];
    doc.data.next = [...(doc.data.next ?? []), { id: `onboarding-${id}`, title: start.next, status: "todo" }];
    doc.data.updated = isoInZone(new Date(), ws.timeZone());
    if (!schemas().builtin("status.schema.json")(doc.data))
      throw new KaituError("模块状态不合法", "INVALID_DOCUMENT");
    return [{ file, doc }];
  });
  for (const { file, doc } of edits) ws.writeText(file, stringifyFrontmatter(doc.data, doc.body));
  const version = edits.length ? await snapshot(ws, "新手引导：选择先管哪些事") : null;
  const previous = localRead<LocalOnboardingChoices>(ws, "choices.json", {}, options);
  const { seen, ...selection } = input;
  const choices = { ...previous, ...selection, ...(seen ? { seenAt: new Date().toISOString() } : {}) };
  if (choices.starts) choices.starts = [...new Set(choices.starts)];
  if (choices.skipped) choices.skipped = [...new Set(choices.skipped)];
  localWrite(ws, "choices.json", choices, options);
  return { version, status: onboardingStatus(ws, options) };
}
export function resetOnboarding(ws: Workspace, options: OnboardingOptions = {}) {
  rmSync(join(localDirectory(ws, options), "choices.json"), { force: true });
  return onboardingStatus(ws, options);
}

export interface OnboardingMatterDraft {
  goal: string;
  current: string;
  next: string;
}
export interface OnboardingPath {
  name: string;
  fit: string;
  unknown: string;
  experiment: string;
}
export interface OnboardingMatterSuggestion extends OnboardingMatterDraft {
  paths?: OnboardingPath[];
}
export interface OnboardingMatter {
  source: string;
  text: string;
  kind: "conversation" | "note";
  draft: OnboardingMatterSuggestion | null;
}
export interface OnboardingNext extends OnboardingMatterDraft {
  kind: "conversation" | "note";
  id: string;
  source: string;
  status: string;
  due: string | null;
  result: string;
  rev: number;
}
export const onboardingMatterSchema = z
  .object({
    goal: z
      .string()
      .trim()
      .min(1)
      .max(2000)
      .regex(/^[^\r\n]+$/),
    current: z
      .string()
      .trim()
      .max(4000)
      .regex(/^[^\r\n]*$/),
    next: z
      .string()
      .trim()
      .min(1)
      .max(2000)
      .regex(/^[^\r\n]+$/),
  })
  .strict();
const pathText = z
  .string()
  .trim()
  .min(1)
  .max(2000)
  .regex(/^[^\r\n]+$/);
export const onboardingPathSchema = z
  .object({ name: pathText, fit: pathText, unknown: pathText, experiment: pathText })
  .strict();
export const onboardingMatterSuggestionSchema = onboardingMatterSchema
  .extend({
    next: z
      .string()
      .trim()
      .max(2000)
      .regex(/^[^\r\n]*$/),
    paths: z.array(onboardingPathSchema).min(2).max(3).optional(),
  })
  .refine((input) => (input.paths ? !input.next : !!input.next), "路径先由用户选择，不预填下一步");
function inputKind(text: string): "conversation" | "note" {
  return /(?:^|\n)\s*(?:[-*>]\s*)?(?:ChatGPT|Claude|Gemini|DeepSeek|豆包|Kimi|通义|助手|assistant|AI|你)\s*[:：]/i.test(
    text,
  )
    ? "conversation"
    : "note";
}
function pathNotes(paths: OnboardingPath[]) {
  return paths
    .map(
      (path, index) =>
        `\n#### 可能路径 ${index + 1}\n名称：${path.name}\n为什么适合：${path.fit}\n还有哪些不清楚：${path.unknown}\n小实验：${path.experiment}\n`,
    )
    .join("");
}
function readPaths(section: string): OnboardingPath[] {
  return section
    .split(/\n#### 可能路径 \d+\n/)
    .slice(1)
    .map((part) => ({
      name: noteLine(part, "名称"),
      fit: noteLine(part, "为什么适合"),
      unknown: noteLine(part, "还有哪些不清楚"),
      experiment: noteLine(part, "小实验"),
    }));
}
const matterId = (source: string) =>
  `onboarding-matter-${createHash("sha256").update(source).digest("hex").slice(0, 20)}`;
function matterNotes(draft: OnboardingMatterDraft) {
  return `当前目标：${draft.goal}\n已知现状：${draft.current}\n`;
}
function noteLine(notes: string, label: string) {
  return (
    notes
      .split("\n")
      .find((line) => line.startsWith(`${label}：`))
      ?.slice(label.length + 1) ?? ""
  );
}
function isOnboardingTask(task: Task): boolean {
  return (
    typeof task.source === "string" &&
    /^inbox\/notes\/\d{4}-\d{2}-\d{2}\/[0-9a-z]{26}\.md$/.test(task.source) &&
    !!noteLine(task.notes ?? "", "当前目标")
  );
}
function onboardingNext(ws: Workspace, task: Task): OnboardingNext {
  let kind: OnboardingMatter["kind"] = "note";
  try {
    kind = readOnboardingMatter(ws, task.source ?? "").kind;
  } catch {}
  return {
    kind,
    id: task.id,
    source: task.source ?? "",
    next: task.title,
    goal: noteLine(task.notes ?? "", "当前目标"),
    current: noteLine(task.notes ?? "", "已知现状"),
    result: noteLine(task.notes ?? "", "完成结果"),
    status: task.status,
    due: task.due ?? null,
    rev: task.rev ?? 1,
  };
}
export function readOnboardingMatter(ws: Workspace, source: string): OnboardingMatter {
  if (typeof source !== "string" || !/^inbox\/notes\/\d{4}-\d{2}-\d{2}\/[0-9a-z]{26}\.md$/.test(source))
    throw new KaituError("请选择已保存的原文记录", "BAD_ARGS");
  const file = findInboxNote(ws, basename(source));
  const text = file ? ws.scanText(file) : undefined;
  if (!text || noteMetadata(text).kind !== "capture") throw new KaituError("原文记录不存在", "NOT_FOUND");
  if (source !== `inbox/notes/${noteMetadata(text).date}/${basename(source)}`)
    throw new KaituError("原文来源与保存记录不一致", "BAD_ARGS");
  const doc = parseFrontmatter<ModuleStatus>(ws.readText("me/STATUS.md"));
  const item = doc.data.next?.find((item) => item.id === matterId(source) && item.status === "proposed");
  const section = doc.body.split(`### ${matterId(source)}\n`)[1]?.split("\n### ")[0] ?? "";
  const paths = readPaths(section);
  const draft = item
    ? {
        goal: noteLine(section, "当前目标"),
        current: noteLine(section, "已知现状"),
        next: paths.length ? "" : item.title,
        ...(paths.length ? { paths } : {}),
      }
    : null;
  const original = parseFrontmatter(text).body;
  return { source, text: original, kind: inputKind(original), draft };
}
function pendingOnboardingMatter(ws: Workspace): OnboardingMatter | null {
  const doc = parseFrontmatter<ModuleStatus>(ws.readText("me/STATUS.md"));
  const item = [...(doc.data.next ?? [])]
    .reverse()
    .find((item) => item.id.startsWith("onboarding-matter-") && item.status === "proposed");
  if (!item?.ref) return null;
  try {
    return readOnboardingMatter(ws, item.ref);
  } catch {
    return null;
  }
}
export async function saveOnboardingMatter(ws: Workspace, text: string): Promise<OnboardingMatter> {
  const result = await captureNote(ws, text);
  return readOnboardingMatter(ws, result.path);
}
export async function draftOnboardingMatter(
  ws: Workspace,
  source: string,
  input: OnboardingMatterSuggestion,
): Promise<OnboardingMatter> {
  readOnboardingMatter(ws, source);
  const parsed = onboardingMatterSuggestionSchema.safeParse(input);
  if (!parsed.success)
    throw new KaituError("请填写当前目标、已知现状和一个下一步，均使用单行文本", "BAD_ARGS");
  const draft = parsed.data;
  const doc = parseFrontmatter<ModuleStatus>(ws.readText("me/STATUS.md"));
  const id = matterId(source);
  if (listTasks(ws, { status: "all" }).some((task) => task.source === source))
    throw new KaituError("这段原文已有采纳的下一步", "CONFLICT");
  doc.data.next = [
    ...(doc.data.next ?? []).filter((item) => item.id !== id),
    { id, title: draft.paths ? "从可能路径中选择一个小实验" : draft.next, status: "proposed", ref: source },
  ];
  doc.data.updated = isoInZone(new Date(), ws.timeZone());
  const section = `### ${id}\n${matterNotes(draft)}${pathNotes(draft.paths ?? [])}`;
  const old = doc.body.indexOf(`### ${id}\n`);
  const end = old < 0 ? -1 : doc.body.indexOf("\n### ", old + 4);
  doc.body =
    old < 0
      ? `${doc.body.trimEnd()}\n\n${section}`
      : `${doc.body.slice(0, old)}${section}${end < 0 ? "" : doc.body.slice(end)}`;
  ws.writeText("me/STATUS.md", stringifyFrontmatter(doc.data, doc.body));
  await snapshot(ws, "AI 整理了一条待核对的下一步");
  return readOnboardingMatter(ws, source);
}
export async function keepOnboardingMatter(ws: Workspace, source: string): Promise<OnboardingMatter> {
  const matter = readOnboardingMatter(ws, source);
  if (!matter.draft) return matter;
  const doc = parseFrontmatter<ModuleStatus>(ws.readText("me/STATUS.md"));
  doc.data.next = (doc.data.next ?? []).filter((item) => item.id !== matterId(source));
  ws.writeText("me/STATUS.md", stringifyFrontmatter(doc.data, doc.body));
  await snapshot(ws, "你只保留了原文，未采纳下一步");
  return readOnboardingMatter(ws, source);
}
export async function adoptOnboardingMatter(
  ws: Workspace,
  source: string,
  input: OnboardingMatterDraft,
  path: OnboardingPath | null = null,
): Promise<OnboardingNext> {
  const matter = readOnboardingMatter(ws, source);
  const parsed = onboardingMatterSchema.safeParse(input);
  if (!parsed.success)
    throw new KaituError("请填写当前目标、已知现状和一个下一步，均使用单行文本", "BAD_ARGS");
  const draft = parsed.data;
  const existing = listTasks(ws, { status: "all" }).find((task) => task.source === source);
  if (existing) return onboardingNext(ws, existing);
  const paths = matter.draft?.paths;
  const selected = onboardingPathSchema.safeParse(path);
  const chosen = paths?.find(
    (item) =>
      selected.success &&
      item.name === selected.data.name &&
      item.fit === selected.data.fit &&
      item.unknown === selected.data.unknown &&
      item.experiment === selected.data.experiment,
  );
  if (paths?.length && !chosen)
    throw new KaituError(
      path ? "路径已经变化，请重新核对" : "请先选一条可能路径，再核对小实验",
      path ? "CONFLICT" : "USER_DECISION",
    );
  const notes =
    matterNotes(draft) +
    (chosen
      ? `所选路径：${chosen.name}\n为什么适合：${chosen.fit}\n还有哪些不清楚：${chosen.unknown}\n原建议小实验：${chosen.experiment}\n`
      : "");
  let task: Task | undefined;
  await batchSnapshot(ws, "你从原文采纳了一个下一步", async () => {
    task = (await addTask(ws, { title: draft.next, source, notes })).record as Task;
    const doc = parseFrontmatter<ModuleStatus>(ws.readText("me/STATUS.md"));
    doc.data.next = (doc.data.next ?? []).filter((item) => item.id !== matterId(source));
    ws.writeText("me/STATUS.md", stringifyFrontmatter(doc.data, doc.body));
  });
  if (!task) throw new KaituError("下一步未保存", "WRITE_FAILED");
  return onboardingNext(ws, task);
}
export async function changeOnboardingNext(
  ws: Workspace,
  id: string,
  rev: number,
  action: string,
  value: string,
): Promise<OnboardingNext> {
  const task = listTasks(ws, { status: "all" }).find((item) => item.id === id && isOnboardingTask(item));
  if (!task) throw new KaituError("下一步不存在", "NOT_FOUND");
  if (task.status !== "open" || (task.rev ?? 1) !== rev)
    throw new KaituError("下一步已变化，请刷新后重试", "CONFLICT");
  if (typeof value !== "string" || !value.trim()) throw new KaituError("请写一句结果或选择日期", "BAD_ARGS");
  let patch: Record<string, unknown>;
  if (action === "complete") {
    if (value.length > 2000 || /[\r\n]/.test(value)) throw new KaituError("请用一句话记录结果", "BAD_ARGS");
    patch = { status: "done", notes: `${task.notes ?? ""}完成结果：${value.trim()}\n` };
  } else if (action === "defer" && /^\d{4}-\d{2}-\d{2}$/.test(value)) patch = { due: value };
  else throw new KaituError("操作或日期不合法", "BAD_ARGS");
  const result = updateRecord(ws, "task", id, patch, { by: "user" });
  await snapshot(ws, action === "complete" ? "你完成下一步并记下结果" : "你调整了下一步的日期");
  return onboardingNext(ws, result.record as Task);
}
