import childProcess from "node:child_process";
import fs from "node:fs";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import git from "isomorphic-git";
import { expect, it, vi } from "vitest";
import {
  Workspace,
  addRecord,
  addTask,
  createProject,
  defaultRoot,
  disableSync,
  doctor,
  enableDrive,
  enableSync,
  history,
  historyDirectory,
  initWorkspace,
  mcpToken,
  moveWorkspace,
  pendingWorkspaceFiles,
  processInbox,
  readProject,
  readRecords,
  readStatus,
  refreshOverview,
  restore,
  snapshot,
  stateDirectory,
  syncStatus,
  validateWorkspace,
} from "../src/index.js";
import { requestICloudDownload, syncInventory } from "../src/sync-files.js";
import { tmp, workout } from "./helpers.js";

it("iCloud 往返保持数据、历史、密钥与项目，自定义目录仍可识别且拒绝跨云迁移", async () => {
  const home = tmp();
  const platform = Object.getOwnPropertyDescriptor(process, "platform") as PropertyDescriptor;
  Object.defineProperty(process, "platform", { value: "darwin" });
  vi.stubEnv("HOME", home);
  vi.stubEnv("KAITU_DIR", "");
  const download = vi.spyOn(childProcess, "spawn").mockImplementation(() => {
    const child = new childProcess.ChildProcess();
    queueMicrotask(() => child.emit("error", new Error("模拟下载服务不可用")));
    return child;
  });
  try {
    const cloud = join(home, "Library/Mobile Documents/com~apple~CloudDocs");
    const ws = await initWorkspace(join(home, "kaitu"));
    const token = mcpToken(ws);
    const added = addRecord(ws, "workout", workout);
    const project = await createProject(ws, { title: "项目", kind: "personal" });
    const taskMarker = "synthetic-icloud-task";
    const task = await addTask(ws, { title: taskMarker, project: project.slug });
    await snapshot(ws, "迁移前");
    const before = await history(ws);
    await expect(enableSync(ws, "icloud")).rejects.toThrow();
    expect(readRecords(ws, "workout")[0]).toEqual(added.record);
    mkdirSync(cloud, { recursive: true });
    const result = await enableSync(ws, "icloud");
    expect(result.mode).toBe("icloud");
    expect(readRecords(ws, "task").find((row) => row.id === task.record.id)?.title).toBe(taskMarker);
    const crafted = join(home, `--option space'";\n$(touch injected)`);
    requestICloudDownload(crafted);
    expect(download).toHaveBeenLastCalledWith(
      "/usr/bin/brctl",
      ["download", crafted],
      expect.objectContaining({ shell: false }),
    );
    expect(ws.root).toBe(join(cloud, "kaitu"));
    expect(defaultRoot()).toBe(ws.root);
    expect(readdirSync(join(ws.root, ".kaitu"))).toEqual(["config.json"]);
    expect(historyDirectory(ws).startsWith(ws.root)).toBe(false);
    expect(existsSync(historyDirectory(ws))).toBe(true);
    expect(mcpToken(ws)).toBe(token);
    expect(ws.exists("AGENT-README.md")).toBe(false);
    expect(ws.exists("ORGANIZER.md")).toBe(false);
    expect(ws.exists("OVERVIEW.md")).toBe(true);
    expect((await history(ws)).slice(1)).toEqual(before);
    expect((await doctor(ws)).every((check) => check.ok)).toBe(true);
    expect(validateWorkspace(ws)).toEqual([]);
    await expect(enableDrive(ws, { driveDir: home })).rejects.toThrow();
    await restore(ws, before[0]?.oid as string);
    expect(syncStatus(ws).mode).toBe("icloud");
    const state = stateDirectory(ws.root);
    await disableSync(ws);
    expect(stateDirectory(ws.root)).toBe(join(home, "kaitu/.kaitu"));
    expect(existsSync(state)).toBe(false);
    expect(mcpToken(ws)).toBe(token);
    expect(readProject(ws, project.slug).dir).toBe(`projects/${project.slug}`);
    expect(readRecords(ws, "workout")[0]).toEqual(added.record);
    expect(validateWorkspace(ws)).toEqual([]);
    const custom = join(home, "custom");
    mkdirSync(custom);
    await enableSync(ws, "icloud", { dir: custom, name: "life" });
    expect(syncStatus(new Workspace(ws.root)).mode).toBe("icloud");
    await disableSync(ws);
    expect(syncStatus(ws).mode).toBe("local");
    expect(readRecords(ws, "task").find((row) => row.id === task.record.id)?.title).toBe(taskMarker);
    expect(readRecords(ws, "workout")[0]).toEqual(added.record);
  } finally {
    download.mockRestore();
    Object.defineProperty(process, "platform", platform);
    vi.unstubAllEnvs();
    rmSync(home, { recursive: true, force: true });
  }
});

