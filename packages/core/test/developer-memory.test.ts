import fs from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import git from "isomorphic-git";
import { expect, it, vi } from "vitest";
import {
  createProject,
  installProjectMemory,
  logProject,
  projectMemoryContext,
  readProjectPage,
  resolveWorkspaceBackup,
  syncWorkspaceBackup,
  workspaceBackupRequest,
  workspaceBackupStatus,
} from "../src/index.js";
import { freshWorkspace, tmp } from "./helpers.js";

it.skipIf(process.platform === "win32")(
  "已登录 gh 合成建库、同步回流、冲突保留及登出提示；不复制 token",
  async () => {
    const dir = tmp();
    const bin = join(dir, "bin");
    const stateFile = join(dir, "gh.json");
    fs.mkdirSync(bin);
    fs.writeFileSync(
      join(bin, "gh"),
      `#!${process.execPath}\nimport ${JSON.stringify(fileURLToPath(new URL("./fixtures/github-cli.mjs", import.meta.url)))};\n`,
      { mode: 0o755 },
    );
    const initial = {
      authenticated: true,
      repo: null,
      private: true,
      head: null,
      sequence: 0,
      trees: {},
      commits: {},
    };
    fs.writeFileSync(stateFile, JSON.stringify(initial));
    vi.stubEnv("PATH", `${bin}:${process.env.PATH}`);
    vi.stubEnv("KAITU_TEST_GH_STATE", stateFile);
    const ws = await freshWorkspace();
    const secretsBefore = ws.readText(".kaitu/secrets.json");
    try {
      await workspaceBackupRequest(ws, "create", { repo: "synthetic/kaitu-ai-memory" });
      await syncWorkspaceBackup(ws);
      expect(workspaceBackupStatus(ws)).toMatchObject({
        connection: { via: "gh", private: true },
        error: null,
      });
      expect(ws.readText(".kaitu/secrets.json")).toBe(secretsBefore);
      const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
      const before = state.trees[state.commits[state.head].tree.sha];
      expect(before["AGENT-README.md"]).toContain("接手顺序");
      expect(before["README.md"]).toContain("projects/");
      state.trees.remote = { ...before, "notes/remote.md": "synthetic remote edit\n" };
      state.commits.remote = { tree: { sha: "remote" }, parent: state.head };
      state.head = "remote";
      fs.writeFileSync(stateFile, JSON.stringify(state));
      await syncWorkspaceBackup(ws);
      expect(ws.readText("notes/remote.md")).toBe("synthetic remote edit\n");
      const changed = JSON.parse(fs.readFileSync(stateFile, "utf8"));
      changed.trees.conflict = {
        ...changed.trees[changed.commits[changed.head].tree.sha],
        "notes/remote.md": "remote kept\n",
      };
      changed.commits.conflict = { tree: { sha: "conflict" }, parent: changed.head };
      changed.head = "conflict";
      fs.writeFileSync(stateFile, JSON.stringify(changed));
      ws.writeText("notes/remote.md", "local kept\n");
      await syncWorkspaceBackup(ws);
      expect(workspaceBackupStatus(ws).conflicts[0]).toMatchObject({
        local: "local kept\n",
        remote: "remote kept\n",
      });
      resolveWorkspaceBackup(ws, "notes/remote.md", "local");
      await syncWorkspaceBackup(ws);
      const calls = fs
        .readFileSync(`${stateFile}.calls`, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      expect(calls.filter((args) => args.includes("repos/synthetic/kaitu-ai-memory"))).toHaveLength(1);
      const loggedOut = JSON.parse(fs.readFileSync(stateFile, "utf8"));
      loggedOut.authenticated = false;
      fs.writeFileSync(stateFile, JSON.stringify(loggedOut));
      await syncWorkspaceBackup(ws);
      expect(workspaceBackupStatus(ws).error).toContain("登录已失效");
      expect(ws.readText("notes/remote.md")).toBe("local kept\n");
    } finally {
      vi.unstubAllEnvs();
    }
  },
);

it("新项目会话读取既有状态并写回现有项目日志；薄入口保留配置，多匹配不自动选择", async () => {
  const ws = await freshWorkspace();
  const code = tmp();
  await git.init({ fs, dir: code });
  await git.addRemote({ fs, dir: code, remote: "origin", url: "git@github.com:synthetic/code.git" });
  fs.writeFileSync(join(code, "AGENTS.md"), "existing instructions\n");
  fs.writeFileSync(join(code, "CLAUDE.md"), "existing Claude config\n");
  const project = await createProject(ws, {
    title: "Synthetic code",
    kind: "work",
    links: [{ path: code, role: "repo" }],
  });
  const start = await projectMemoryContext(ws, code);
  expect(start.project?.slug).toBe(project.slug);
  await installProjectMemory(ws, code);
  expect(fs.readFileSync(join(code, "AGENTS.md"), "utf8")).toBe("existing instructions\n");
  expect(fs.readFileSync(join(code, "CLAUDE.md"), "utf8")).toBe("existing Claude config\n");
  const log =
    "改动：修复合成按钮\n失败尝试：旧路径无效\n阻塞：无\n建议下一步：验证第二会话\n来源：synthetic/issue-1";
  await logProject(ws, project.slug, log, { by: "agent" });
  const nextSession = await projectMemoryContext(ws, code);
  for (const line of log.split("\n")) {
    expect(nextSession.project?.log).toContain(line);
    expect(readProjectPage(ws, project.slug).logs[0]?.text).toContain(line);
  }
  await createProject(ws, {
    title: "Another synthetic project",
    kind: "work",
    links: [{ path: code, role: "repo" }],
  });
  expect((await projectMemoryContext(ws, code)).project).toBeNull();
  await expect(installProjectMemory(ws, code)).rejects.toThrow("匹配多个项目");
});
