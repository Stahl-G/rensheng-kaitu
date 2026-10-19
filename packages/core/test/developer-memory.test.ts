import { execFile } from "node:child_process";
import fs from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import git from "isomorphic-git";
import { expect, it, vi } from "vitest";
import {
  KaituError,
  Workspace,
  connectWorkspaceBackup,
  createProject,
  installProjectMemory,
  invalidateWorkspaceBackup,
  logProject,
  projectMemoryContext,
  readProjectPage,
  resolveWorkspaceBackup,
  restoreWorkspaceBackup,
  syncWorkspaceBackup,
  workspaceBackupPrompts,
  workspaceBackupRequest,
  workspaceBackupStatus,
} from "../src/index.js";
import { freshWorkspace, tmp } from "./helpers.js";

async function githubFixture() {
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
    legacy: "synthetic/my-ai-memory",
    legacyMetadata: {
      nameWithOwner: "synthetic/my-ai-memory",
      isPrivate: true,
      description: "keep legacy metadata",
    },
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
  const home = tmp();
  const cli = fileURLToPath(new URL("../../cli/dist/main.js", import.meta.url));
  const runCli = (...args: string[]) =>
    promisify(execFile)(process.execPath, [cli, "backup", ...args], {
      cwd: home,
      env: {
        ...process.env,
        HOME: home,
        KAITU_DIR: "",
        KAITU_APP_HOME: join(home, "app"),
        KAITU_LOCAL_STATE_DIR: join(home, "state"),
        XDG_STATE_HOME: join(home, "xdg"),
      },
    });
  return { dir, stateFile, initial, ws, secretsBefore, home, runCli };
}

