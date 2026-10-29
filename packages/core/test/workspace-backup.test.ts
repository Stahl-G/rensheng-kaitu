import fs from "node:fs";
import { join } from "node:path";
import git from "isomorphic-git";
import { expect, it, vi } from "vitest";
import { HISTORY_MARKER } from "../src/history-ownership.js";
import { Workspace, addRecord, deleteRecord, history, readRecords, updateRecord } from "../src/index.js";
import { setStateBinding } from "../src/state-binding.js";
import {
  type BackupFiles,
  type BackupRemote,
  cancelWorkspaceBackup,
  connectWorkspaceBackup,
  disconnectWorkspaceBackup,
  resolveWorkspaceBackup,
  restoreWorkspaceBackup,
  syncWorkspaceBackup,
  workspaceBackupRequest,
  workspaceBackupStatus,
} from "../src/workspace-backup.js";
import { clonedWorkspace, tmp, workout } from "./helpers.js";

function remoteMock(isPrivate = true) {
  let files: BackupFiles = {};
  let head: string | null = null;
  let count = 0;
  const inspect = { calls: 0 };
  const remote: BackupRemote = {
    async inspect() {
      inspect.calls++;
      return { private: isPrivate, branch: "main" };
    },
    async read() {
      return { head, files: { ...files } };
    },
    async push(_repo, _branch, expected, incoming) {
      if (expected !== head) throw new Error("Remote changed");
      files = { ...incoming };
      head = String(++count);
      return head;
    },
  };
  return { remote, inspect, files: () => files, pushes: () => count };
}

it("断开或较新的连接生效后，迟到的连接核验不能覆盖用户选择", async () => {
  const ws = await clonedWorkspace();
  const { remote } = remoteMock();
  for (const change of ["disconnect", "connect"] as const) {
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const pending = connectWorkspaceBackup(
      ws,
      { repo: "synthetic/old", text: true, records: false },
      {
        ...remote,
        async inspect(repo) {
          entered();
          await gate;
          return remote.inspect(repo);
        },
      },
    );
    const rejected = expect(pending).rejects.toMatchObject({ code: "CONFLICT" });
    await started;
    if (change === "disconnect") disconnectWorkspaceBackup(ws);
    else await connectWorkspaceBackup(ws, { repo: "synthetic/new", text: true, records: false }, remote);
    const selected = ws.readText(".kaitu/workspace-backup.json");
    release();
    await rejected;
    expect(ws.readText(".kaitu/workspace-backup.json")).toBe(selected);
    expect(workspaceBackupStatus(ws).connection?.repo ?? null).toBe(
      change === "disconnect" ? null : "synthetic/new",
    );
  }
  await connectWorkspaceBackup(ws, { repo: "synthetic/retry", text: true, records: false }, remote);
  expect(workspaceBackupStatus(ws).connection?.repo).toBe("synthetic/retry");
});

it("保留用户的无 remote 仓库与 worktree 指针；有明确来源的旧历史可迁往重定向 state", async () => {
  const ws = await clonedWorkspace();
  await git.init({ fs, dir: ws.root, defaultBranch: "main" });
  fs.writeFileSync(join(ws.root, "user.txt"), "user repo");
  await git.add({ fs, dir: ws.root, filepath: "user.txt" });
  const oid = await git.commit({
    fs,
    dir: ws.root,
    message: "my own repository",
    author: { name: "Author", email: "author@example.invalid" },
  });
  const config = fs.readFileSync(join(ws.root, ".git/config"));
  new Workspace(ws.root);
  expect((await git.log({ fs, dir: ws.root }))[0]?.oid).toBe(oid);
  expect(fs.readFileSync(join(ws.root, ".git/config"))).toEqual(config);
  fs.renameSync(join(ws.root, ".git"), join(tmp(), "user.git"));
  const pointer = `gitdir: ${join(tmp(), "worktrees/author")}\n`;
  fs.writeFileSync(join(ws.root, ".git"), pointer);
  new Workspace(ws.root);
  expect(fs.readFileSync(join(ws.root, ".git"), "utf8")).toBe(pointer);
  const legacy = await clonedWorkspace();
  const before = await history(legacy);
  fs.rmSync(join(legacy.root, ".kaitu/history.git", HISTORY_MARKER));
  fs.renameSync(join(legacy.root, ".kaitu/history.git"), join(legacy.root, ".git"));
  const state = join(tmp(), "state");
  setStateBinding(legacy.root, state, "drive");
  const opened = new Workspace(legacy.root);
  expect(fs.existsSync(join(legacy.root, ".git"))).toBe(false);
  expect(fs.existsSync(join(state, "history.git"))).toBe(true);
  expect(await history(opened)).toEqual(before);
});

