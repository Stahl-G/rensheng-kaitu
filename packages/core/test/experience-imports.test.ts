import { readFileSync, rmSync } from "node:fs";
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
  processInbox,
  readExperienceImports,
  readRecordRevisions,
  recoverExperienceImports,
  setExperienceSource,
  validateWorkspace,
  writeAgentRecord,
} from "../src/index.js";
import { clonedWorkspace } from "./helpers.js";

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
  const ws = await clonedWorkspace();
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
  const ws = await clonedWorkspace();
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

const photos = (): ExperienceInput[] => [
  {
    ...experience("住过京都", "2019-01", "apple-photos"),
    place: { name: "京都", country: "JP" },
    event_type: "lived",
    end: "2019-03",
    time_precision: "month",
    fact_status: "inferred",
  },
  {
    ...experience("巴黎旅行", "2020-05-02", "apple-photos"),
    end: "2020-05-06",
    time_precision: "day",
    fact_status: "inferred",
  },
  {
    ...experience("伦敦旅行", "2021-07-03", "apple-photos"),
    place: { name: "伦敦", country: "GB" },
    end: "2021-07-07",
    time_precision: "day",
    fact_status: "inferred",
  },
];

it("照片收件的三城市一批先待核对，确认后整批撤销恢复，重扫去重且关闭来源阻止新增", async () => {
  const ws = await clonedWorkspace();
  try {
    const deliver = async (name: string, rows = photos()) => {
      ws.writeText(
        `inbox/agents/${name}.records.jsonl`,
        `${rows.map((row) => JSON.stringify({ type: "experience", origin: "assistant", ...row })).join("\n")}\n`,
      );
      const result = await processInbox(ws, { stableMs: 0 });
      expect(result.notes).toEqual([]);
    };
    await expect(
      addExperiences(ws, [
        {
          ...photos()[0],
          place: { name: "京都", country: "JP", lat: 35.0211, lng: 135.7538 },
        } as ExperienceInput,
      ]),
    ).rejects.toMatchObject({ code: "BAD_ARGS" });
    await deliver("ios-synthetic-01");
    expect(lifeMap(ws).features).toHaveLength(0);
    expect(lifeMap(ws).review).toHaveLength(3);
    expect(lifeMap(ws).review.every((row) => row.by === "agent")).toBe(true);
    const [batch] = readExperienceImports(ws).batches;
    if (!batch) throw new Error("缺少照片批次");
    expect(batch.confirmable).toBe(3);
    const confirmed = await changeExperienceBatch(ws, batch.id, "confirm", batch.revision);
    expect(confirmed.affected).toBe(3);
    expect(lifeMap(ws).review).toHaveLength(0);
    expect(lifeMap(ws).features).toHaveLength(3);
    expect(readRecordRevisions(ws, "experience_batch").at(-1)?.items).toEqual(
      lifeMap(ws).experiences.map((row) => ({ id: row.id, revision: 2 })),
    );
    await expect(changeExperienceBatch(ws, batch.id, "confirm", 1)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect((await changeExperienceBatch(ws, batch.id, "confirm", 2)).version).toBeNull();
    await deliver("ios-synthetic-02");
    expect(readExperienceImports(ws).batches).toHaveLength(1);
    expect(lifeMap(ws).experiences).toHaveLength(3);
    expect((await changeExperienceBatch(ws, batch.id, "undo", 2)).affected).toBe(3);
    expect(lifeMap(ws).features).toHaveLength(0);
    expect(lifeMap(ws).experiences).toHaveLength(0);
    await deliver("ios-synthetic-03");
    expect(lifeMap(ws).experiences).toHaveLength(0);
    await expect(changeExperienceBatch(ws, batch.id, "restore", 2)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect((await changeExperienceBatch(ws, batch.id, "restore", 3)).affected).toBe(3);
    expect(lifeMap(ws).features).toHaveLength(3);
    expect(lifeMap(ws).experiences.every((row) => row.fact_status === "observed" && row.rev === 4)).toBe(
      true,
    );
    await setExperienceSource(ws, "apple-photos", true, 0);
    await deliver(
      "ios-synthetic-04",
      photos().map((row) => ({ ...row, start: "2022-01-01", end: "2022-01-05", time_precision: "day" })),
    );
    expect(lifeMap(ws).experiences).toHaveLength(3);
    expect(validateWorkspace(ws)).toEqual([]);
  } finally {
    rmSync(ws.root, { recursive: true, force: true });
  }
});

it("批量确认跳过独立编辑隐藏、未知城市和非推测项，确认后的编辑隐藏仍不被撤销恢复回滚", async () => {
  const ws = await clonedWorkspace();
  try {
    const input = [
      ...photos(),
      {
        ...(photos()[0] as ExperienceInput),
        start: "2018",
        end: undefined,
        time_precision: "year" as const,
        place: { name: "synthetic-unknown-city" },
      },
      { ...experience("已报告", "2017", "apple-photos") },
      { ...(photos()[1] as ExperienceInput), start: "2023-05-02", end: "2023-05-06" },
    ];
    const imported = await addExperiences(ws, input);
    const [edited, hidden, confirmed, unresolved, reported, laterHidden] = imported.entries;
    const id = imported.batch_id;
    if (!id || !edited || !hidden || !confirmed || !unresolved || !reported || !laterHidden)
      throw new Error("缺少经历");
    const stalePreview = previewExperienceBatch(ws, id, "confirm");
    expect(stalePreview.affected).toHaveLength(4);
    await editExperience(ws, edited.id, { ...(input[0] as ExperienceInput), title: "用户修改" }, 1);
    await hideExperience(ws, hidden.id, 1);
    expect(await changeExperienceBatch(ws, id, "confirm", stalePreview.revision)).toMatchObject({
      affected: 2,
      preserved: 4,
    });
    expect(lifeMap(ws).review.find((row) => row.id === edited.id)?.fact_status).toBe("inferred");
    expect(lifeMap(ws).review.find((row) => row.id === unresolved.id)?.fact_status).toBe("inferred");
    await editExperience(
      ws,
      confirmed.id,
      { ...(input[2] as ExperienceInput), fact_status: "observed", title: "确认后用户修改" },
      2,
    );
    await hideExperience(ws, laterHidden.id, 2);
    expect(previewExperienceBatch(ws, id, "undo").preserved.map((row) => row.id)).toEqual([
      edited.id,
      hidden.id,
      confirmed.id,
      laterHidden.id,
    ]);
    expect((await changeExperienceBatch(ws, id, "undo", 2)).affected).toBe(2);
    expect((await changeExperienceBatch(ws, id, "restore", 3)).affected).toBe(2);
    const map = lifeMap(ws);
    expect(map.experiences.find((row) => row.id === edited.id)).toMatchObject({
      title: "用户修改",
      rev: 2,
      fact_status: "inferred",
    });
    expect(map.experiences.find((row) => row.id === confirmed.id)).toMatchObject({
      title: "确认后用户修改",
      rev: 3,
    });
    expect(map.hidden.map(({ item }) => item.id).sort()).toEqual([hidden.id, laterHidden.id].sort());
    expect(map.experiences.find((row) => row.id === unresolved.id)?.fact_status).toBe("inferred");
    expect(map.experiences.find((row) => row.id === reported.id)?.fact_status).toBe("user_reported");
  } finally {
    rmSync(ws.root, { recursive: true, force: true });
  }
});

it("确认中途存储中断不显示半批路线，重启补完成员和批次指针后可整批撤销", async () => {
  const ws = await clonedWorkspace();
  try {
    const imported = await addExperiences(ws, photos());
    if (!imported.batch_id) throw new Error("缺少批次");
    const append = ws.appendLine.bind(ws);
    const fault = vi.spyOn(ws, "appendLine").mockImplementation((path, line) => {
      if (path.startsWith("explore/data/imports/")) throw new Error("模拟确认中断");
      append(path, line);
    });
    await expect(changeExperienceBatch(ws, imported.batch_id, "confirm", 1)).rejects.toThrow("模拟确认中断");
    fault.mockRestore();
    const reopened = new Workspace(ws.root);
    expect(readExperienceImports(reopened).pending).toHaveLength(1);
    expect(lifeMap(reopened).features).toHaveLength(0);
    expect(lifeMap(reopened).review).toHaveLength(3);
    expect(await recoverExperienceImports(reopened)).toHaveLength(1);
    expect(lifeMap(reopened).features).toHaveLength(3);
    expect(readRecordRevisions(reopened, "experience")).toHaveLength(6);
    expect(readExperienceImports(reopened).batches[0]?.revision).toBe(2);
    expect((await changeExperienceBatch(reopened, imported.batch_id, "undo", 2)).affected).toBe(3);
    expect(lifeMap(reopened).experiences).toHaveLength(0);
  } finally {
    vi.restoreAllMocks();
    rmSync(ws.root, { recursive: true, force: true });
  }
});

it("真实 Swift 无 title 文件的确认预览包含可核对城市、日期和经历类别", async () => {
  const ws = await clonedWorkspace();
  try {
    // iOS PR11 fca411f7 的原始 241 bytes，不给 producer 补造 title。
    const wire = readFileSync(new URL("./fixtures/ios-photos.records.jsonl", import.meta.url), "utf8");
    ws.writeText("inbox/agents/ios-1234abcd-01M5BH21V7CVZA5M7JQR9HZ8E0.records.jsonl", wire);
    expect((await processInbox(ws, { stableMs: 0 })).notes).toEqual([]);
    const [batch] = readExperienceImports(ws).batches;
    if (!batch) throw new Error("缺少照片批次");
    expect(lifeMap(ws).experiences[0]?.title).toBeUndefined();
    const preview = previewExperienceBatch(ws, batch.id, "confirm");
    expect(preview.affected).toHaveLength(1);
    expect(preview.affected[0]).toMatchObject({
      city: "Kyoto",
      country: "JP",
      start: "2025-05-02",
      end: "2025-05-02",
      event_type: "travel",
      source: "apple-photos",
      revision: 1,
    });
    expect(preview.affected[0]?.title).toBe("Kyoto");
  } finally {
    rmSync(ws.root, { recursive: true, force: true });
  }
});
