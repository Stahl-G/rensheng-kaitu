import fs from "node:fs";
import { homedir } from "node:os";
import { dirname, extname, isAbsolute, join, matchesGlob, relative, resolve } from "node:path";
import { strFromU8, unzipSync } from "fflate";
import git from "isomorphic-git";
import { SaxesParser } from "saxes";
import { writeAgentsMd } from "./agents-md.js";
import { templateDir } from "./assets.js";
import { KaituError } from "./errors.js";
import { parseFrontmatter, stringifyFrontmatter } from "./frontmatter.js";
import { projectGithub, syncGithub } from "./github.js";
import { batchSnapshot, snapshot } from "./history.js";
import { type ModuleDef, findRecordType, recordFileFor } from "./modules.js";
import { batchOverview } from "./overview.js";
import { type By, type StoredRecord, addRecord, readRecords, updateRecord } from "./records.js";
import { schemas } from "./schema.js";
import { isoInZone, localDate, localMonth, localTimeToInstant, parseTs } from "./time.js";
import { ulid } from "./ulid.js";
import type { ModuleStatus } from "./workbench.js";
import { Workspace, stateDirectory } from "./workspace.js";

export interface ProjectLink {
  path: string;
  role: "manuscript" | "repo" | "folder";
  include?: string[];
}
export interface ProjectStatus extends ModuleStatus {
  title: string;
  kind: "work" | "personal";
  stage: "idea" | "active" | "paused" | "done";
  local_only: boolean;
  links: ProjectLink[];
  github?: { repo: string };
  blocked?: unknown[];
}
export type ProjectInput = Pick<ProjectStatus, "title" | "kind"> &
  Partial<Pick<ProjectStatus, "local_only" | "links">>;

export function driveProjects(ws: Workspace): boolean {
  return stateDirectory(ws.root, ws.isICloud) !== join(ws.root, ".kaitu");
}
function slugCheck(slug: string) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || ["data", "projects"].includes(slug)) {
    throw new KaituError("项目 slug 不合法", "BAD_ARGS");
  }
}
export function projectDirectory(ws: Workspace, slug: string): string {
  slugCheck(slug);
  const local = `.kaitu/local-projects/${slug}`;
  return ws.exists(`${local}/STATUS.md`) ? local : `projects/${slug}`;
}
function checkStatus(data: ProjectStatus) {
  if (!schemas().builtin("status.schema.json")(data) || !data.title || !data.kind || !data.stage) {
    throw new KaituError("项目状态格式不合法", "INVALID_DOCUMENT");
  }
}
export function readProject(ws: Workspace, slug: string) {
  const dir = projectDirectory(ws, slug);
  if (!ws.exists(`${dir}/STATUS.md`)) throw new KaituError("找不到项目", "NOT_FOUND");
  const parsed = parseFrontmatter<ProjectStatus>(ws.readText(`${dir}/STATUS.md`));
  parsed.data.local_only ??= false;
  parsed.data.links ??= [];
  checkStatus(parsed.data);
  return { slug, dir, ...parsed, log: ws.exists(`${dir}/log.md`) ? ws.readText(`${dir}/log.md`) : "" };
}
export function publicProject(ws: Workspace, slug: unknown): boolean {
  if (typeof slug !== "string") return false;
  try {
    return !readProject(ws, slug).data.local_only;
  } catch {
    return false;
  }
}
export function assertPublicProject(ws: Workspace, slug: unknown): void {
  if (!publicProject(ws, slug)) throw new KaituError("找不到可共享项目", "NOT_FOUND");
}