it("合成工作区备份、恢复、两端往返；凭据与媒体排除，重复同步不重复查可见性或提交", async () => {
  const a = await clonedWorkspace();
  a.writeText("me/profile.md", "# Synthetic author\n");
  a.writeJson("phone/life-atlas.json", { format: "kaitu.phone.life-atlas", resourceId: "synthetic" });
  a.writeJson("phone/private-unpublished.json", { secret: "synthetic" });
  a.writeJson(".kaitu/secrets.json", { github_token: "synthetic-only" }, { internal: true });
  a.writeText("health/files/example.mp4", "synthetic media");
  a.writeJson("secrets.json", { value: "synthetic-only" });
  a.writeJson("credentials.json", { value: "synthetic-only" });
  const m = remoteMock();
  await connectWorkspaceBackup(a, { repo: "synthetic/backup", text: true, records: true }, m.remote);
  await syncWorkspaceBackup(a, m.remote);
  expect(m.files()["phone/life-atlas.json"]).toContain("synthetic");
  expect(m.files()["phone/private-unpublished.json"]).toBeUndefined();
  expect(Object.keys(m.files()).some((p) => /\.kaitu|\.git|\.mp4|secrets|credentials/.test(p))).toBe(false);
  const target = join(tmp(), "restored");
  await restoreWorkspaceBackup(target, a, { repo: "synthetic/backup" }, m.remote);
  const b = new Workspace(target);
  expect(b.readText("me/profile.md")).toContain("Synthetic author");
  a.writeText("me/profile.md", "# From A\n");
  b.writeText("me/rules.md", `${b.readText("me/rules.md")}\nFrom B\n`);
  await syncWorkspaceBackup(a, m.remote);
  await syncWorkspaceBackup(b, m.remote);
  await syncWorkspaceBackup(a, m.remote);
  expect(b.readText("me/profile.md")).toBe("# From A\n");
  expect(a.readText("me/rules.md")).toContain("From B");
  const incoming = await m.remote.read("synthetic/backup", "main");
  for (let i = 0; i < 5; i++)
    incoming.files[`inbox/notes/2026-10-19/remote-${i}.md`] = `Synthetic remote note ${i}`;
  await m.remote.push("synthetic/backup", "main", incoming.head, incoming.files);
  const overviewReads = vi.spyOn(a, "scanText");
  const remoteReads = vi.spyOn(m.remote, "read");
  await syncWorkspaceBackup(a, m.remote);
  const overviewOrder = overviewReads.mock.calls.flatMap(([file], index) =>
    file === ".kaitu/config.json" ? [overviewReads.mock.invocationCallOrder[index]] : [],
  );
  expect(remoteReads).toHaveBeenCalledTimes(1);
  expect(overviewOrder).toHaveLength(2);
  expect(overviewOrder[0]).toBeLessThan(remoteReads.mock.invocationCallOrder[0]);
  expect(overviewOrder[1]).toBeGreaterThan(remoteReads.mock.invocationCallOrder[0]);
  remoteReads.mockRestore();
  overviewReads.mockRestore();
  for (let i = 0; i < 5; i++)
    expect(a.readText(`inbox/notes/2026-10-19/remote-${i}.md`)).toBe(`Synthetic remote note ${i}`);
  // The generated overview is included in the next sync, then the backup reaches a no-op.
  await syncWorkspaceBackup(a, m.remote);
  const count = m.pushes();
  const checks = m.inspect.calls;
  await syncWorkspaceBackup(a, m.remote);
  expect(m.pushes()).toBe(count);
  expect(m.inspect.calls).toBe(checks);
  let entered!: () => void;
  const reading = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const stalled: BackupRemote = {
    ...m.remote,
    async read(_repo, _branch, options) {
      options?.progress?.({ phase: "download", completed: 2, total: 20 });
      entered();
      await new Promise<void>((_resolve, reject) => {
        options?.signal?.addEventListener("abort", () => reject(options.signal?.reason), { once: true });
      });
      throw new Error("cancelled");
    },
  };
  const syncing = syncWorkspaceBackup(a, stalled);
  await reading;
  expect(workspaceBackupStatus(a).progress).toEqual({ phase: "download", completed: 2, total: 20 });
  cancelWorkspaceBackup(a);
  await syncing;
  expect(workspaceBackupStatus(a).running).toBe(false);
  expect(workspaceBackupStatus(a).error).toBeTruthy();
  expect(m.pushes()).toBe(count);
  expect(a.readText("me/profile.md")).toBe("# From A\n");
  await syncWorkspaceBackup(a, m.remote);
  expect(workspaceBackupStatus(a).error).toBeNull();
  const switching = new Workspace(a.root);
  await workspaceBackupRequest(switching, "activate", { root: target });
  expect(switching.root).toBe(target);
});

