import fs from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import git from "isomorphic-git";
import { assetsRoot, templateDir } from "./assets.js";
import { KaituError } from "./errors.js";
import { parseGithubRepo } from "./github.js";
import { projectDirectory, projectStatusFiles, readProject } from "./projects.js";
import type { Workspace } from "./workspace.js";

export async function projectMemoryContext(ws: Workspace, directory: string, selected?: string) {
  const root = await git.findRoot({ fs, filepath: resolve(expandHome(directory)) });
  const repositories = [
    ...new Set(
      (await git.listRemotes({ fs, dir: root })).flatMap(({ url }) => {
        try {
          return [
            parseGithubRepo(url.replace(/^ssh:\/\/git@github\.com\//, "git@github.com:")).toLowerCase(),
          ];
        } catch {
          return [];
        }
      }),
    ),
  ];
  const matches = projectStatusFiles(ws).flatMap(({ file }) => {
    const slug = file.split("/")[1] as string;
    const project = readProject(ws, slug);
    const byRemote = project.data.github && repositories.includes(project.data.github.repo.toLowerCase());
    const byLink = project.data.links.some(
      (link) => link.role === "repo" && resolve(expandHome(link.path)) === root,
    );
    return byRemote || byLink
      ? [{ slug, title: project.data.title, repo: project.data.github?.repo ?? null }]
      : [];
  });
  if (selected && !matches.some((item) => item.slug === selected))
    throw new KaituError("所选项目未绑定这个代码仓库，请先核对绑定", "BAD_ARGS");
  const slug = selected ?? (matches.length === 1 ? matches[0]?.slug : undefined);
  return { root, repositories, matches, project: slug ? readProject(ws, slug) : null };
}

// Windows 上编程 Agent 用 PowerShell 执行命令，其他系统用 POSIX shell。
const windows = () => process.platform === "win32";
const quote = (value: string) =>
  windows() ? `'${value.replaceAll("'", "''")}'` : `'${value.replaceAll("'", "'\\''")}'`;
const expandHome = (path: string) =>
  path.startsWith("~/") ? join(process.env.HOME || homedir(), path.slice(2)) : path;

/** 本机 kaitu 的实际入口：App 自带的 CLI 优先，开发环境用仓库里的构建，都没有才用 PATH 上的 kaitu。 */
function cliCommand(): string {
  const packaged = join(assetsRoot(), "dist/cli.mjs");
  const entry = fs.existsSync(packaged) ? packaged : join(assetsRoot(), "packages/cli/dist/main.js");
  if (!fs.existsSync(entry)) return "kaitu";
  return windows()
    ? `$env:ELECTRON_RUN_AS_NODE=1; & ${quote(process.execPath)} ${quote(entry)}`
    : `ELECTRON_RUN_AS_NODE=1 ${quote(process.execPath)} ${quote(entry)}`;
}

/** 接力和画图都要认出代码仓库：没绑 GitHub 也没关联仓库时，复制出去的命令一定失败，直接说明。 */
function repoOf(ws: Workspace, slug: string) {
  const project = readProject(ws, slug);
  const repo = project.data.links.find((link) => link.role === "repo")?.path;
  if (!repo && !project.data.github)
    throw new KaituError("先给这个项目绑定 GitHub 仓库或关联代码目录", "BAD_ARGS");
  return { project, repo: repo ? expandHome(repo) : undefined };
}

/** 交给编程 Agent 的接力提示词：开工前读项目进度，做完写回项目日志。 */
export function projectMemoryPrompt(ws: Workspace, slug: string, locale: "zh-CN" | "en" = "zh-CN"): string {
  const { project, repo } = repoOf(ws, slug);
  const cli = cliCommand();
  const dir = quote(ws.root);
  const from = repo ? quote(repo) : locale === "en" ? "<path-to-this-repo>" : "<这个代码仓库的路径>";
  const read = `${cli} project memory --from ${from} --project ${slug} --dir ${dir}`;
  const log = `${cli} project log ${slug} --text '…' --by agent --dir ${dir}`;
  return locale === "en"
    ? `Please continue my Kaitu project "${project.data.title}". Before you start, read where it stands:\n${read}\nThen tell me in three sentences what is done, what is blocked and what you will do first.\nWhen you finish this stretch, log one short entry back to Kaitu: what got done, why, where you are stuck and the suggested next step. Skip what GitHub already shows:\n${log}\nOnly write this project's log; do not change goals or other data.`
    : `请接着做我的开图项目「${project.data.title}」。开始前先读进度：\n${read}\n读完用三句话告诉我做到哪、卡在哪、你打算先做什么。\n做完这一段，记回开图一条短记录，几句话写清做成了什么、为什么、卡在哪、建议下一步；GitHub 上看得到的提交和 PR 不用抄：\n${log}\n只写这个项目的日志，不改目标和别的资料。`;
}

/** 项目页「用 Archify 画架构图」：交给在代码仓库里工作的 Agent，画好后交回开图显示。 */
export function projectArchitecturePrompt(
  ws: Workspace,
  slug: string,
  locale: "zh-CN" | "en" = "zh-CN",
): string {
  const { project, repo } = repoOf(ws, slug);
  const cli = cliCommand();
  const at = repo ? quote(repo) : locale === "en" ? "this project's code repository" : "这个项目的代码仓库";
  const done = `${cli} project architecture ${slug} --file docs/architecture/architecture.html --dir ${quote(ws.root)}`;
  return locale === "en"
    ? `Please draw an architecture diagram with Archify for my Kaitu project "${project.data.title}".\n1. Work in ${at}. If the Archify skill is not installed, ask me first; once I agree, run: npx skills add tt-a1i/archify\n2. Follow Archify's repository flow for an architecture diagram, with source evidence. Keep the JSON source at docs/architecture/architecture.json and the HTML next to it. If a previous source exists, start from it and tell me which nodes and connections changed.\n3. When Archify's finalize passes, hand the diagram to Kaitu:\n${done}\n4. Tell me in one or two sentences what level the diagram shows, what it leaves out and what changed. Do not commit or push; I will decide.`
    : `请用 Archify 给我的开图项目「${project.data.title}」画一张架构图。\n1. 在${repo ? `代码仓库 ${at} ` : at}里工作。没装 Archify 技能时先问我，同意后运行：npx skills add tt-a1i/archify\n2. 按 Archify 给代码仓库画架构图的流程做，带源码出处。JSON 源放 docs/architecture/architecture.json，生成的 HTML 放在同一目录；已有旧的源就在它上面改，并说清哪些节点和连线变了。\n3. Archify 的 finalize 通过后，把图交给开图：\n${done}\n4. 用一两句话告诉我：这张图画到哪一层、省略了什么、和上一版比变了什么。不要提交或推送，由我决定。`;
}

const ARCHITECTURE_LIMIT = 8 * 1024 * 1024;

/** 外部 Agent 交回的架构图：入口处查一次大小和类型，之后项目页按原样在隔离框里显示。 */
export function saveProjectArchitecture(ws: Workspace, slug: string, source: string) {
  readProject(ws, slug);
  const path = resolve(source);
  if (!fs.existsSync(path) || !fs.statSync(path).isFile())
    throw new KaituError(`找不到架构图文件：${source}`, "NOT_FOUND");
  if (fs.statSync(path).size > ARCHITECTURE_LIMIT) throw new KaituError("架构图超过 8 MB", "BAD_ARGS");
  const html = fs.readFileSync(path, "utf8");
  if (!/<(?:html|svg)[\s>]/i.test(html.slice(0, 4096)))
    throw new KaituError("架构图需要是 Archify 生成的 HTML 文件", "BAD_ARGS");
  const file = `${projectDirectory(ws, slug)}/architecture.html`;
  ws.writeText(file, html);
  return { file };
}

export function readProjectArchitecture(ws: Workspace, slug: string): string | null {
  const file = `${projectDirectory(ws, slug)}/architecture.html`;
  return ws.exists(file) ? ws.readText(file) : null;
}

export async function installProjectMemory(ws: Workspace, directory: string, selected?: string) {
  const context = await projectMemoryContext(ws, directory, selected);
  if (!context.project)
    throw new KaituError(
      context.matches.length
        ? `匹配多个项目，请用 --project 选择：${context.matches.map((item) => item.slug).join("、")}`
        : "尚无绑定项目，请先绑定 GitHub 仓库",
      "BAD_ARGS",
    );
  const cli = cliCommand();
  const text = `${fs.readFileSync(join(templateDir(), ".agents/skills/kaitu-project-memory/SKILL.md"), "utf8")}\n开图工作区：${JSON.stringify(ws.root)}；所属项目：${context.project.slug}。\n本机 kaitu 的实际入口：${cli}。上文所有 kaitu 命令使用这个入口，并加 --dir ${quote(ws.root)}。\n`;
  const files = [".agents", ".claude"].map((base) =>
    join(context.root, base, "skills/kaitu-project-memory/SKILL.md"),
  );
  for (const file of files)
    if (fs.existsSync(file) && fs.readFileSync(file, "utf8") !== text)
      throw new KaituError(`已有同名技能，已保留：${file}`, "CONFLICT");
  for (const file of files) {
    fs.mkdirSync(dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  }
  return { files, project: context.project.slug };
}