// 本机项目复用同一套记录修订与版本机制，根目录不在 Drive 内。
function privateStore(ws: Workspace): Workspace {
  const root = ws.resolve(".kaitu/local-projects", { internal: true });
  fs.mkdirSync(root, { recursive: true });
  const store = new Workspace(root);
  store.timeZone = () => ws.timeZone();
  if (!store.exists("projects/module.json")) {
    store.writeText(
      "projects/module.json",
      fs.readFileSync(join(templateDir(), "projects/module.json"), "utf8"),
    );
  }
  const module = store.readJson<ModuleDef>("projects/module.json");
  if (!module.records?.github_snapshot) {
    const template = JSON.parse(fs.readFileSync(join(templateDir(), "projects/module.json"), "utf8"));
    module.records = { ...module.records, github_snapshot: template.records.github_snapshot };
    store.writeJson("projects/module.json", module);
  }
  return store;
}
export function metricStore(ws: Workspace, data: ProjectStatus, readonly = false): Workspace {
  if (!driveProjects(ws) || !data.local_only) return ws;
  if (!readonly) return privateStore(ws);
  const store = new Workspace(ws.resolve(".kaitu/local-projects", { internal: true }), { maintain: false });
  store.timeZone = () => ws.timeZone();
  return store;
}
export async function projectVersion(ws: Workspace, slug: string, message: string, now = new Date()) {
  const { data } = readProject(ws, slug);
  return snapshot(driveProjects(ws) && data.local_only ? privateStore(ws) : ws, message, now);
}
function slugs(ws: Workspace): string[] {
  const names = new Set<string>();
  for (const base of ["projects", ".kaitu/local-projects"]) {
    if (!ws.exists(base)) continue;
    for (const entry of fs.readdirSync(ws.resolve(base, { internal: true }), { withFileTypes: true })) {
      if (
        entry.isDirectory() &&
        !entry.name.startsWith(".") &&
        !ws.conflictCopy(`${base}/${entry.name}`) &&
        ws.exists(`${base}/${entry.name}/STATUS.md`) &&
        ws.scanText(`${base}/${entry.name}/STATUS.md`) !== undefined
      ) {
        names.add(entry.name);
      }
    }
  }
  return [...names].sort();
}
export function projectStatusFiles(ws: Workspace, publicOnly = false) {
  return slugs(ws).flatMap((slug) => {
    const dir = projectDirectory(ws, slug);
    try {
      const { data } = parseFrontmatter<Partial<ProjectStatus>>(ws.readText(`${dir}/STATUS.md`));
      return publicOnly && data.local_only
        ? []
        : [{ file: `${dir}/STATUS.md`, module: data.title || "项目" }];
    } catch {
      return publicOnly ? [] : [{ file: `${dir}/STATUS.md`, module: "项目" }];
    }
  });
}
export function listProjects(ws: Workspace, options: { publicOnly?: boolean; now?: Date } = {}) {
  const now = options.now ?? new Date();
  const today = localDate(now, ws.timeZone());
  const from = new Date(Date.parse(`${today}T12:00:00Z`) - 6 * 86400000).toISOString().slice(0, 10);
  return slugs(ws).flatMap((slug) => {
    const project = readProject(ws, slug);
    if (options.publicOnly && project.data.local_only) return [];
    const store =
      driveProjects(ws) && project.data.local_only
        ? new Workspace(ws.resolve(".kaitu/local-projects", { internal: true }))
        : ws;
    if (store !== ws) store.timeZone = () => ws.timeZone();
    const metrics = store.exists("projects/module.json")
      ? readRecords(store, "project_metric").filter(
          (r) => r.project === slug && Date.parse(r.ts) <= now.getTime(),
        )
      : [];
    const words = metrics.filter((r) => r.kind === "words");
    const recentWords = words.filter((r) => localDate(parseTs(r.ts), ws.timeZone()) >= from);
    const baseline =
      words.filter((r) => localDate(parseTs(r.ts), ws.timeZone()) < from).at(-1) ?? recentWords[0];
    const last = words.at(-1);
    return [
      {
        slug,
        title: project.data.title,
        kind: project.data.kind,
        stage: project.data.stage,
        local_only: project.data.local_only,
        links: project.data.links,
        progress: project.data.progress,
        next: project.data.next ?? [],
        github: projectGithub(ws, slug, now),
        completion: project.data.progress
          ? {
              done: project.data.progress.current,
              total: project.data.progress.target,
              basis: "progress" as const,
            }
          : (() => {
              const tasks = (project.data.next ?? []).filter(
                (item) => !["proposed", "skipped"].includes(item.status),
              );
              return tasks.length
                ? {
                    done: tasks.filter((item) => item.status === "done").length,
                    total: tasks.length,
                    basis: "tasks" as const,
                  }
                : null;
            })(),
        lastLogDate:
          [...project.log.matchAll(/^## (\d{4}-\d{2}-\d{2})\s*$/gm)]
            .map((m) => m[1] as string)
            .sort()
            .at(-1) ?? null,
        recent7: {
          daily: Array.from({ length: 7 }, (_, i) => {
            const date = new Date(Date.parse(`${from}T12:00:00Z`) + i * 86400000).toISOString().slice(0, 10);
            const current = words.filter((r) => localDate(parseTs(r.ts), ws.timeZone()) === date).at(-1);
            const previous = words.filter((r) => localDate(parseTs(r.ts), ws.timeZone()) < date).at(-1);
            const commits = metrics.filter(
              (r) => r.kind === "commits" && localDate(parseTs(r.ts), ws.timeZone()) === date,
            );
            return {
              date,
              words: current && previous ? Number(current.value) - Number(previous.value) : null,
              commits: commits.length ? commits.reduce((sum, r) => sum + Number(r.value), 0) : null,
            };
          }),
          words:
            last && baseline && last !== baseline && recentWords.length
              ? Number(last.value) - Number(baseline.value)
              : null,
          commits: metrics
            .filter((r) => r.kind === "commits" && localDate(parseTs(r.ts), ws.timeZone()) >= from)
            .reduce((total, r) => total + Number(r.value), 0),
          commitsRecorded: metrics.some(
            (r) => r.kind === "commits" && localDate(parseTs(r.ts), ws.timeZone()) >= from,
          ),
        },
        words: last ? Number(last.value) : null,
        body: project.body,
        log: project.log,
        file: `${project.dir}/STATUS.md`,
        metricFiles: [
          ...new Set(
            metrics.map((r) => {
              const file = recordFileFor(
                findRecordType(store, "project_metric"),
                localMonth(parseTs(r.ts), ws.timeZone()),
              );
              return store === ws ? file : `.kaitu/local-projects/${file}`;
            }),
          ),
        ],
      },
    ];
  });
}
export async function createProject(ws: Workspace, input: ProjectInput) {
  if (!ws.exists("projects/module.json")) {
    ws.writeText(
      "projects/module.json",
      fs.readFileSync(join(templateDir(), "projects/module.json"), "utf8"),
    );
    const config = ws.readJson<{ modules: string[] }>(".kaitu/config.json");
    config.modules = [...new Set([...config.modules, "projects"])];
    ws.writeJson(".kaitu/config.json", config, { internal: true });
    writeAgentsMd(ws);
  }
  const data: ProjectStatus = {
    ...input,
    title: input.title.trim(),
    stage: "active",
    local_only: input.local_only ?? false,
    links: input.links ?? [],
    updated: isoInZone(new Date(), ws.timeZone()),
    next: [],
  };
  checkStatus(data);
  const base =
    data.title
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .replace(/-+/g, "-") || ulid().slice(-8).toLowerCase();
  let slug = ["data", "projects"].includes(base) ? `${base}-project` : base;
  while (slugs(ws).includes(slug)) slug = `${base}-${ulid().slice(-8).toLowerCase()}`;
  const dir = driveProjects(ws) && data.local_only ? `.kaitu/local-projects/${slug}` : `projects/${slug}`;
  await batchOverview(ws, async () => {
    ws.writeText(`${dir}/STATUS.md`, stringifyFrontmatter(data, `# ${data.title}\n`), { internal: true });
    ws.writeText(`${dir}/notes.md`, "# 背景、要点、相关人\n", { internal: true });
    ws.writeText(`${dir}/log.md`, "# 项目进展\n", { internal: true });
  });
  return { slug, version: await projectVersion(ws, slug, `你新建了项目：${data.title}`) };
}
function validDate(date: string) {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !Number.isFinite(Date.parse(date)) ||
    new Date(date).toISOString().slice(0, 10) !== date
  ) {
    throw new KaituError("日期不合法", "BAD_ARGS");
  }
}
function sortLog(log: string) {
  const headings = [...log.matchAll(/^## \d{4}-\d{2}-\d{2}[^\S\n]*\r?$/gm)];
  if (!headings.length) return log;
  const sections = headings.map((match, i) => ({
    date: match[0].slice(3, 13),
    text: log.slice(match.index, headings[i + 1]?.index ?? log.length).trimEnd(),
  }));
  return `${log.slice(0, headings[0]?.index).trimEnd()}\n\n${sections
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((section) => section.text)
    .join("\n\n")}\n`;
}
export function appendLog(ws: Workspace, slug: string, text: string, date: string, marker?: string) {
  validDate(date);
  const project = readProject(ws, slug);
  const heading = `## ${date}`;
  const entry = `- ${text.trim().replace(/\n/g, "\n  ")}${marker ? ` <!-- sync:${marker} -->` : ""}`;
  let log = project.log;
  const start = log.indexOf(`\n${heading}\n`);
  if (start < 0) log = `${log.trimEnd()}\n\n${heading}\n\n${entry}\n`;
  else {
    const end = log.indexOf("\n## ", start + 1);
    const sectionEnd = end < 0 ? log.length : end;
    let section = log.slice(start, sectionEnd);
    const lines = section.split("\n");
    const index = marker ? lines.findIndex((line) => line.endsWith(`<!-- sync:${marker} -->`)) : -1;
    if (index >= 0) lines[index] = entry;
    else lines.push(entry);
    section = `${lines.join("\n").trimEnd()}\n`;
    log = log.slice(0, start) + section + log.slice(sectionEnd);
  }
  ws.writeText(`${project.dir}/log.md`, sortLog(log), { internal: true });
}
export async function logProject(
  ws: Workspace,
  slug: string,
  text: string,
  options: { date?: string; by: By },
) {
  if (!text.trim()) throw new KaituError("进展不能为空", "BAD_ARGS");
  return batchOverview(ws, async () => {
    appendLog(ws, slug, text, options.date ?? localDate(new Date(), ws.timeZone()));
    const project = readProject(ws, slug);
    project.data.updated = isoInZone(new Date(), ws.timeZone());
    ws.writeText(`${project.dir}/STATUS.md`, stringifyFrontmatter(project.data, project.body), {
      internal: true,
    });
    return {
      version: await projectVersion(
        ws,
        slug,
        `${options.by === "user" ? "你" : "Agent "}记录了项目进展：${project.data.title}`,
      ),
    };
  });
}

function moveDirectory(ws: Workspace, source: string, target: string) {
  const from = ws.resolve(source, { internal: true });
  const to = ws.resolve(target, { internal: true });
  if (fs.existsSync(to)) throw new KaituError("项目目标目录已存在", "CONFLICT");
  fs.mkdirSync(dirname(to), { recursive: true });
  try {
    fs.renameSync(from, to);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
    fs.cpSync(from, to, { recursive: true, errorOnExist: true, force: false });
    fs.rmSync(from, { recursive: true });
  }
}
function transferMetrics(source: Workspace, target: Workspace, slug: string) {
  for (const dir of ["projects/data/metrics", "projects/data/github"])
    transferProjectRecords(source, target, slug, dir);
}
function transferProjectRecords(source: Workspace, target: Workspace, slug: string, dir: string) {
  if (!source.exists(dir)) return;
  const files = fs.readdirSync(source.resolve(dir)).filter((file) => /^\d{4}-\d{2}\.jsonl$/.test(file));
  const ids = new Set<string>();
  for (const file of files) {
    for (const line of source.readText(`${dir}/${file}`).split("\n").filter(Boolean)) {
      const row = JSON.parse(line);
      if (row.project === slug) ids.add(row.id);
    }
  }
  for (const file of files) {
    const path = `${dir}/${file}`;
    const rows = source.readText(path).split("\n").filter(Boolean);
    const moving = rows.filter((line) => ids.has(JSON.parse(line).id));
    if (!moving.length) continue;
    // 重试时按完整行去重，保留修订版本与 id。
    const existing = target.exists(path) ? target.readText(path).split("\n").filter(Boolean) : [];
    target.writeText(path, `${[...new Set([...existing, ...moving])].join("\n")}\n`);
    const remaining = rows.filter((line) => !ids.has(JSON.parse(line).id));
    if (remaining.length) source.writeText(path, `${remaining.join("\n")}\n`);
    else fs.rmSync(source.resolve(path));
  }
}
export function relocateProjects(ws: Workspace, toPrivate: boolean) {
  for (const slug of slugs(ws)) {
    const project = readProject(ws, slug);
    if (!project.data.local_only) continue;
    const target = toPrivate ? `.kaitu/local-projects/${slug}` : `projects/${slug}`;
    if (project.dir === target) continue;
    const store = privateStore(ws);
    transferMetrics(toPrivate ? ws : store, toPrivate ? store : ws, slug);
    moveDirectory(ws, project.dir, target);
  }
}
export async function setProject(
  ws: Workspace,
  slug: string,
  patch: Partial<
    Pick<ProjectStatus, "stage" | "local_only" | "links" | "next" | "github" | "progress" | "blocked">
  >,
) {
  return batchOverview(ws, async () => {
    const project = readProject(ws, slug);
    const data = { ...project.data, ...patch, updated: isoInZone(new Date(), ws.timeZone()) };
    checkStatus(data);
    ws.writeText(`${project.dir}/STATUS.md`, stringifyFrontmatter(data, project.body), { internal: true });
    if (driveProjects(ws) && data.local_only !== project.data.local_only) {
      const store = privateStore(ws);
      transferMetrics(data.local_only ? ws : store, data.local_only ? store : ws, slug);
      moveDirectory(ws, project.dir, data.local_only ? `.kaitu/local-projects/${slug}` : `projects/${slug}`);
    }
    const version = await projectVersion(ws, slug, `更新了项目：${data.title}`);
    // 共享目录移除也需要在工作区历史中保存。
    if (driveProjects(ws) && data.local_only !== project.data.local_only)
      await snapshot(ws, "更新了项目的本机存储设置");
    return { version };
  });
}
export function linkProject(ws: Workspace, slug: string, link: ProjectLink) {
  const project = readProject(ws, slug);
  const links = project.data.links.filter((item) => !(item.path === link.path && item.role === link.role));
  return setProject(ws, slug, { links: [...links, link] });
}

function linkedPath(link: ProjectLink): string {
  const path = link.path.startsWith("~/")
    ? join(process.env.HOME || homedir(), link.path.slice(2))
    : link.path;
  if (!isAbsolute(path)) throw new KaituError("链接必须使用绝对路径或 ~/", "BAD_ARGS");
  return resolve(path);
}
function manuscriptFiles(root: string, include = ["**/*"]): string[] {
  const out: string[] = [];
  function walk(dir: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (
        entry.name.startsWith(".") ||
        ["archived", "node_modules"].includes(entry.name) ||
        entry.isSymbolicLink()
      )
        continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (
        [".md", ".txt", ".docx"].includes(extname(path).toLowerCase()) &&
        // 说明文件不是正文
        !/^(readme|agents|claude)\.md$/i.test(entry.name) &&
        include.some((pattern) => matchesGlob(relative(root, path).split("\\").join("/"), pattern))
      )
        out.push(path);
    }
  }
  walk(root);
  return out;
}
export function docxText(bytes: Uint8Array): string {
  const xml = unzipSync(bytes, { filter: (entry) => entry.name === "word/document.xml" })[
    "word/document.xml"
  ];
  if (!xml) throw new KaituError("docx 缺少 document.xml", "INVALID_DOCUMENT");
  const parser = new SaxesParser({ xmlns: true });
  let inText = false;
  let text = "";
  parser.on("opentag", (tag) => {
    if (
      tag.local === "t" &&
      [
        "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
        "http://purl.oclc.org/ooxml/wordprocessingml/main",
      ].includes(tag.uri)
    )
      inText = true;
  });
  parser.on("text", (value) => {
    if (inText) text += value;
  });
  parser.on("closetag", (tag) => {
    if (tag.local === "t") inText = false;
    if (["p", "tab", "br"].includes(tag.local)) text += "\n";
  });
  parser.write(strFromU8(xml)).close();
  return text;
}
function wordCount(text: string, markdown: boolean): number {
  const plain = markdown
    ? text
        .replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, "")
        .replace(/<!--[\s\S]*?-->/g, "")
        .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
        .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/^\s*(?:`{3,}|~{3,}).*$/gm, "")
        .replace(/<[^>]+>/g, "")
        .replace(/^[ \t]*(?:#{1,6}\s+|>\s*|[-+*]\s+|\d+[.)]\s+)/gm, "")
        .replace(/[*_`~]/g, "")
    : text;
  return (
    (plain.match(/\p{Script=Han}/gu)?.length ?? 0) +
    (plain.match(/[\p{Script=Latin}\p{N}]+(?:['’’-][\p{Script=Latin}\p{N}]+)*/gu)?.length ?? 0)
  );
}

export async function syncProject(ws: Workspace, slug: string, options: { now?: Date } = {}) {
  return batchOverview(ws, async () => {
    const project = readProject(ws, slug);
    const sorted = sortLog(project.log);
    if (sorted !== project.log) ws.writeText(`${project.dir}/log.md`, sorted, { internal: true });
    const now = options.now ?? new Date();
    const tz = ws.timeZone();
    const today = localDate(now, tz);
    const firstDay = new Date(Date.parse(`${today}T12:00:00Z`) - 6 * 86400000).toISOString().slice(0, 10);
    const store = metricStore(ws, project.data);
    const existing = readRecords(store, "project_metric").filter((r) => r.project === slug);
    const issues: { path: string; message: string }[] = [];
    const written: StoredRecord[] = [];
    function metric(kind: "words" | "commits", date: string, value: number, detail?: string[]) {
      const previous = existing.find((r) => r.kind === kind && String(r.ts).slice(0, 10) === date);
      const data = {
        project: slug,
        kind,
        value,
        ...(detail ? { detail } : {}),
        ts: isoInZone(
          kind === "words" && date === today ? now : localTimeToInstant(`${date}T12:00:00`, tz),
          tz,
        ),
      };
      const record = previous
        ? updateRecord(store, "project_metric", previous.id, data).record
        : addRecord(store, "project_metric", data).record;
      written.push(record);
      return record;
    }
    const manuscripts = project.data.links.filter((l) => l.role === "manuscript");
    let words = 0;
    let wordsOk = manuscripts.length > 0;
    const seenFiles = new Set<string>();
    for (const link of manuscripts) {
      try {
        const root = linkedPath(link);
        for (const path of manuscriptFiles(root, link.include)) {
          const real = fs.realpathSync(path);
          if (seenFiles.has(real)) continue;
          seenFiles.add(real);
          words +=
            extname(path).toLowerCase() === ".docx"
              ? wordCount(docxText(fs.readFileSync(path)), false)
              : wordCount(fs.readFileSync(path, "utf8"), extname(path).toLowerCase() === ".md");
        }
      } catch (error) {
        wordsOk = false;
        issues.push({ path: link.path, message: (error as Error).message });
      }
    }
    if (wordsOk) {
      const wordMetrics = existing.filter((r) => r.kind === "words" && String(r.ts).slice(0, 10) <= today);
      const previous =
        wordMetrics.filter((r) => String(r.ts).slice(0, 10) < today).at(-1) ?? wordMetrics.at(-1);
      metric("words", today, words);
      const delta = previous ? words - Number(previous.value) : null;
      appendLog(
        ws,
        slug,
        `字数 ${words.toLocaleString("en-US")}（${delta === null ? "首次统计" : `${delta >= 0 ? "+" : ""}${delta.toLocaleString("en-US")}`}）`,
        today,
        "words",
      );
    }
    const repos = project.data.links.filter((l) => l.role === "repo");
    const commitDates = existing.filter((r) => r.kind === "commits").map((r) => String(r.ts).slice(0, 10));
    const from = [firstDay, ...commitDates].sort()[0] as string;
    const counts = new Map<
      string,
      { count: number; titles: { timestamp: number; oid: string; title: string }[] }
    >();
    const seenCommits = new Set<string>();
    let reposOk = repos.length > 0;
    for (const link of repos) {
      try {
        const dir = linkedPath(link);
        if (!fs.lstatSync(join(dir, ".git")).isDirectory()) throw new Error("只支持普通 .git 目录");
        const refs: string[] = [];
        for (const namespace of ["refs/heads", "refs/remotes"]) {
          for (const ref of await git.listRefs({ fs, dir, filepath: namespace })) {
            refs.push(`${namespace}/${ref}`);
          }
        }
        // 只读取所有分支的对象与引用，不执行 status、checkout 或任何写命令。
        for (const ref of refs) {
          for (const { oid, commit } of await git.log({ fs, dir, ref })) {
            if (seenCommits.has(oid)) continue;
            seenCommits.add(oid);
            const timestamp = commit.author.timestamp;
            const day = localDate(new Date(timestamp * 1000), tz);
            if (day < from || day >= today) continue;
            const item = counts.get(day) ?? { count: 0, titles: [] };
            item.count++;
            item.titles.push({
              timestamp,
              oid,
              title: [...(commit.message.split(/\r?\n/)[0] ?? "")].slice(0, 80).join(""),
            });
            counts.set(day, item);
          }
        }
      } catch (error) {
        reposOk = false;
        issues.push({ path: link.path, message: (error as Error).message });
      }
    }
    if (reposOk) {
      for (const date of new Set([...commitDates, ...counts.keys()])) {
        const item = counts.get(date);
        const detail = [
          ...new Set(
            (item?.titles ?? [])
              .sort((a, b) => b.timestamp - a.timestamp || a.oid.localeCompare(b.oid))
              .map((entry) => entry.title),
          ),
        ].slice(0, 10);
        const total = item?.count ?? 0;
        const previous = existing.find((r) => r.kind === "commits" && String(r.ts).slice(0, 10) === date);
        if (previous?.value === total && JSON.stringify(previous.detail) === JSON.stringify(detail)) continue;
        metric("commits", date, total, detail);
        appendLog(ws, slug, `${total} 次提交：${detail.join("；")}`, date, "commits");
      }
    }
    for (const link of project.data.links.filter((l) => l.role === "folder")) {
      try {
        fs.accessSync(linkedPath(link), fs.constants.R_OK);
      } catch (error) {
        issues.push({ path: link.path, message: (error as Error).message });
      }
    }
    project.data.updated = isoInZone(now, tz);
    ws.writeText(`${project.dir}/STATUS.md`, stringifyFrontmatter(project.data, project.body), {
      internal: true,
    });
    const github = project.data.github ? await syncGithub(ws, slug, { now }) : null;
    if (github?.problem) issues.push({ path: github.repo, message: github.problem });
    return {
      slug,
      metrics: written,
      issues,
      version: github?.ok
        ? github.version
        : await projectVersion(ws, slug, `同步了项目进度：${project.data.title}`, now),
    };
  });
}
export async function syncProjects(ws: Workspace) {
  return batchSnapshot(ws, "同步了项目进度", async () => {
    const results = [];
    for (const slug of slugs(ws)) results.push(await syncProject(ws, slug));
    return results;
  });
}

export function rebaseProjectLinks(ws: Workspace, oldRoot: string, newRoot: string) {
  for (const slug of slugs(ws)) {
    const project = readProject(ws, slug);
    let changed = false;
    for (const link of project.data.links) {
      const rel = relative(oldRoot, linkedPath(link));
      if (rel && !rel.startsWith("..") && !isAbsolute(rel)) {
        link.path = join(newRoot, rel);
        changed = true;
      }
    }
    if (changed)
      ws.writeText(`${project.dir}/STATUS.md`, stringifyFrontmatter(project.data, project.body), {
        internal: true,
      });
  }
}