it("同记录并发修改与删除保留双方，普通不同记录可合并；选择后可继续同步", async () => {
  const a = await clonedWorkspace();
  const first = addRecord(a, "workout", workout);
  const m = remoteMock();
  await connectWorkspaceBackup(a, { repo: "synthetic/records", text: true, records: true }, m.remote);
  await syncWorkspaceBackup(a, m.remote);
  const root = join(tmp(), "b");
  await restoreWorkspaceBackup(root, a, { repo: "synthetic/records" }, m.remote);
  const b = new Workspace(root);
  addRecord(a, "workout", { ...workout, exercise: "A" });
  addRecord(b, "workout", { ...workout, exercise: "B" });
  await syncWorkspaceBackup(a, m.remote);
  await syncWorkspaceBackup(b, m.remote);
  expect(workspaceBackupStatus(b).conflicts).toEqual([]);
  await syncWorkspaceBackup(a, m.remote);
  expect(readRecords(a, "workout")).toHaveLength(3);
  updateRecord(a, "workout", first.record.id, {
    ...workout,
    exercise: "Edited",
    ts: "2026-11-01T10:00:00+08:00",
  });
  deleteRecord(b, "workout", first.record.id);
  await syncWorkspaceBackup(a, m.remote);
  await syncWorkspaceBackup(b, m.remote);
  const conflict = workspaceBackupStatus(b).conflicts[0] as NonNullable<
    ReturnType<typeof workspaceBackupStatus>["conflicts"][number]
  >;
  expect(conflict.reason).toBe("record");
  expect(conflict.local).toContain('"deleted":true');
  expect(
    workspaceBackupStatus(b)
      .conflicts.map((item) => item.remote)
      .join("\n"),
  ).toContain("Edited");
  for (const item of workspaceBackupStatus(b).conflicts) resolveWorkspaceBackup(b, item.path, "local");
  await syncWorkspaceBackup(b, m.remote);
  await syncWorkspaceBackup(a, m.remote);
  expect(readRecords(a, "workout").some((row) => row.id === first.record.id)).toBe(false);
  expect(fs.readdirSync(b.resolve(".kaitu/backup-conflicts", { internal: true })).length).toBeGreaterThan(0);
});

