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

export async function installProjectMemory(ws: Workspace, directory: string, selected?: string) {
  const context = await projectMemoryContext(ws, directory, selected);
  if (!context.project)
    throw new KaituError(
      context.matches.length
        ? `匹配多个项目，请用 --project 选择：${context.matches.map((item) => item.slug).join("、")}`
        : "尚无绑定项目，请先绑定 GitHub 仓库",
      "BAD_ARGS",
    );
  const packaged = join(assetsRoot(), "dist/cli.mjs");
  const entry = fs.existsSync(packaged) ? packaged : join(assetsRoot(), "packages/cli/dist/main.js");
  const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
  const cli = fs.existsSync(entry)
    ? `ELECTRON_RUN_AS_NODE=1 ${quote(process.execPath)} ${quote(entry)}`
    : "当前安装缺少 CLI，请先通过 App 更新；不要猜测 npx 包名";
  const text = `${fs.readFileSync(join(templateDir(), ".agents/skills/kaitu-project-memory/SKILL.md"), "utf8")}\n开图工作区：${JSON.stringify(ws.root)}；所属项目：${context.project.slug}。\n本机 kaitu 的实际入口：${cli}。上文所有 kaitu 命令使用这个入口，并加 --dir ${quote(ws.root)}。\n`;
  const files = [".agents", ".claude"].map((base) =>
    join(context.root, base, "skills/kaitu-project-memory/SKILL.md"),
  );
  try {
    for (const file of files)
      if (fs.existsSync(file) && fs.readFileSync(file, "utf8") !== text)
        throw new KaituError("已有同名技能，已保留；请人工核对", "CONFLICT");
    for (const file of files)
      if (!fs.existsSync(file)) {
        fs.mkdirSync(dirname(file), { recursive: true });
        fs.writeFileSync(file, text, { flag: "wx" });
      }
  } catch (error) {
    if (["EPERM", "EACCES"].includes((error as NodeJS.ErrnoException).code ?? ""))
      throw new KaituError(
        `项目技能安装需要正常权限审批。待写路径：\n${files.join("\n")}\n请同一个 Agent 展示待写内容，通过正常审批重试原 install 命令：${cli} project memory --install --from ${quote(context.root)} --project ${quote(context.project.slug)} --dir ${quote(ws.root)}。不要绕过沙箱、chmod、换写法或让其他 Agent 代装。当前会话若以 -a never 禁止审批，请停止并在支持正常审批的新 Agent 窗口继续；安装尚未完成。`,
        "AGENT_PERMISSION_REQUIRED",
      );
    throw error;
  }
  return {
    files,
    project: context.project.slug,
    connected: false,
    next: "请实际读取项目状态、写项目日志并在项目页回读，再确认 Agent 接入成功",
  };
}
