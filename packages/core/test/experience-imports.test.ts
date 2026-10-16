import { rmSync } from "node:fs";
import { expect, it, vi } from "vitest";
import {
  type ExperienceInput,
  Workspace,
  addExperiences,
  changeExperienceBatch,
  editExperience,
  hideExperience,
  lifeMap,
  previewExperienceBatch,
  readExperienceImports,
  readRecordRevisions,
  recoverExperienceImports,
  setExperienceSource,
  validateWorkspace,
  writeAgentRecord,
} from "../src/index.js";
import { freshWorkspace } from "./helpers.js";

const experience = (title: string, start: string, source: string): ExperienceInput => ({
  title,
  start,
  source,
  place: { name: "巴黎", country: "FR" },
  fact_status: "user_reported",
  event_type: "travel",
  time_precision: "year",
});

it("排除一份来源跨定位行生效，批次撤销只影响原导入且恢复不覆盖后续人工修改", async () => {
  const ws = await freshWorkspace();
  try {
    const input: [ExperienceInput, ExperienceInput] = [
      experience("首访", "2018", "memory/travel.md#L1"),
      experience("再访", "2021", "memory/travel.md#L8"),
    ];
    const imported = await addExperiences(ws, input);
    const other = await addExperiences(ws, [experience("独立来源", "2024", "memory/other.md")]);
    expect(readExperienceImports(ws).batches).toHaveLength(2);
    await setExperienceSource(ws, input[0].source, true, 0);
    const reopened = new Workspace(ws.root);
    expect(
      (await addExperiences(reopened, [experience("应排除", "2025", "memory/travel.md:L90")])).excluded,
    ).toBe(1);
    expect(
      (await addExperiences(reopened, [experience("另一来源的新经历", "2025", "memory/other.md")])).added,
    ).toBe(1);
    await expect(setExperienceSource(reopened, input[0].source, false, 0)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    await expect(
      writeAgentRecord(ws, "add", "experience_source", "AI", {
        locator: "memory/travel.md",
        excluded: false,
      }),
    ).rejects.toMatchObject({ code: "USER_DECISION" });
    await setExperienceSource(reopened, input[0].source, false, 1);
    const [first, second] = imported.entries;
    const batchId = imported.batch_id;
    const otherFirst = other.entries[0];
    if (!first || !second || !batchId || !otherFirst) throw new Error("导入没有产生预期经历");
    await editExperience(
      reopened,
      first.id,
      { ...input[0], place: { name: "里昂", country: "FR" }, start: "2019" },
      1,
    );
    const preview = previewExperienceBatch(reopened, batchId, "undo");
    expect(preview.affected.map((r) => r.id)).toEqual([second.id]);
    expect(preview.preserved.map((r) => r.id)).toEqual([first.id]);
    await changeExperienceBatch(reopened, batchId, "undo", preview.revision);
    expect(lifeMap(reopened).experiences.some((r) => r.id === first.id && r.start === "2019")).toBe(true);
    expect(lifeMap(reopened).experiences.some((r) => r.id === otherFirst.id)).toBe(true);
    expect(
      (
        await addExperiences(
          reopened,
          input.map((r) => ({ ...r, source: "memory/travel.md#L100" })),
        )
      ).added,
    ).toBe(0);
    await changeExperienceBatch(reopened, batchId, "restore", 2);
    expect(lifeMap(reopened).experiences).toHaveLength(4);
    expect(readRecordRevisions(reopened, "experience").filter((r) => r.id === first.id)).toHaveLength(2);
    await hideExperience(reopened, second.id, 3);
    await changeExperienceBatch(reopened, batchId, "undo", 3);
    await changeExperienceBatch(reopened, batchId, "restore", 4);
    expect(lifeMap(reopened).experiences.some((r) => r.id === second.id)).toBe(false);
    expect(validateWorkspace(reopened)).toEqual([]);
  } finally {
    rmSync(ws.root, { recursive: true, force: true });
  }
});

it("跨文件导入中断后重启能补完批次，不重复已写入经历，非法整批无记录与恢复作业", async () => {
  const ws = await freshWorkspace();
  try {
    const append = ws.appendLine.bind(ws);
    const fault = vi.spyOn(ws, "appendLine").mockImplementation((path, line) => {
      if (path.startsWith("explore/data/imports/")) throw new Error("模拟存储中断");
      append(path, line);
    });
    await expect(addExperiences(ws, [experience("可恢复", "2022", "memory/travel.md")])).rejects.toThrow(
      "模拟存储中断",
    );
    fault.mockRestore();
    const reopened = new Workspace(ws.root);
    expect(readExperienceImports(reopened).pending).toHaveLength(1);
    expect(lifeMap(reopened).experiences).toHaveLength(0);
    expect(lifeMap(reopened).importsPending).toBe(1);
    expect(await recoverExperienceImports(reopened)).toHaveLength(1);
    expect(readExperienceImports(reopened).pending).toHaveLength(0);
    expect(readExperienceImports(reopened).batches).toHaveLength(1);
    expect(readRecordRevisions(reopened, "experience")).toHaveLength(1);
    expect((await addExperiences(reopened, [experience("重试", "2022", "memory/travel.md#L1")])).added).toBe(
      0,
    );
    await expect(
      addExperiences(reopened, [
        experience("合法前一条", "2023", "memory/travel.md"),
        experience("非法后一条", "2026-99", "memory/travel.md"),
      ]),
    ).rejects.toThrow();
    expect(readRecordRevisions(reopened, "experience")).toHaveLength(1);
    expect(readExperienceImports(reopened).pending).toHaveLength(0);
    expect(validateWorkspace(reopened)).toEqual([]);
  } finally {
    vi.restoreAllMocks();
    rmSync(ws.root, { recursive: true, force: true });
  }
});