it("doctor 报出冲突与未下载文件，扫描跳过且不覆盖原件或生成删除版本", async () => {
  const home = tmp();
  const platform = Object.getOwnPropertyDescriptor(process, "platform") as PropertyDescriptor;
  Object.defineProperty(process, "platform", { value: "darwin" });
  vi.stubEnv("HOME", home);
  const io = vi.spyOn(childProcess, "spawn").mockImplementation(() => new childProcess.ChildProcess());
  try {
    const cloud = join(home, "Library/Mobile Documents/com~apple~CloudDocs");
    mkdirSync(cloud, { recursive: true });
    const ws = await initWorkspace(join(home, "kaitu"));
    const added = addRecord(ws, "workout", workout);
    await enableSync(ws, "icloud");
    const stamp = new Date().toISOString();
    const handoff = (agent: string) =>
      `---\nagent: ${agent}\nat: ${stamp}\n---\n## 当前下一步\n- 合成下一步\n`;
    const retained = handoff("retained-agent");
    const offline = handoff("offline-agent");
    ws.writeText("handoffs/relay.md", retained);
    ws.writeText("handoffs/offline.md", offline);
    await snapshot(ws, "同步前");
    const versions = await history(ws);
    const conflicts = [
      "NOW 2.md",
      "handoffs/relay 2.md",
      "handoffs/relay (1).md",
      "handoffs/relay (Conflicted Copy).md",
      "handoffs/relay [Conflict].md",
    ];
    writeFileSync(join(ws.root, conflicts[0] as string), "损坏的冲突数据");
    for (const file of conflicts.slice(1)) writeFileSync(join(ws.root, file), handoff("conflict-agent"));
    rmSync(join(ws.root, "handoffs/offline.md"));
    const offlinePlaceholder = "handoffs/.offline.md.icloud";
    writeFileSync(join(ws.root, offlinePlaceholder), "");
    const original = readFileSync(join(ws.root, added.file));
    rmSync(join(ws.root, added.file));
    const slash = added.file.lastIndexOf("/");
    const placeholder = `${added.file.slice(0, slash)}/.${added.file.slice(slash + 1)}.icloud`;
    writeFileSync(join(ws.root, placeholder), "");
    const healthPlaceholder = "inbox/health/.export.zip.icloud";
    writeFileSync(join(ws.root, healthPlaceholder), "");
    const checks = await doctor(ws);
    const reported = checks.filter((check) => !check.ok).flatMap((check) => check.files ?? []);
    expect(reported).toEqual(expect.arrayContaining([...conflicts, added.file, "handoffs/offline.md"]));
    expect(validateWorkspace(ws)).toEqual([]);
    const inbox = await processInbox(ws, { stableMs: 1 });
    expect(inbox.processed).toEqual([]);
    expect(inbox.notes).toEqual([]);
    expect(existsSync(join(ws.root, healthPlaceholder))).toBe(true);
    expect(readRecords(ws, "workout")).toEqual([]);
    expect(readStatus(ws).recent7.workouts).toBe(0);
    refreshOverview(ws);
    expect(ws.readText("OVERVIEW.md")).toContain("retained-agent");
    expect(ws.readText("OVERVIEW.md")).not.toContain("conflict-agent");
    expect(ws.readText("OVERVIEW.md")).not.toContain("offline-agent");
    expect(() => ws.writeText(added.file, "")).toThrow();
    expect(() => addRecord(ws, "workout", workout)).toThrow();
    ws.writeText("handoffs/relay.md", `${retained}\n正常更新\n`);
    const pending = await pendingWorkspaceFiles(ws);
    expect(pending).toContain("handoffs/relay.md");
    expect(pending).not.toContain(added.file);
    expect(pending).not.toContain("handoffs/offline.md");
    const oid = await snapshot(ws, "保存已下载文件，不删除未下载数据");
    expect(oid).not.toBeNull();
    expect(await history(ws)).toHaveLength(versions.length + 1);
    for (const [file, bytes] of [
      [added.file, original],
      ["handoffs/offline.md", Buffer.from(offline)],
    ] as const) {
      const { blob } = await git.readBlob({
        fs,
        dir: ws.root,
        gitdir: historyDirectory(ws),
        oid: oid as string,
        filepath: file,
      });
      expect(Buffer.from(blob)).toEqual(bytes);
    }
    const tracked = await git.listFiles({
      fs,
      dir: ws.root,
      gitdir: historyDirectory(ws),
      ref: oid as string,
    });
    for (const file of [...conflicts, placeholder, offlinePlaceholder, healthPlaceholder])
      expect(tracked).not.toContain(file);
    await restore(ws, versions[0]?.oid as string, { path: "handoffs/relay.md" });
    expect(ws.readText("handoffs/relay.md")).toBe(retained);
    await expect(restore(ws, versions[0]?.oid as string, { path: added.file })).rejects.toThrow();
    await expect(restore(ws, versions[0]?.oid as string)).rejects.toThrow();
    expect(io.mock.calls.filter(([, args]) => args?.[1] === join(ws.root, added.file))).toHaveLength(1);
    await expect(disableSync(ws)).rejects.toThrow();
    expect(existsSync(join(ws.root, placeholder))).toBe(true);
    expect(existsSync(join(ws.root, added.file))).toBe(false);
    expect(conflicts.every((file) => existsSync(join(ws.root, file)))).toBe(true);
    rmSync(join(ws.root, placeholder));
    rmSync(join(ws.root, offlinePlaceholder));
    rmSync(join(ws.root, healthPlaceholder));
    writeFileSync(join(ws.root, added.file), original);
    writeFileSync(join(ws.root, "handoffs/offline.md"), handoff("downloaded-agent"));
    expect(readRecords(new Workspace(ws.root), "workout")[0]).toEqual(added.record);
  } finally {
    io.mockRestore();
    Object.defineProperty(process, "platform", platform);
    vi.unstubAllEnvs();
    rmSync(home, { recursive: true, force: true });
  }
});

