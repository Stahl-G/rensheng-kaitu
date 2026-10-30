import { rmSync, writeFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
import { suggestProjectGoal } from "../../cli/src/ui/project-ai.js";
import {
  addRecord,
  createProject,
  deferSnapshots,
  financeOverview,
  generateDirectionMap,
  lifeMap,
  projectGithub,
  readDirectionMap,
  readExploration,
  readHealthPage,
  readLearning,
  readLibrary,
  readMe,
  readOverviewPage,
  readProjectPage,
  readProjectsPage,
  readRecords,
  readWorkbench,
  refreshOverview,
  saveProjectGoal,
  setProject,
  startLearning,
  syncProject,
  updateRecord,
  writePhoneSnapshots,
} from "../src/index.js";
import { disposeNoteIndex, searchLibraryNotes } from "../src/note-search.js";
import { clonedWorkspace } from "./helpers.js";

it("a bad topic header keeps other notes searchable, reports the bad item, and recovers after external repair", async () => {
  const ws = await clonedWorkspace();
  deferSnapshots(ws, () => {});
  try {
    const good = await startLearning(ws, { title: "Healthy synthetic topic" });
    const bad = await startLearning(ws, { title: "Broken synthetic topic" });
    const file = `learning/${bad.topic}/STATUS.md`;
    const original = ws.readText(file);
    const broken = "---\ntitle: [unfinished\n---\n# Broken topic\nSyntheticbadneedle original text.\n";
    ws.writeText(file, broken);
    const notes = readLibrary(ws, { section: "notes" }).notes;
    expect(notes.find((note) => note.file === `learning/${good.topic}/STATUS.md`)?.title).toBe(good.title);
    expect(notes.find((note) => note.file === file)?.status).toContain("文件格式有误");
    expect((await searchLibraryNotes(ws, "Healthy"))[0]?.title).toBe(good.title);
    expect((await searchLibraryNotes(ws, "Syntheticbadneedle"))[0]?.snippet).toContain("Invalid document");
    expect(
      readWorkbench(ws).warnings.some((warning) =>
        (typeof warning === "string" ? warning : warning.message).includes(file),
      ),
    ).toBe(true);
    expect(() => readLearning(ws, bad.topic)).toThrow();
    await writePhoneSnapshots(ws, new Date("2026-10-29T12:00:00Z"), { force: true });
    expect(ws.readJson<{ format: string }>("phone/map.json").format).toBe("kaitu.phone.map");
    expect(ws.readText(file)).toBe(broken);
    writeFileSync(ws.resolve(file), original);
    await expect
      .poll(async () =>
        (await searchLibraryNotes(ws, "Broken synthetic")).map((row) => ({
          file: row.file,
          invalid: row.snippet.includes("Invalid document"),
        })),
      )
      .toEqual([{ file, invalid: false }]);
    expect(readLibrary(ws, { section: "notes" }).notes.find((note) => note.file === file)?.status).toBeNull();
    expect(await searchLibraryNotes(ws, "Syntheticbadneedle")).toEqual([]);
  } finally {
    disposeNoteIndex(ws);
    rmSync(ws.root, { recursive: true, force: true });
  }
});

it("a corrupt record line preserves readable rows and strict writes; phone source failures preserve originals while rebuildable snapshots recover", async () => {
  const ws = await clonedWorkspace();
  deferSnapshots(ws, () => {});
  try {
    const first = addRecord(ws, "task", { title: "First synthetic task", status: "open" }, { by: "user" });
    const second = addRecord(ws, "task", { title: "Second synthetic task", status: "open" }, { by: "user" });
    await writePhoneSnapshots(ws, new Date("2026-10-29T12:00:00Z"), { force: true });
    const beforeToday = ws.readText("phone/today.json");
    const original = ws.readText(first.file);
    const lines = original.trimEnd().split("\n");
    const broken = `${lines[0]}\n{"truncated":\n${lines.slice(1).join("\n")}\n`;
    ws.writeText(first.file, broken);
    const data = readWorkbench(ws);
    expect(data.records.task?.map((row) => row.id)).toEqual([first.record.id, second.record.id]);
    refreshOverview(ws);
    expect(ws.readText("OVERVIEW.md")).toContain(`${first.file}:2 记录格式不合法`);
    expect(ws.readText("OVERVIEW.md")).not.toContain("[object Object]");
    expect(data.warnings).toContainEqual(
      expect.objectContaining({ code: "invalid_record", location: `${first.file}:2` }),
    );
    expect(() => readRecords(ws, "task")).toThrow("记录格式不合法");
    expect(() => updateRecord(ws, "task", first.record.id, { status: "done" }, { by: "user" })).toThrow(
      "记录格式不合法",
    );
    ws.writeText("me/goals.json", '[{"id":');
    expect(
      (await readOverviewPage(ws)).warnings.some((warning) =>
        (typeof warning === "string" ? warning : warning.message).startsWith("目标"),
      ),
    ).toBe(true);
    const truncated = '{"format":"kaitu.phone.library"';
    ws.writeText("phone/library.json", truncated);
    const now = new Date("2026-10-30T12:00:00Z");
    await expect(writePhoneSnapshots(ws, now, { force: true })).rejects.toThrow("phone/today.json");
    expect(ws.readText("phone/today.json")).toBe(beforeToday);
    expect(ws.readJson<{ format: string }>("phone/library.json").format).toBe("kaitu.phone.library");
    expect(ws.readJson<{ generated_at: string }>("phone/week.json").generated_at).toBe(now.toISOString());
    expect(ws.readJson<{ generated_at: string }>("phone/map.json").generated_at).toBe(now.toISOString());
    expect(ws.readText(first.file)).toBe(broken);
    expect(ws.readText("me/goals.json")).toBe('[{"id":');
    ws.writeText(first.file, original);
    expect(readWorkbench(ws).warnings).not.toContainEqual(
      expect.objectContaining({ code: "invalid_record", location: `${first.file}:2` }),
    );
    expect(readRecords(ws, "task")).toHaveLength(2);
  } finally {
    rmSync(ws.root, { recursive: true, force: true });
  }
});

it("isolates damaged project, footprint, health and finance files without allowing partial-history writes", async () => {
  const ws = await clonedWorkspace();
  deferSnapshots(ws, () => {});
  try {
    const good = await createProject(ws, { title: "Readable project", kind: "personal" });
    const bad = await createProject(ws, { title: "Broken project", kind: "personal" });
    await setProject(ws, good.slug, { github: { repo: "synthetic/project" } });
    const github = addRecord(ws, "github_snapshot", {
      project: good.slug,
      repo: "synthetic/project",
      stars: 1,
      forks: 0,
      open_issues: 0,
      open_prs: 0,
      default_branch: "main",
      archived: false,
      pushed_at: null,
      latest_release: null,
      commits: [],
      ci: { state: "none", run_at: null, url: null },
    });
    const file = `projects/${bad.slug}/STATUS.md`;
    const original = ws.readText(file);
    const broken = "---\ntitle: [broken\n---\nOriginal project body\n";
    ws.writeText(file, broken);
    const metric = addRecord(ws, "project_metric", { project: good.slug, kind: "words", value: 12 });
    const workout = addRecord(ws, "workout", {
      exercise: "Squat",
      session_id: "synthetic-session",
      sets: 3,
      reps: 10,
      weight_kg: 40,
    });
    const account = addRecord(ws, "finance_account", {
      name: "Synthetic wallet",
      kind: "wallet",
      currency: "CNY",
      source: "manual",
    });
    const experience = addRecord(ws, "experience", {
      place: { name: "Berlin", country: "DE", precision: "city" },
      event_type: "worked",
      fact_status: "user_reported",
      start: "2020",
      time_precision: "year",
      source: "synthetic/places.md",
    });
    const meal = addRecord(ws, "meal", {
      meal: "午",
      items: [{ name: "Synthetic rice" }],
      kcal: 200,
      protein_g: 5,
      source: "manual",
    });
    const files = [metric.file, workout.file, account.file, experience.file, meal.file, github.file];
    const before = new Map(files.map((file) => [file, ws.readText(file)]));
    for (const file of files) ws.appendLine(file, '{"broken":');
    const projects = readProjectsPage(ws, { partial: true });
    expect(projects.find((row) => row.slug === bad.slug)?.error).toBe(file);
    expect(projects.find((row) => row.slug === good.slug)?.title).toBe("Readable project");
    const detail = readProjectPage(ws, good.slug, { partial: true });
    expect(detail.metrics[0]?.value).toBe(12);
    expect(
      detail.warnings.some((warning) =>
        (typeof warning === "string" ? warning : warning.message).includes(metric.file),
      ),
    ).toBe(true);
    expect(detail.github?.latest?.stars).toBe(1);
    expect(
      detail.warnings.some((warning) =>
        (typeof warning === "string" ? warning : warning.message).includes(github.file),
      ),
    ).toBe(true);
    expect(readWorkbench(ws).projects.map((project) => project.slug)).toContain(good.slug);
    expect(() => projectGithub(ws, good.slug)).toThrow("记录格式不合法");
    expect(readProjectPage(ws, bad.slug, { partial: true }).body).toBe(broken);
    const directions = readExploration(ws, { partial: true });
    expect(directions.references.projects.map((project) => project.id)).toContain(good.slug);
    expect(directions.references.projects.map((project) => project.id)).not.toContain(bad.slug);
    expect(
      directions.warnings?.some((warning) =>
        (typeof warning === "string" ? warning : warning.message).includes(metric.file),
      ),
    ).toBe(true);
    expect(readDirectionMap(ws).input?.projects.map((project) => project.slug)).toContain(good.slug);
    const ask = vi.fn();
    expect(() => generateDirectionMap(ws, ask)).toThrow("记录格式不合法");
    expect(ask).not.toHaveBeenCalled();
    await expect(suggestProjectGoal(ws, good.slug)).rejects.toMatchObject({ code: "CORRUPT" });
    const health = readHealthPage(ws);
    expect(health.training.recent[0]?.exercises[0]?.name).toBe("Squat");
    expect(health.nutrition.meals.map((row) => row.items)).toEqual(["Synthetic rice"]);
    expect(
      health.warnings?.some((warning) =>
        (typeof warning === "string" ? warning : warning.message).includes(workout.file),
      ),
    ).toBe(true);
    const finance = financeOverview(ws);
    expect(finance.records.some((row) => row.id === account.record.id)).toBe(true);
    expect(
      finance.warnings?.some((warning) =>
        (typeof warning === "string" ? warning : warning.message).includes(account.file),
      ),
    ).toBe(true);
    const map = lifeMap(ws);
    expect(map.experiences.map((row) => row.id)).toContain(experience.record.id);
    expect(
      map.warnings?.some((warning) =>
        (typeof warning === "string" ? warning : warning.message).includes(experience.file),
      ),
    ).toBe(true);
    const me = readMe(ws);
    expect(me.career.map((row) => row.id)).toContain(experience.record.id);
    expect(
      me.warnings?.some((warning) =>
        (typeof warning === "string" ? warning : warning.message).includes(experience.file),
      ),
    ).toBe(true);
    expect(
      (await readOverviewPage(ws)).warnings.some((warning) =>
        (typeof warning === "string" ? warning : warning.message).includes(experience.file),
      ),
    ).toBe(true);
    const library = readLibrary(ws);
    expect(library.sections.find((section) => section.id === "health")?.count).toBeGreaterThan(0);
    expect(
      library.warnings?.some((warning) =>
        (typeof warning === "string" ? warning : warning.message).includes(account.file),
      ),
    ).toBe(true);
    await expect(
      saveProjectGoal(ws, good.slug, { label: "Words", current: 0, target: 100, unit: "字" }),
    ).rejects.toThrow();
    expect(() => updateRecord(ws, "experience", experience.record.id, { start: "2021" })).toThrow();
    expect(ws.readText(file)).toBe(broken);
    for (const file of files) {
      expect(ws.readText(file).startsWith(`${before.get(file)}{"broken":\n`)).toBe(true);
      writeFileSync(ws.resolve(file), before.get(file) as string);
    }
    writeFileSync(ws.resolve(file), original);
    expect(readProjectsPage(ws).find((row) => row.slug === bad.slug)?.error).toBeUndefined();
    expect(lifeMap(ws).warnings).toEqual([]);
    expect(financeOverview(ws).warnings).toBeUndefined();
    ws.appendLine(
      meal.file,
      JSON.stringify({ ...meal.record, id: "01K00000000000000000000000", items: null }),
    );
    ws.appendLine(
      experience.file,
      JSON.stringify({ ...experience.record, id: "01K00000000000000000000001", place: null }),
    );
    ws.appendLine(
      account.file,
      JSON.stringify({
        ...account.record,
        id: "01K00000000000000000000002",
        balance: "invalid",
        balance_at: account.record.ts,
      }),
    );
    ws.appendLine(
      experience.file,
      JSON.stringify({ ...experience.record, id: "01K00000000000000000000003", start: 2021 }),
    );
    expect(lifeMap(ws).experiences.map((row) => row.id)).toContain(experience.record.id);
    expect(
      lifeMap(ws).warnings?.some((warning) =>
        (typeof warning === "string" ? warning : warning.message).includes("地点或日期无法显示"),
      ),
    ).toBe(true);
    expect(financeOverview(ws).records.map((row) => row.id)).toContain(account.record.id);
    expect(
      financeOverview(ws).warnings?.some((warning) =>
        (typeof warning === "string" ? warning : warning.message).includes("无法用于计算"),
      ),
    ).toBe(true);
    ws.writeText(experience.file, before.get(experience.file) as string);
    ws.writeText(account.file, before.get(account.file) as string);
    const invalidMeal = readHealthPage(ws);
    expect(invalidMeal.nutrition.meals.map((row) => row.items)).toEqual(["Synthetic rice"]);
    expect(invalidMeal.warnings).toHaveLength(1);
    ws.writeText(meal.file, before.get(meal.file) as string);
    await writePhoneSnapshots(ws, new Date("2026-10-30T12:00:00Z"), { force: true });
    const phoneMap = ws.readText("phone/map.json");
    ws.appendLine(github.file, '{"broken":');
    await expect(writePhoneSnapshots(ws, new Date("2026-10-31T12:00:00Z"), { force: true })).rejects.toThrow(
      "phone/map.json",
    );
    expect(ws.readText("phone/map.json")).toBe(phoneMap);
    ws.writeText(github.file, before.get(github.file) as string);
    addRecord(ws, "project_metric", { project: good.slug, kind: "commits", value: 10 });
    addRecord(ws, "project_metric", { project: good.slug, kind: "commits", value: 20 });
    const invalidMetric = ws.readText(metric.file).replace('"value":20', '"value":"20"');
    ws.writeText(metric.file, invalidMetric);
    expect(readRecords(ws, "project_metric").some((row) => row.value === "20")).toBe(true);
    const partialMetrics = readProjectPage(ws, good.slug, { partial: true });
    expect(partialMetrics.metrics.filter((row) => row.kind === "commits")).toHaveLength(1);
    expect(
      partialMetrics.warnings.some((warning) =>
        (typeof warning === "string" ? warning : warning.message).includes("无法用于计算"),
      ),
    ).toBe(true);
    const statusBefore = ws.readText(`projects/${good.slug}/STATUS.md`);
    await expect(syncProject(ws, good.slug)).rejects.toThrow("无法用于计算");
    await expect(
      saveProjectGoal(ws, good.slug, { label: "Commits", current: 0, target: 100, unit: "次提交" }),
    ).rejects.toThrow();
    expect(ws.readText(`projects/${good.slug}/STATUS.md`)).toBe(statusBefore);
    expect(ws.readText(metric.file)).toBe(invalidMetric);
    ws.writeText(metric.file, before.get(metric.file) as string);
    const read = ws.readText.bind(ws);
    const denied = Object.assign(new Error("synthetic permission denied"), { code: "EACCES" });
    const blocked = new Set([metric.file, workout.file, account.file, experience.file]);
    const spy = vi.spyOn(ws, "readText").mockImplementation((file) => {
      if (blocked.has(file)) throw denied;
      return read(file);
    });
    for (const load of [
      () => readProjectPage(ws, good.slug),
      () => readHealthPage(ws),
      () => financeOverview(ws),
      () => lifeMap(ws),
    ])
      expect(load).toThrow("synthetic permission denied");
    spy.mockRestore();
  } finally {
    rmSync(ws.root, { recursive: true, force: true });
  }
});

it("rebuilds corrupt derived phone JSON but propagates access failures and preserves the blocked file", async () => {
  const ws = await clonedWorkspace();
  deferSnapshots(ws, () => {});
  try {
    await writePhoneSnapshots(ws, new Date("2026-10-29T12:00:00Z"), { force: true });
    ws.writeText("phone/today.json", '{"truncated":');
    ws.writeText("phone/library.json", '{"navigation":{"files":null}}');
    await writePhoneSnapshots(ws, new Date("2026-10-30T12:00:00Z"), { force: true });
    expect(ws.readJson<{ format: string }>("phone/today.json").format).toBe("kaitu.phone.today");
    expect(ws.readJson<{ items: unknown[] }>("phone/library.json").items).toBeInstanceOf(Array);
    const old = ws.readText("phone/library.json");
    const read = ws.readJson.bind(ws);
    const denied = Object.assign(new Error("synthetic permission denied"), { code: "EACCES" });
    const spy = vi.spyOn(ws, "readJson").mockImplementation((file) => {
      if (file === "phone/library.json") throw denied;
      return read(file);
    });
    await expect(writePhoneSnapshots(ws, new Date("2026-10-31T12:00:00Z"), { force: true })).rejects.toThrow(
      "synthetic permission denied",
    );
    expect(ws.readText("phone/library.json")).toBe(old);
    spy.mockRestore();
  } finally {
    vi.restoreAllMocks();
    rmSync(ws.root, { recursive: true, force: true });
  }
});
