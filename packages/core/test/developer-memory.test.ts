import fs from "node:fs";
import { join } from "node:path";
import git from "isomorphic-git";
import { expect, it, vi } from "vitest";
import {
  assetsRoot,
  createPrivateGithubRepository,
  createProject,
  doctor,
  initWorkspace,
  installProjectMemory,
  logProject,
  projectMemoryContext,
  projectMemoryPrompt,
  readProjectPage,
  runPhone,
} from "../src/index.js";
import { freshWorkspace, tmp } from "./helpers.js";

it.skipIf(process.platform === "win32")("用已登录的 gh 新建私有仓库，已存在的不覆盖", async () => {
  const bin = tmp();
  const repos = join(bin, "repos.json");
  fs.writeFileSync(repos, "[]");
  fs.writeFileSync(
    join(bin, "gh"),
    `#!${process.execPath}
const fs = require("node:fs");
const [cmd, action, ...rest] = process.argv.slice(2);
const repos = JSON.parse(fs.readFileSync(${JSON.stringify(repos)}, "utf8"));
if (cmd === "repo" && action === "view") process.exit(repos.includes(rest[0]) ? 0 : 1);
if (cmd === "repo" && action === "create") {
  fs.writeFileSync(${JSON.stringify(repos)}, JSON.stringify([...repos, { name: rest.at(-1), args: rest }]));
}
`,
    { mode: 0o755 },
  );
  vi.stubEnv("PATH", `${bin}:${process.env.PATH}`);
  try {
    await createPrivateGithubRepository("synthetic/kaitu-ai-memory");
    const [created] = JSON.parse(fs.readFileSync(repos, "utf8"));
    expect(created.name).toBe("synthetic/kaitu-ai-memory");
    expect(created.args).toContain("--private");
    fs.writeFileSync(repos, JSON.stringify(["synthetic/kaitu-ai-memory"]));
    await expect(createPrivateGithubRepository("synthetic/kaitu-ai-memory")).rejects.toThrow("已存在");
  } finally {
    vi.unstubAllEnvs();
  }
});

it("新项目会话读取既有状态并写回现有项目日志；入口保留已有配置，多匹配不自动选择", async () => {
  const ws = await freshWorkspace();
  const code = tmp();
  await git.init({ fs, dir: code });
  await git.addRemote({ fs, dir: code, remote: "origin", url: "git@github.com:synthetic/code.git" });
  fs.writeFileSync(join(code, "AGENTS.md"), "existing instructions\n");
  fs.writeFileSync(join(code, "CLAUDE.md"), "existing Claude config\n");
  const project = await createProject(ws, {
    title: "合成代码",
    slug: "code",
    kind: "work",
    links: [{ path: code, role: "repo" }],
  });
  expect(project.slug).toBe("code");
  expect((await projectMemoryContext(ws, code)).project?.slug).toBe("code");
  const skill = join(code, ".claude/skills/kaitu-project-memory/SKILL.md");
  await installProjectMemory(ws, code);
  fs.writeFileSync(skill, "user-owned skill\n");
  await expect(installProjectMemory(ws, code)).rejects.toMatchObject({ code: "CONFLICT" });
  expect(fs.readFileSync(skill, "utf8")).toBe("user-owned skill\n");
  expect(fs.readFileSync(join(code, "AGENTS.md"), "utf8")).toBe("existing instructions\n");
  expect(fs.readFileSync(join(code, "CLAUDE.md"), "utf8")).toBe("existing Claude config\n");
  const log = "改动：修复合成按钮\n失败尝试：旧路径无效\n建议下一步：验证第二会话";
  await logProject(ws, project.slug, log, { by: "agent" });
  expect((await projectMemoryContext(ws, code)).project?.log).toContain("失败尝试：旧路径无效");
  expect(readProjectPage(ws, project.slug).logs[0]?.text).toContain("建议下一步：验证第二会话");
  await createProject(ws, {
    title: "Another synthetic project",
    kind: "work",
    links: [{ path: code, role: "repo" }],
  });
  expect((await projectMemoryContext(ws, code)).project).toBeNull();
  await expect(installProjectMemory(ws, code)).rejects.toThrow("匹配多个项目");
  // 项目页按当前项目安装：多个匹配时也能指定，用户自己的同名技能仍保留。
  await expect(installProjectMemory(ws, code, project.slug)).rejects.toMatchObject({ code: "CONFLICT" });
  expect(fs.readFileSync(skill, "utf8")).toBe("user-owned skill\n");
  const prompt = projectMemoryPrompt(ws, project.slug);
  expect(prompt).toContain(`--project ${project.slug}`);
  expect(prompt).toContain(`project log ${project.slug}`);
  expect(prompt).toContain(ws.root);
  expect(prompt).toContain(`--from '${code}'`);
});

it("纯 Git 模板建的记忆仓库能直接接管：已有文件不动，接着能给手机生成内容", async () => {
  const root = join(tmp(), "kaitu-ai-memory");
  fs.cpSync(join(assetsRoot(), "docs/guides/agent-memory/template"), root, { recursive: true });
  const status = `---
title: 合成项目
kind: work
stage: active
updated: 2026-10-19T09:00:00+08:00
links: []
next:
  - id: ship
    title: 发出第一版
    priority: high
    status: todo
---
# 合成项目

做到第二章。
`;
  fs.mkdirSync(join(root, "projects/synthetic"), { recursive: true });
  fs.writeFileSync(join(root, "projects/synthetic/STATUS.md"), status);
  const before = Object.fromEntries(
    ["AGENT-README.md", ".gitignore", "me/profile.md", "projects/synthetic/STATUS.md"].map((p) => [
      p,
      fs.readFileSync(join(root, p), "utf8"),
    ]),
  );

  const ws = await initWorkspace(root);
  for (const [path, text] of Object.entries(before)) expect(ws.readText(path)).toBe(text);
  expect(ws.exists("health/module.json")).toBe(true);
  expect((await doctor(ws)).find((c) => c.name === "密钥与索引不进版本历史")?.ok).toBe(true);

  const result = await runPhone(ws, { kind: "agent", name: "合成助手", spec: 1 });
  expect(result.snapshots).toBeGreaterThan(0);
  const today = ws.readJson<{ next: { id: string }[]; generator: { name: string } }>("phone/today.json");
  expect(today.next.map((n) => n.id)).toEqual(["ship"]);
  expect(today.generator.name).toBe("合成助手");
  const library = ws.readJson<{ items: { kind: string; title: string }[] }>("phone/library.json");
  expect(library.items).toContainEqual(expect.objectContaining({ kind: "project", title: "合成项目" }));
  expect(ws.readText(".gitignore")).toBe(before[".gitignore"]);
  expect(ws.readText("AGENT-README.md")).toBe(before["AGENT-README.md"]);
  expect(ws.exists("inbox/agents/.gitkeep")).toBe(true);

  const other = join(tmp(), "other");
  fs.mkdirSync(other);
  fs.writeFileSync(join(other, "notes.md"), "随便写的");
  await expect(initWorkspace(other)).rejects.toThrow("不是空目录");
});