it("坚果云往返：资料进同步文件夹、状态留本机；冲突副本不进版本，「沟通-冲突解决」这类普通名字照常保存", async () => {
  const home = tmp();
  vi.stubEnv("HOME", home);
  vi.stubEnv("KAITU_DIR", "");
  try {
    const ws = await initWorkspace(join(home, "kaitu"));
    const added = addRecord(ws, "workout", workout);
    const token = mcpToken(ws);
    await snapshot(ws, "迁移前");
    await expect(enableSync(ws, "drive", { provider: "nutstore" })).rejects.toThrow("坚果云");
    const nutstore = join(home, "Nutstore Files/我的坚果云");
    mkdirSync(nutstore, { recursive: true });
    expect(syncStatus(ws).suggested.nutstore).toBe(nutstore);
    const result = await enableSync(ws, "drive", { provider: "nutstore" });
    expect(result).toMatchObject({ mode: "drive", provider: "nutstore", root: join(nutstore, "kaitu") });
    expect(readdirSync(join(ws.root, ".kaitu"))).toEqual(["config.json"]);
    expect(historyDirectory(ws).startsWith(nutstore)).toBe(false);
    expect(mcpToken(ws)).toBe(token);
    expect(syncStatus(new Workspace(ws.root)).provider).toBe("nutstore");
    expect(readRecords(ws, "workout")[0]).toEqual(added.record);
    const handoff = (agent: string) =>
      `---\nagent: ${agent}\nat: ${new Date().toISOString()}\n---\n## 当前下一步\n- 合成下一步\n`;
    ws.writeText("handoffs/relay.md", handoff("retained-agent"));
    await snapshot(ws, "交接");
    const conflicts = ["handoffs/relay (conflicted copy 2026-10-16).md", "handoffs/relay 2.md"];
    for (const file of conflicts) writeFileSync(join(ws.root, file), handoff("conflict-agent"));
    const reported = (await doctor(ws)).filter((check) => !check.ok).flatMap((check) => check.files ?? []);
    expect(reported).toEqual(expect.arrayContaining(conflicts));
    expect(validateWorkspace(ws)).toEqual([]);
    refreshOverview(ws);
    expect(ws.readText("OVERVIEW.md")).not.toContain("conflict-agent");
    ws.writeText("handoffs/relay.md", `${handoff("retained-agent")}\n正常更新\n`);
    ws.writeText("learning/沟通/notes.md", "# 沟通\n");
    ws.writeText("learning/沟通-冲突解决/notes.md", "# 冲突解决\n先复述对方的意思\n");
    expect(ws.scanText("learning/沟通-冲突解决/notes.md")).toContain("先复述对方的意思");
    const oid = await snapshot(ws, "冲突副本不进版本");
    const tracked = await git.listFiles({
      fs,
      dir: ws.root,
      gitdir: historyDirectory(ws),
      ref: oid as string,
    });
    for (const file of conflicts) expect(tracked).not.toContain(file);
    expect(tracked).toContain("learning/沟通-冲突解决/notes.md");
    for (const file of conflicts) rmSync(join(ws.root, file));
    // 同步中换成另一种同步方式，记下的同步方式跟着换。
    mkdirSync(join(home, "Sync"));
    await moveWorkspace(ws, join(home, "Sync/kaitu"), true, "folder");
    expect(syncStatus(new Workspace(ws.root))).toMatchObject({ mode: "drive", provider: "folder" });
    expect(readRecords(ws, "workout")[0]).toEqual(added.record);
    await disableSync(ws, { to: join(home, "back") });
    expect(syncStatus(ws)).toMatchObject({ mode: "local", provider: "local" });
    expect(readRecords(ws, "workout")[0]).toEqual(added.record);
    expect(mcpToken(ws)).toBe(token);
    expect(validateWorkspace(ws)).toEqual([]);
  } finally {
    vi.unstubAllEnvs();
    rmSync(home, { recursive: true, force: true });
  }
});
