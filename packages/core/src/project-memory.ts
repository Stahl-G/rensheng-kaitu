import fs from "node:fs";
import { dirname, join, resolve } from "node:path";
import git from "isomorphic-git";
import { templateDir } from "./assets.js";
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
  const text = `${fs.readFileSync(join(templateDir(), ".agents/skills/kaitu-project-memory/SKILL.md"), "utf8")}\n开图工作区：${JSON.stringify(ws.root)}；所属项目：${context.project.slug}。\n`;
  const files = [".agents", ".claude"].map((base) =>
    join(context.root, base, "skills/kaitu-project-memory/SKILL.md"),
  );
  for (const file of files)
    if (fs.existsSync(file) && fs.readFileSync(file, "utf8") !== text)
      throw new KaituError("已有同名技能，已保留；请人工核对", "CONFLICT");
  for (const file of files)
    if (!fs.existsSync(file)) {
      fs.mkdirSync(dirname(file), { recursive: true });
      fs.writeFileSync(file, text, { flag: "wx" });
    }
  return {
    files,
    project: context.project.slug,
    connected: false,
    next: "请实际读取项目状态、写项目日志并在项目页回读，再确认 Agent 接入成功",
  };
}
