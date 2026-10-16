import childProcess from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import {
  Workspace,
  addRecord,
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
import { tmp, workout } from "./helpers.js";

it("iCloud 往返保持数据、历史、密钥与本机项目，自定义目录仍可识别且拒绝跨云迁移", async () => {
  const home = tmp();
  const platform = Object.getOwnPropertyDescriptor(process, "platform") as PropertyDescriptor;
  Object.defineProperty(process, "platform", { value: "darwin" });
  vi.stubEnv("HOME", home);
  vi.stubEnv("KAITU_DIR", "");
  const execute = childProcess.execFileSync;
  const download = vi.spyOn(childProcess, "execFileSync").mockImplementation((file, args, options) => {
    if (file === "brctl") throw new Error("模拟下载服务不可用");
    return execute(file, args, options);
  });
  try {
    const cloud = join(home, "Library/Mobile Documents/com~apple~CloudDocs");
    const ws = await initWorkspace(join(home, "kaitu"));
    const token = mcpToken(ws);
    const added = addRecord(ws, "workout", workout);
    const project = await createProject(ws, { title: "本机项目", kind: "personal", local_only: true });
    await snapshot(ws, "迁移前");
    const before = await history(ws);
    await expect(enableSync(ws, "icloud")).rejects.toThrow();
    expect(readRecords(ws, "workout")[0]).toEqual(added.record);
    mkdirSync(cloud, { recursive: true });
    const result = await enableSync(ws, "icloud");
    expect(result.mode).toBe("icloud");
    expect(ws.root).toBe(join(cloud, "kaitu"));
    expect(defaultRoot()).toBe(ws.root);
    expect(readdirSync(join(ws.root, ".kaitu"))).toEqual(["config.json"]);
    expect(historyDirectory(ws).startsWith(ws.root)).toBe(false);
    expect(existsSync(historyDirectory(ws))).toBe(true);
    expect(mcpToken(ws)).toBe(token);
    expect(readProject(ws, project.slug).dir.startsWith(".kaitu/local-projects/")).toBe(true);
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
  const execute = childProcess.execFileSync;
  let offline = "";
  const io = vi.spyOn(childProcess, "execFileSync").mockImplementation((file, args, options) => {
    if (file === "brctl") return Buffer.alloc(0);
    if (file === "/bin/cat" && args?.[0] === offline)
      throw Object.assign(new Error("offline"), { code: "ETIMEDOUT" });
    return execute(file, args, options);
  });
  try {
    const cloud = join(home, "Library/Mobile Documents/com~apple~CloudDocs");
    mkdirSync(cloud, { recursive: true });
    const ws = await initWorkspace(join(home, "kaitu"));
    const added = addRecord(ws, "workout", workout);
    await enableSync(ws, "icloud");
    const stamp = new Date().toISOString();
    const handoff = (agent: string) =>
      `---\nagent: ${agent}\nat: ${stamp}\n---\n## 当前下一步\n- 合成下一步\n`;
    ws.writeText("handoffs/relay.md", handoff("retained-agent"));
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
    offline = join(ws.root, "handoffs/offline.md");
    writeFileSync(offline, handoff("offline-agent"));
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
    expect(await snapshot(ws, "不应删除未下载数据")).toBeNull();
    expect(await history(ws)).toEqual(versions);
    await expect(restore(ws, versions[0]?.oid as string)).rejects.toThrow();
    await expect(disableSync(ws)).rejects.toThrow();
    expect(existsSync(join(ws.root, placeholder))).toBe(true);
    expect(existsSync(join(ws.root, added.file))).toBe(false);
    expect(conflicts.every((file) => existsSync(join(ws.root, file)))).toBe(true);
    rmSync(join(ws.root, placeholder));
    rmSync(join(ws.root, healthPlaceholder));
    writeFileSync(join(ws.root, added.file), original);
    offline = "";
    writeFileSync(join(ws.root, "handoffs/offline.md"), handoff("downloaded-agent"));
    expect(readRecords(new Workspace(ws.root), "workout")[0]).toEqual(added.record);
  } finally {
    io.mockRestore();
    Object.defineProperty(process, "platform", platform);
    vi.unstubAllEnvs();
    rmSync(home, { recursive: true, force: true });
  }
});
