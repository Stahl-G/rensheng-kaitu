import { cpSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { expect, it } from "vitest";
import { assertAgentWrite } from "../src/agent-file-policy.js";
import { isTracked } from "../src/history.js";
import {
  Workspace,
  addMemory,
  addRecord,
  archiveMemory,
  configureProfilePublisher,
  deleteRecord,
  handoverPack,
  history,
  initWorkspace,
  memoryExpectation,
  readRecords,
  refreshOverview,
  refreshUserProfile,
  restore,
  snapshot,
  updateRecord,
  upgradeWorkspace,
  validateWorkspace,
} from "../src/index.js";
import { setStateBinding } from "../src/state-binding.js";
import {
  type BackupFiles,
  type BackupRemote,
  connectWorkspaceBackup,
  syncWorkspaceBackup,
} from "../src/workspace-backup.js";
import { tmp } from "./helpers.js";

it("共享画像撤下已删除/归档/敏感资料，单发布端生成，不写历史与备份", async () => {
  const ws = await initWorkspace(join(tmp(), "ws"));
  addRecord(ws, "finance_account", {
    name: "SYNTH_FINANCE",
    kind: "wallet",
    source: "manual",
    currency: "CNY",
  });
  expect(handoverPack(ws, "en", new Date(), true).sections.some((section) => section.id === "finance")).toBe(
    true,
  );
  const task = addRecord(
    ws,
    "task",
    { title: "旧任务", status: "open", ts: "2026-09-01T12:00:00+08:00" },
    { by: "user" },
  );
  await addMemory(ws, {
    type: "fact",
    name: "current",
    text: "现在住杭州 /Users/synthetic/private token: synthetic-password",
  });
  const old = await addMemory(ws, { type: "fact", name: "old", text: "以前住上海" });
  await addMemory(ws, { type: "fact", name: "secret", text: "私密代号SYNTH", sensitive: true });
  addRecord(ws, "phase", { title: "写第一本书", start: "2026-01", status: "confirmed" }, { by: "user" });
  configureProfilePublisher(ws, true);
  expect(ws.readText("USER.md")).toContain("旧任务");
  await archiveMemory(ws, old.file, { by: "user", expected: memoryExpectation(old) });
  deleteRecord(ws, "task", task.record.id, { by: "user", now: new Date("2026-10-23T12:00:00Z") });
  refreshOverview(ws);
  const text = ws.readText("USER.md");
  for (const hidden of [
    "旧任务",
    "以前住上海",
    "私密代号SYNTH",
    "/Users/synthetic",
    "synthetic-password",
    "SYNTH_FINANCE",
    "CNY",
  ])
    expect(text).not.toContain(hidden);
  expect(text).toContain("写第一本书");
  expect(text).toContain("memory/fact_current.md");
  expect(() => assertAgentWrite(ws.root, "USER.md", true)).toThrow();
  const before = readFileSync(ws.resolve(task.file));
  rmSync(ws.resolve("USER.md"));
  expect(readRecords(ws, "task")).toEqual([]);
  expect(readFileSync(ws.resolve(task.file))).toEqual(before);
  refreshOverview(ws);
  await snapshot(ws, "synthetic snapshot");
  expect(await isTracked(ws, "USER.md")).toBe(false);
  let files: BackupFiles = {};
  const remote: BackupRemote = {
    inspect: async () => ({ private: true, branch: "main" }),
    read: async () => ({ head: null, files: {} }),
    push: async (_repo, _branch, _head, incoming) => {
      files = incoming;
      return "synthetic-head";
    },
  };
  await connectWorkspaceBackup(ws, { repo: "synthetic/memory", text: true, records: true }, remote);
  await syncWorkspaceBackup(ws, remote);
  expect(files["USER.md"]).toBeUndefined();
  const secondRoot = join(tmp(), "second");
  cpSync(ws.root, secondRoot, { recursive: true });
  setStateBinding(secondRoot, join(tmp(), "second-state"), "drive");
  const second = new Workspace(secondRoot, { maintain: false });
  expect(refreshUserProfile(second).status).toBe("disabled");
  expect(configureProfilePublisher(second, true).status).toBe("other-publisher");
  addRecord(second, "task", { title: "第二台正常写", status: "open" }, { by: "user" });
  expect(readRecords(second, "task")).toHaveLength(1);
  expect(second.readText("USER.md")).toBe(ws.readText("USER.md"));
});

it("来源占位撤下旧正文，恢复后再生成；画像占位不阻断修改、删除、恢复和升级", async () => {
  const original = await initWorkspace(join(tmp(), "ws"));
  setStateBinding(original.root, original.resolve(".kaitu", { internal: true }), "icloud");
  const ws = new Workspace(original.root, { maintain: false });
  const task = addRecord(ws, "task", { title: "可撤下的合成任务", status: "open" }, { by: "user" });
  configureProfilePublisher(ws, true);
  const source = ws.resolve(task.file);
  const missing = join(dirname(source), `.${basename(source)}.icloud`);
  renameSync(source, `${source}.saved`);
  writeFileSync(missing, "");
  expect(refreshUserProfile(ws).status).toBe("unavailable");
  expect(ws.readText("USER.md")).not.toContain("可撤下的合成任务");
  rmSync(missing);
  renameSync(`${source}.saved`, source);
  expect(refreshUserProfile(ws).status).toBe("current");
  configureProfilePublisher(ws, false);
  writeFileSync(ws.resolve(".USER.md.icloud"), "");
  ws.assertDownloaded();
  updateRecord(ws, "task", task.record.id, { title: "已改" }, { by: "user" });
  const version = await snapshot(ws, "before delete");
  deleteRecord(ws, "task", task.record.id, { by: "user" });
  await snapshot(ws, "deleted");
  await restore(ws, version as string);
  expect(readRecords(ws, "task")[0]?.title).toBe("已改");
  ws.writeJson(
    ".kaitu/config.json",
    { ...ws.readJson<object>(".kaitu/config.json"), template_version: "old" },
    { internal: true },
  );
  await upgradeWorkspace(ws);
  expect(validateWorkspace(ws)).toEqual([]);
  expect((await history(ws)).length).toBeGreaterThan(1);
});
