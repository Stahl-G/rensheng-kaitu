import fs from "node:fs";
import { dirname, join, resolve } from "node:path";
import git from "isomorphic-git";
import { assetsRoot, templateDir } from "./assets.js";
import { KaituError } from "./errors.js";
import { parseGithubRepo } from "./github.js";
import { projectStatusFiles, readProject } from "./projects.js";
import type { Workspace } from "./workspace.js";

export async function projectMemoryContext(ws: Workspace, directory: string, selected?: string) {
  const root = await git.findRoot({ fs, filepath: resolve(directory) });
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
    const byLink = project.data.links.some((link) => link.role === "repo" && resolve(link.path) === root);
    return byRemote || byLink
      ? [{ slug, title: project.data.title, repo: project.data.github?.repo ?? null }]
      : [];
  });
  if (selected && !matches.some((item) => item.slug === selected))
    throw new KaituError("所选项目未绑定这个代码仓库，请先核对绑定", "BAD_ARGS");
  const slug = selected ?? (matches.length === 1 ? matches[0]?.slug : undefined);
  return { root, repositories, matches, project: slug ? readProject(ws, slug) : null };
}

const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

/** 本机 kaitu 的实际入口：App 自带的 CLI 优先，开发环境用仓库里的构建，都没有才用 PATH 上的 kaitu。 */
function cliCommand(): string {
  const packaged = join(assetsRoot(), "dist/cli.mjs");
  const entry = fs.existsSync(packaged) ? packaged : join(assetsRoot(), "packages/cli/dist/main.js");
  return fs.existsSync(entry) ? `ELECTRON_RUN_AS_NODE=1 ${quote(process.execPath)} ${quote(entry)}` : "kaitu";
}

/** 交给编程 Agent 的接力提示词：开工前读项目进度，做完写回项目日志。 */
export function projectMemoryPrompt(ws: Workspace, slug: string, locale: "zh-CN" | "en" = "zh-CN"): string {
  const project = readProject(ws, slug);
  const cli = cliCommand();
  const dir = quote(ws.root);
  const repo = project.data.links.find((link) => link.role === "repo")?.path;
  const from = repo ? quote(repo) : locale === "en" ? "<path-to-this-repo>" : "<这个代码仓库的路径>";
  const read = `${cli} project memory --from ${from} --project ${slug} --dir ${dir}`;
  const log = `${cli} project log ${slug} --text '…' --by agent --dir ${dir}`;
  return locale === "en"
    ? `Please continue my Kaitu project "${project.data.title}". Before you start, read where it stands:\n${read}\nThen tell me in three sentences what is done, what is blocked and what you will do first.\nWhen you finish this stretch, log it back to Kaitu, covering changes, failed attempts, blockers and suggested next steps:\n${log}\nOnly write this project's log; do not change goals or other data.`
    : `请接着做我的开图项目「${project.data.title}」。开始前先读进度：\n${read}\n读完用三句话告诉我做到哪、卡在哪、你打算先做什么。\n做完这一段，把结果记回开图，写清改动、失败尝试、阻塞和建议下一步：\n${log}\n只写这个项目的日志，不改目标和别的资料。`;
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