it("本机只开手机与待整理、远端全开且没有共同基线：清单不算冲突，解决真冲突后同步，远端其余文件和范围都留着", async () => {
  const ws = await clonedWorkspace();
  const m = remoteMock();
  const remoteNote = "inbox/agents/synthetic-handoff.md";
  await m.remote.push("synthetic/memory", "main", null, {
    "kaitu-backup.json": JSON.stringify({ format: "kaitu-workspace", version: 1, text: true, records: true }),
    "projects/synthetic/STATUS.md": "远端的项目状态",
    "health/synthetic.jsonl": '{"id":"r1"}\n',
    [remoteNote]: "远端写的交接",
    "phone/receipts.json": JSON.stringify({
      format: "kaitu.phone.receipts",
      version: 1,
      generated_at: new Date().toISOString(),
      items: [
        {
          ref: "01JAZ1B2C3D4E5F6G7H8J9K0MP",
          kind: "action",
          status: "applied",
          at: new Date().toISOString(),
        },
      ],
    }),
  });
  ws.writeText(remoteNote, "本机写的交接");
  await connectWorkspaceBackup(ws, { repo: "synthetic/memory", text: false, records: false }, m.remote);

  await syncWorkspaceBackup(ws, m.remote);
  expect(workspaceBackupStatus(ws).conflicts.map((c) => c.path)).toEqual([remoteNote]);
  expect(ws.readText(remoteNote)).toBe("本机写的交接");
  // 冲突没解决前，云端回执不提前写进本机。
  expect(ws.exists("phone/receipts.json")).toBe(false);

  resolveWorkspaceBackup(ws, remoteNote, "local");
  await syncWorkspaceBackup(ws, m.remote);
  const status = workspaceBackupStatus(ws);
  expect(status).toMatchObject({ conflicts: [], error: null, connection: { text: false, records: false } });
  expect(m.files()).toMatchObject({
    "projects/synthetic/STATUS.md": "远端的项目状态",
    "health/synthetic.jsonl": '{"id":"r1"}\n',
    [remoteNote]: "本机写的交接",
  });
  expect(JSON.parse(m.files()["kaitu-backup.json"] as string)).toMatchObject({ text: true, records: true });
  expect(ws.exists("kaitu-backup.json")).toBe(false);
  expect(ws.readText("phone/receipts.json")).toContain("01JAZ1B2C3D4E5F6G7H8J9K0MP");
  expect(ws.exists("projects/synthetic/STATUS.md")).toBe(false);

  const pushes = m.pushes();
  await syncWorkspaceBackup(ws, m.remote);
  expect(m.pushes()).toBe(pushes);
});

it("公开仓库默认不上传；后台等待与授权失败不挡住本地写入", async () => {
  const ws = await clonedWorkspace();
  const pub = remoteMock(false);
  await connectWorkspaceBackup(ws, { repo: "synthetic/public", text: true, records: true }, pub.remote);
  await syncWorkspaceBackup(ws, pub.remote);
  expect(workspaceBackupStatus(ws).connection?.enabled).toBe(false);
  expect(pub.pushes()).toBe(0);
  const m = remoteMock();
  await connectWorkspaceBackup(ws, { repo: "synthetic/private", text: true, records: true }, m.remote);
  let reject: (e: Error) => void = () => {};
  let reached: () => void = () => {};
  const reading = new Promise<void>((resolve) => {
    reached = resolve;
  });
  const waiting: BackupRemote = {
    ...m.remote,
    read: () =>
      new Promise((_resolve, no) => {
        reject = no;
        reached();
      }),
  };
  const pending = syncWorkspaceBackup(ws, waiting);
  await reading;
  ws.writeText("me/profile.md", "saved while offline\n");
  expect(workspaceBackupStatus(ws).running).toBe(true);
  reject(new Error("unauthorized"));
  await pending;
  expect(ws.readText("me/profile.md")).toBe("saved while offline\n");
  expect(workspaceBackupStatus(ws).error).toBeTruthy();
  // A vanished branch must not be mistaken for a remote deletion of all personal data.
  await syncWorkspaceBackup(ws, m.remote);
  await syncWorkspaceBackup(ws, { ...m.remote, read: async () => ({ head: null, files: {} }) });
  expect(ws.readText("me/profile.md")).toBe("saved while offline\n");
});

