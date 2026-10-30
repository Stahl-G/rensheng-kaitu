import { rmSync } from "node:fs";
import { expect, it, vi } from "vitest";
import {
  addGoalNext,
  addTask,
  createProject,
  deferSnapshots,
  logProject,
  readHome,
  readHomeSources,
  readOverviewPage,
  readProjectsPage,
  readWorkbench,
  saveLearningCheckin,
  setProject,
  startLearning,
} from "../src/index.js";
import { freshWorkspace } from "./helpers.js";

it("projects existing goals, projects and learning without reading or mutating the workspace", async () => {
  const ws = await freshWorkspace();
  try {
    deferSnapshots(ws, () => {});
    ws.writeJson("me/goals.json", [
      { id: "goal-a", title: "合成目标", status: "active" },
      { id: "goal-b", title: "暂停目标", status: "paused" },
    ]);
    await addGoalNext(ws, "goal-a", "目标下一步");
    const project = await createProject(ws, { slug: "fixture", title: "合成项目", kind: "personal" });
    await setProject(ws, project.slug, {
      next: [{ id: "project-step", title: "项目下一步", status: "todo", due: "2026-10-30" }],
    });
    await logProject(ws, project.slug, "合成进展", { by: "agent", date: "2026-10-27" });
    await logProject(ws, project.slug, "未来记录", { by: "user", date: "2026-11-02" });
    const paused = await createProject(ws, { slug: "paused", title: "暂停项目", kind: "personal" });
    await setProject(ws, paused.slug, { stage: "paused" });
    const linked = await createProject(ws, { slug: "linked", title: "待办项目", kind: "personal" });
    const task = await addTask(ws, { title: "项目待办", project: linked.slug });
    const topic = await startLearning(ws, { topic: "fixture", title: "合成学习" });
    await saveLearningCheckin(ws, {
      topic: topic.topic,
      operationId: "home-test-0001",
      understanding: "合成观察",
      questions: "",
      next: "学习下一步",
    });
    const now = new Date("2026-10-28T12:00:00Z");
    ws.writeText("projects/broken/STATUS.md", "---\ntitle: [\n---\n");
    const loaded = await readHomeSources(ws, now);
    expect(loaded.overview.warnings).toContainEqual(
      expect.objectContaining({ code: "invalid_document", location: "projects/broken/STATUS.md" }),
    );
    expect(loaded.projects.some((item) => item.slug === "fixture")).toBe(true);
    const workbench = readWorkbench(ws, now);
    const input = loaded;
    expect(loaded.projects).toEqual(readProjectsPage(ws, { now, loaded: workbench, partial: true }));
    const before = JSON.stringify(input);
    const read = vi.spyOn(ws, "readText");
    const home = readHome(input);
    expect(read).not.toHaveBeenCalled();
    expect(JSON.stringify(input)).toBe(before);
    expect(home.threads[0]?.key).toBe("project:fixture");
    expect(home.threads.map((thread) => thread.key)).toEqual(
      expect.arrayContaining(["project:fixture", "project:linked", "learning:fixture", "goal:goal-a"]),
    );
    expect(home.threads).toHaveLength(4);
    expect(home.threads[0]).toMatchObject({
      last: { date: "2026-10-27", text: "合成进展", by: "unknown" },
      next: {
        id: "project-step",
        file: "projects/fixture/STATUS.md",
        due: "2026-10-30",
        precondition: {
          kind: "status",
          expectedNext: { id: "project-step", title: "项目下一步", status: "todo", due: "2026-10-30" },
        },
      },
    });
    const collision = readHome({
      ...input,
      records: {
        ...input.records,
        task: [
          ...(input.records.task ?? []),
          {
            id: "project-step",
            title: "项目下一步",
            project: "fixture",
            status: "open",
            ts: "2026-10-27T12:00:00Z",
            by: "user",
            rev: 2,
          },
        ],
      },
    });
    expect(collision.threads.find((thread) => thread.key === "project:fixture")?.next).toMatchObject({
      file: null,
      precondition: null,
    });
    const withSync = readHome({
      ...input,
      projects: input.projects.map((item) =>
        item.slug === "fixture"
          ? {
              ...item,
              metricFiles: ["projects/data/project_metric/2026-10.jsonl"],
              recent7: { ...item.recent7, daily: [{ date: "2026-10-27", words: null, commits: 3 }] },
            }
          : item,
      ),
    });
    expect(withSync.traces).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "project-metric",
          value: 3,
          unit: "commits",
          sourceFiles: ["projects/data/project_metric/2026-10.jsonl"],
        }),
      ]),
    );
    const withRevision = readHome({
      ...input,
      records: {
        ...input.records,
        task: (input.records.task ?? []).map((record) => ({ ...record, rev: 3 })),
      },
    });
    expect(
      withRevision.threads.find((thread) => thread.key === "project:linked")?.next?.precondition,
    ).toEqual({ kind: "task", expectedRev: 3 });
    const withoutRevision = readHome({
      ...input,
      records: { ...input.records, task: (input.records.task ?? []).map(({ rev, ...record }) => record) },
    });
    expect(withoutRevision.threads.find((thread) => thread.key === "project:linked")?.next).toMatchObject({
      file: "task",
      precondition: null,
    });
    const multipleDays = readHome({
      ...input,
      projects: input.projects.map((item) => ({
        ...item,
        metricFiles: ["projects/data/project_metric/2026-10.jsonl"],
        recent7: {
          ...item.recent7,
          daily: [
            { date: "2026-10-27", words: 100, commits: 2 },
            { date: "2026-10-28", words: 0, commits: 0 },
          ],
        },
      })),
    });
    expect(
      multipleDays.traces.filter(
        (trace) => trace.kind === "project-metric" && trace.key.startsWith("project:fixture:"),
      ),
    ).toHaveLength(1);
    expect(multipleDays.traces.some((trace) => trace.kind === "project-metric" && trace.value === 0)).toBe(
      false,
    );
    expect(home.threads.find((thread) => thread.key === "project:linked")?.next).toMatchObject({
      id: task.record.id,
      file: "task",
      precondition: null,
    });
    expect(home.threads.find((thread) => thread.kind === "goal")).toMatchObject({
      file: "me/goals.json",
      next: { title: "目标下一步", file: "task", precondition: { kind: "task", expectedRev: 1 } },
      last: null,
    });
    expect(home.threads.find((thread) => thread.kind === "learning")?.next).toMatchObject({
      title: "学习下一步",
      file: "learning/fixture/STATUS.md",
    });
    expect(home.lastAuthored).toBeNull();
    expect(home.atlas).toBeNull();
  } finally {
    rmSync(ws.root, { recursive: true, force: true });
  }
});

