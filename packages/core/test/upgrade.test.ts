import { rmSync, statSync } from "node:fs";
import { expect, it } from "vitest";
import {
  type ModuleDef,
  Workspace,
  addRecord,
  createProject,
  doctor,
  history,
  readRecords,
  readWorkbench,
  snapshot,
  upgradeWorkspace,
  validateWorkspace,
  workspaceFileStamps,
} from "../src/index.js";
import { freshWorkspace } from "./helpers.js";

it("旧模板升级补类型和模块、覆盖内置技能，保留用户内容，预览及重复升级不写入", async () => {
  const original = await freshWorkspace();
  try {
    const me = original.readJson<ModuleDef>("me/module.json");
    me.name = "我的生活";
    const { task: _task, ...oldMeRecords } = me.records ?? {};
    me.records = oldMeRecords;
    original.writeJson("me/module.json", me);
    const health = original.readJson<ModuleDef>("health/module.json");
    const {
      photo: _photo,
      symptom: _symptom,
      mood: _mood,
      heart_notification: _heart,
      ...oldHealthRecords
    } = health.records ?? {};
    health.records = oldHealthRecords;
    health.visibility = "agent";
    health.agent = { instructions: "用户自己的指令" };
    health.records = {
      ...health.records,
      custom: { path: "data/custom/{YYYY-MM}.jsonl", schema: "schemas/metric.schema.json" },
    };
    const originalView = health.views?.[0];
    health.views = [{ ...(originalView as object), y: "custom_value" }];
    health.sources = [{ type: "import", id: "apple-health", custom: true } as { type: string; id: string }];
    health.tabs = ["workouts", "custom-tab"];
    original.writeJson("health/module.json", health);
    rmSync(original.resolve("projects"), { recursive: true });
    rmSync(original.resolve("inbox/health"), { recursive: true });
    const config = original.readJson<Record<string, unknown>>(".kaitu/config.json");
    config.template_version = undefined;
    original.writeJson(".kaitu/config.json", config, { internal: true });
    original.writeText(".agents/skills/log-workout/SKILL.md", "旧技能");
    original.writeText(".claude/skills/log-workout/obsolete.txt", "旧附件");
    original.writeText(".agents/skills/my-skill/SKILL.md", "自建技能");
    original.writeText(".claude/skills/my-skill/SKILL.md", "另一份自建技能");
    original.writeText("AGENTS.md", `${original.readText("AGENTS.md")}我的补充说明\n`);
    await snapshot(original, "旧工作区与自定义内容");
    const beforeHistory = await history(original);
    const beforeStamps = workspaceFileStamps(original);
    const configStamp = statSync(original.resolve(".kaitu/config.json", { internal: true })).mtimeMs;
    const ws = new Workspace(original.root, { maintain: false });
    expect(readWorkbench(ws).warnings.length).toBeGreaterThan(0);
    expect((await doctor(ws)).some((check) => !check.ok)).toBe(true);
    const preview = await upgradeWorkspace(ws, { dryRun: true });
    expect(preview.changes.length).toBeGreaterThan(0);
    expect(workspaceFileStamps(ws)).toEqual(beforeStamps);
    expect(await history(ws)).toEqual(beforeHistory);
    expect(statSync(ws.resolve(".kaitu/config.json", { internal: true })).mtimeMs).toBe(configStamp);
    const upgraded = await upgradeWorkspace(ws);
    expect(upgraded.version).not.toBeNull();
    expect(upgraded.validation).toEqual([]);
    expect(upgraded.checks?.filter((check) => !check.ok)).toEqual([]);
    expect(await history(ws)).toHaveLength(beforeHistory.length + 1);
    expect(ws.readJson<ModuleDef>("me/module.json").name).toBe(me.name);
    const after = ws.readJson<ModuleDef>("health/module.json");
    expect(after.agent).toEqual(health.agent);
    expect(after.visibility).toBe(health.visibility);
    expect(after.records?.custom).toEqual(health.records.custom);
    expect(after.views?.[0]).toEqual(health.views[0]);
    expect(after.sources?.[0]).toEqual(health.sources[0]);
    expect(after.tabs).toContain("custom-tab");
    expect(ws.readText(".agents/skills/log-workout/SKILL.md")).toBe(
      ws.readText(".claude/skills/log-workout/SKILL.md"),
    );
    expect(ws.exists(".claude/skills/log-workout/obsolete.txt")).toBe(false);
    expect(ws.readText(".agents/skills/my-skill/SKILL.md")).toBe("自建技能");
    expect(ws.readText(".claude/skills/my-skill/SKILL.md")).toBe("另一份自建技能");
    expect(ws.readText("AGENTS.md").endsWith("我的补充说明\n")).toBe(true);
    expect(readWorkbench(ws).warnings).toEqual([]);
    const upgradedStamps = workspaceFileStamps(ws);
    const versions = await history(ws);
    expect((await upgradeWorkspace(ws)).changes).toEqual([]);
    expect(workspaceFileStamps(ws)).toEqual(upgradedStamps);
    expect(await history(ws)).toEqual(versions);
    addRecord(ws, "task", { title: "合成待办", status: "open" });
    addRecord(ws, "photo", { file: "files/photos/2026-10-15-01J9Z8Y7X6W5V4T3S2R1Q0P9N8.jpg", pose: "front" });
    addRecord(ws, "workout", { modality: "cardio", exercise: "跑步", duration_min: 30, distance_km: 5 });
    const project = await createProject(ws, { title: "合成项目", kind: "personal" });
    addRecord(ws, "project_metric", { project: project.slug, kind: "words", value: 200 });
    addRecord(ws, "symptom", { kind: "appetite_changes", appetite_change: "decreased", source: "user" });
    addRecord(ws, "mood", { valence: "slightly_unpleasant", source: "user" });
    addRecord(ws, "heart_notification", { kind: "low_heart_rate", source: "apple-health" });
    for (const type of [
      "task",
      "photo",
      "workout",
      "project_metric",
      "symptom",
      "mood",
      "heart_notification",
    ])
      expect(readRecords(ws, type)).toHaveLength(1);
    expect(validateWorkspace(ws)).toEqual([]);
  } finally {
    rmSync(original.root, { recursive: true, force: true });
  }
});