it("GitHub API 接通空仓库初始化、缓存回读和非强推提交，可见性只在连接时请求", async () => {
  const ws = await clonedWorkspace();
  let head: string | null = null;
  let seq = 0;
  let inspections = 0;
  const trees = new Map<string, BackupFiles>();
  const commits = new Map<string, { tree: { sha: string }; parent: string | null }>();
  const blobs = new Map<string, string>();
  const put = (files: BackupFiles, parent: string | null) => {
    const tree = `tree-${++seq}`;
    trees.set(tree, files);
    const commit = `commit-${seq}`;
    commits.set(commit, { tree: { sha: tree }, parent });
    return { sha: commit, tree: { sha: tree } };
  };
  vi.stubGlobal("fetch", async (url: string, options: RequestInit = {}) => {
    const path = new URL(url).pathname.replace("/repos/synthetic/api", "");
    const body = options.body ? JSON.parse(String(options.body)) : {};
    let value: unknown;
    if (!path) {
      inspections++;
      value = { private: true, default_branch: "main" };
    } else if (path === "/git/ref/heads/main") {
      if (!head) return new Response("{}", { status: 409 });
      value = { object: { sha: head } };
    } else if (path === "/contents/kaitu-backup.json") {
      const commit = put({ "kaitu-backup.json": Buffer.from(body.content, "base64").toString() }, null);
      head = commit.sha;
      value = { commit };
    } else if (path === "/git/trees") {
      const files = { ...trees.get(body.base_tree) };
      for (const item of body.tree) {
        if (item.sha === null) delete files[item.path];
        else files[item.path] = item.content;
      }
      const sha = `tree-${++seq}`;
      trees.set(sha, files);
      value = { sha };
    } else if (path === "/git/commits") {
      const sha = `commit-${++seq}`;
      commits.set(sha, { tree: { sha: body.tree }, parent: body.parents[0] ?? null });
      value = { sha };
    } else if (path === "/git/refs/heads/main") {
      expect(body.force).toBe(false);
      if (commits.get(body.sha)?.parent !== head) return new Response("{}", { status: 422 });
      head = body.sha;
      value = {};
    } else if (path.startsWith("/git/commits/")) value = commits.get(path.slice(13));
    else if (path.startsWith("/git/trees/")) {
      value = {
        tree: Object.entries(trees.get(path.slice(11)) ?? {}).map(([file, text]) => {
          const sha = `blob-${++seq}`;
          blobs.set(sha, text);
          return { path: file, type: "blob", mode: "100644", sha };
        }),
      };
    } else if (path.startsWith("/git/blobs/"))
      value = { content: Buffer.from(blobs.get(path.slice(11)) ?? "").toString("base64") };
    else throw new Error(`Unexpected mock endpoint: ${path}`);
    return Response.json(value);
  });
  try {
    await connectWorkspaceBackup(ws, { repo: "synthetic/api", text: true, records: true });
    await syncWorkspaceBackup(ws);
    expect(workspaceBackupStatus(ws).error).toBeNull();
    const first = head;
    await syncWorkspaceBackup(ws);
    expect(workspaceBackupStatus(ws).error).toBeNull();
    expect(head).toBe(first);
    expect(inspections).toBe(1);
    ws.writeText("me/profile.md", "changed through API");
    await syncWorkspaceBackup(ws);
    expect(head).not.toBe(first);
    expect(inspections).toBe(1);
  } finally {
    vi.unstubAllGlobals();
  }
});

it("iCloud 占位不作为本地删除上传，下载后可继续，真实删除仍可同步", async () => {
  const original = await clonedWorkspace();
  const directory = original.resolve(".kaitu", { internal: true });
  setStateBinding(original.root, directory, "icloud");
  const ws = new Workspace(original.root);
  const m = remoteMock();
  await connectWorkspaceBackup(ws, { repo: "synthetic/icloud", text: true, records: true }, m.remote);
  await syncWorkspaceBackup(ws, m.remote);
  const before = m.files()["me/profile.md"];
  const count = m.pushes();
  const path = join(ws.root, "me/profile.md");
  const placeholder = join(ws.root, "me/.profile.md.icloud");
  fs.renameSync(path, placeholder);
  await syncWorkspaceBackup(ws, m.remote);
  expect(m.files()["me/profile.md"]).toBe(before);
  expect(m.pushes()).toBe(count);
  expect(workspaceBackupStatus(ws).error).toContain("iCloud");
  expect(fs.existsSync(placeholder)).toBe(true);
  fs.renameSync(placeholder, path);
  await syncWorkspaceBackup(ws, m.remote);
  expect(workspaceBackupStatus(ws).error).toBeNull();
  fs.rmSync(path);
  await syncWorkspaceBackup(ws, m.remote);
  expect(m.files()["me/profile.md"]).toBeUndefined();
  expect(workspaceBackupStatus(ws).error).toBeNull();
});