it("keeps empty and old workspaces honest, including missing sources and future observations", async () => {
  const ws = await freshWorkspace();
  try {
    const now = new Date("2026-10-28T12:00:00Z");
    const overview = await readOverviewPage(ws, now);
    const workbench = readWorkbench(ws, now);
    const empty = readHome({
      overview,
      projects: readProjectsPage(ws, { now }),
      statuses: workbench.statuses,
      records: workbench.records,
    });
    expect(empty.threads).toEqual([]);
    expect(empty.traces).toEqual([]);
    expect(empty.lastAuthored).toBeNull();
    const metric = {
      key: "fixture",
      label: "合成",
      unit: "次",
      value: 1,
      days: 1,
      estimated: false,
      from: "2026-10-27",
      to: "2026-10-27",
      cutoff: now.toISOString(),
      latest: "2026-10-27T12:00:00Z",
      sources: [],
      daily: [],
      target: null,
    };
    const altered = {
      ...overview,
      metrics: [
        {
          ...metric,
          key: "old",
          latest: "2026-10-01T12:00:00Z",
          value: 1,
          sources: [{ file: "health/data/old", text: "{}" }],
        },
        { ...metric, key: "missing", latest: "2026-10-27T12:00:00Z", value: 1, sources: [] },
        {
          ...metric,
          key: "future",
          latest: "2026-11-01T12:00:00Z",
          value: 1,
          sources: [{ file: "health/data/future", text: "{}" }],
        },
        {
          ...metric,
          key: "recent",
          latest: "2026-10-27T12:00:00Z",
          value: 1,
          sources: [{ file: "health/data/recent", text: "{}" }],
        },
      ],
    };
    const home = readHome({ overview: altered, projects: [], statuses: [], records: {} });
    expect(home.traces.map((trace) => trace.key)).toEqual(["metric:recent"]);
    expect(home.traces[0]?.sourceFiles).toEqual(["health/data/recent"]);
  } finally {
    rmSync(ws.root, { recursive: true, force: true });
  }
});