it.skipIf(process.platform === "win32")(
  "已登录 gh 合成建库、同步回流、冲突保留及登出提示；不复制 token",
  async () => {
    const { stateFile, initial, ws, secretsBefore } = await githubFixture();
    try {
      await expect(
        workspaceBackupRequest(ws, "create", { repo: "synthetic/kaitu-ai-memory" }),
      ).rejects.toMatchObject({ code: "BACKUP_SCOPE_REQUIRED" });
      expect(JSON.parse(fs.readFileSync(stateFile, "utf8")).repo).toBeNull();
      const proposed = await workspaceBackupRequest(ws, "preview", { repo: "synthetic/kaitu-ai-memory" });
      expect(proposed).toMatchObject({ existingReadme: false, connected: false });
      const readme = "# Existing synthetic README\nprojects/ original content\n";
      ws.writeText("README.md", readme);
      await expect(
        workspaceBackupRequest(ws, "create", {
          repo: "SYNTHETIC/KAITU-AI-MEMORY",
          text: true,
          records: true,
        }),
      ).rejects.toMatchObject({ code: "GH_REQUEST" });
      expect(JSON.parse(fs.readFileSync(stateFile, "utf8"))).toMatchObject({
        repo: null,
        legacy: initial.legacy,
        legacyMetadata: initial.legacyMetadata,
      });
      await workspaceBackupRequest(ws, "create", {
        repo: "synthetic/kaitu-ai-memory",
        text: true,
        records: true,
        keepLegacy: true,
      });
      await syncWorkspaceBackup(ws);
      expect(workspaceBackupStatus(ws)).toMatchObject({
        connection: { via: "gh", private: true },
        error: null,
      });
      expect(ws.readText(".kaitu/secrets.json")).toBe(secretsBefore);
      await expect(
        workspaceBackupRequest(ws, "create", {
          repo: "SYNTHETIC/KAITU-AI-MEMORY",
          text: true,
          records: true,
          keepLegacy: true,
        }),
      ).rejects.toMatchObject({ code: "GH_REQUEST" });
      const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
      expect(state).toMatchObject({
        repo: "synthetic/kaitu-ai-memory",
        legacy: initial.legacy,
        legacyMetadata: initial.legacyMetadata,
      });
      const before = state.trees[state.commits[state.head].tree.sha];
      expect(before["AGENT-README.md"]).toContain("接手顺序");
      expect(before["README.md"]).toBe(readme);
      expect(
        await workspaceBackupRequest(ws, "preview", { repo: "synthetic/kaitu-ai-memory" }),
      ).toMatchObject({ existingReadme: true, connected: true, readme, description: state.description });
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
      expect(calls.filter((args) => args[0] === "repo" && args[1] === "create")).toHaveLength(1);
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

it.skipIf(process.platform === "win32")("CLI 冷启动恢复并保留显式范围，未选资料不上传", async () => {
  const { stateFile, initial, home, runCli } = await githubFixture();
  const before = {
    "kaitu-backup.json": JSON.stringify({ format: "kaitu-workspace", version: 1, text: true, records: true }),
    "README.md": "# Existing synthetic README\nprojects/ original content\n",
    "notes/remote.md": "local kept\n",
  };
  fs.writeFileSync(
    stateFile,
    JSON.stringify({
      ...initial,
      repo: "synthetic/kaitu-ai-memory",
      head: "seed",
      trees: { seed: before },
      commits: { seed: { tree: { sha: "seed" }, parent: null } },
    }),
  );
  try {
    const auth = await runCli("auth-status");
    expect(JSON.parse(auth.stdout)).toMatchObject({ authenticated: true, login: "synthetic" });
    expect(fs.readdirSync(home)).toEqual([]);
    const restoreTarget = join(home, "restored");
    await runCli("restore", "synthetic/kaitu-ai-memory", "--to", restoreTarget, "--via", "gh");
    const restored = new Workspace(restoreTarget, { maintain: false });
    expect(restored.readText("notes/remote.md")).toBe("local kept\n");
    expect(restored.readJson(".kaitu/secrets.json")).toEqual({});
    const occupied = join(home, "occupied");
    fs.mkdirSync(occupied);
    fs.writeFileSync(join(occupied, "keep.txt"), "keep existing data");
    const remote = {
      inspect: async () => ({ private: true, branch: "main" }),
      read: async () => ({ head: "synthetic", files: before }),
      push: async () => "synthetic",
    };
    for (const target of [restoreTarget, occupied])
      await expect(
        restoreWorkspaceBackup(target, undefined, { repo: "synthetic/kaitu-ai-memory", via: "gh" }, remote),
      ).rejects.toBeInstanceOf(KaituError);
    expect(fs.readdirSync(occupied)).toEqual(["keep.txt"]);
    expect(fs.readFileSync(join(occupied, "keep.txt"), "utf8")).toBe("keep existing data");

    const selectedPrompt = workspaceBackupPrompts(restored, "synthetic/kaitu-ai-memory", {
      text: false,
      records: false,
    });
    const cachedStatus = workspaceBackupStatus(restored);
    expect(cachedStatus.connection).toMatchObject({ text: true, records: true });
    const connectFlags = (prompt: string) =>
      /kaitu backup connect [^\n]+/.exec(prompt)?.[0].match(/--(?:no-)?(?:text|records)\b/g) ?? [];
    const flags = connectFlags(selectedPrompt.create);
    const prompted = JSON.parse(
      (await runCli("connect", "synthetic/kaitu-ai-memory", ...flags, "--dir", restoreTarget)).stdout,
    );
    expect(prompted.connection).toMatchObject({ text: false, records: false });
    expect(workspaceBackupStatus(restored)).toEqual(cachedStatus);
    invalidateWorkspaceBackup(restored);
    expect(workspaceBackupStatus(restored)).toMatchObject({
      connection: { text: false, records: false },
      lastSync: prompted.lastSync,
    });
    expect(prompted.lastSync).not.toBe(cachedStatus.lastSync);
    restored.writeText("notes/excluded.md", "must stay local");
    restored.writeJson("phone/today.json", { private: "must stay local" });
    restored.writeText("inbox/agents/excluded.md", "must stay local");
    restored.writeJson("inbox/health/excluded.health.json", { private: "must stay local" });
    const reconnected = JSON.parse(
      (await runCli("connect", "synthetic/kaitu-ai-memory", "--dir", restoreTarget)).stdout,
    );
    expect(reconnected).toMatchObject({ connection: { text: false, records: false }, error: null });
    invalidateWorkspaceBackup(restored);
    expect(workspaceBackupStatus(restored)).toMatchObject({
      connection: { text: false, records: false },
      lastSync: reconnected.lastSync,
    });
    const reopened = new Workspace(restoreTarget, { maintain: false });
    const fallback = workspaceBackupPrompts(reopened, "synthetic/kaitu-ai-memory");
    const fallbackFlags = connectFlags(fallback.create);
    await connectWorkspaceBackup(
      reopened,
      {
        repo: "synthetic/kaitu-ai-memory",
        text: fallbackFlags.includes("--text"),
        records: fallbackFlags.includes("--records"),
      },
      remote,
    );
    expect(workspaceBackupStatus(reopened).connection).toMatchObject({ text: false, records: false });
    const filtered = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    const uploaded = filtered.trees[filtered.commits[filtered.head].tree.sha];
    for (const path of [
      "notes/excluded.md",
      "phone/today.json",
      "inbox/agents/excluded.md",
      "inbox/health/excluded.health.json",
    ])
      expect(uploaded[path]).toBeUndefined();
    expect(uploaded["notes/remote.md"]).toBe("local kept\n");
    await connectWorkspaceBackup(
      reopened,
      { repo: "synthetic/other" },
      {
        inspect: async () => ({ private: true, branch: "main" }),
        read: async () => ({ head: null, files: {} }),
        push: async () => "synthetic",
      },
    );
    expect(workspaceBackupStatus(reopened).connection).toMatchObject({
      repo: "synthetic/other",
      text: false,
      records: false,
    });
  } finally {
    vi.unstubAllEnvs();
  }
});

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
  const skillFiles = [".agents", ".claude"].map((base) =>
    join(code, base, "skills/kaitu-project-memory/SKILL.md"),
  );
  const mkdir = fs.mkdirSync;
  const denied = vi.spyOn(fs, "mkdirSync").mockImplementation(((path, options) => {
    if (String(path).startsWith(join(code, ".agents")))
      throw Object.assign(new Error("synthetic permission denied"), { code: "EPERM" });
    return mkdir(path, options);
  }) as typeof fs.mkdirSync);
  try {
    const error = await installProjectMemory(ws, code).catch((error) => error);
    expect(error).toBeInstanceOf(KaituError);
    expect(error.code).toBe("AGENT_PERMISSION_REQUIRED");
    for (const path of skillFiles) expect(error.message).toContain(path);
    expect(skillFiles.some((path) => fs.existsSync(path))).toBe(false);
  } finally {
    denied.mockRestore();
  }
  await installProjectMemory(ws, code);
  fs.writeFileSync(skillFiles[1] as string, "user-owned skill\n");
  await expect(installProjectMemory(ws, code)).rejects.toMatchObject({ code: "CONFLICT" });
  expect(fs.readFileSync(skillFiles[1] as string, "utf8")).toBe("user-owned skill\n");
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
