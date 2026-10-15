import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Context } from "@deepseek-ai/cordis";
import { addRecord, createProject, initWorkspace, snapshot, stringifyFrontmatter } from "@kaitu/core";
import { expect, it, vi } from "vitest";
import { KaituOverviewService } from "../src/overview-service.js";

it("总览 Remote 按天区分缺失与零值，汇总训练、睡眠、营养和项目产出", async () => {
  const root = mkdtempSync(join(tmpdir(), "kaitu-overview-"));
  const ctx = new Context();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-16T08:00:00Z"));
  try {
    const ws = await initWorkspace(root);
    const service = new KaituOverviewService(ctx, { workspace: root });
    const empty = await service.overview();
    expect(empty.metrics.map((m) => m.value)).toEqual([null, null, null, null]);
    expect(empty.empty).toBe(true);
    for (const key of ["workouts", "sleep", "protein"]) {
      expect(empty.metrics.find((m) => m.key === key)?.daily).toEqual(
        Array.from({ length: 7 }, (_, i) => ({ date: `2026-10-${10 + i}`, value: null })),
      );
    }
    ws.writeText(
      "NOW.md",
      stringifyFrontmatter(
        {
          date: empty.today,
          blocks: [
            { id: "p1", title: "训练", start: "18:00", end: "18:40", kind: "proposal", status: "pending" },
          ],
        },
        "",
      ),
    );
    ws.writeText(
      `handoffs/daily/${empty.today}.md`,
      stringifyFrontmatter(
        { organizer: "test", date: empty.today },
        "## 未决事项\n- [ ] 等待确认\n- [x] 已完成\n- 无\n## 当前下一步\n- 另一条\n",
      ),
    );
    await snapshot(ws, "DeepSeek 对话写入：meal");
    // Choose a past timestamp so this test does not depend on the time of day.
    const recordTime = new Date(Date.now() - 1000).toISOString();
    addRecord(ws, "meal", {
      ts: recordTime,
      meal: "加餐",
      items: [{ name: "水" }],
      kcal: 0,
      protein_g: 0,
      source: "manual",
    });
    addRecord(ws, "meal", {
      ts: "2026-10-14T03:00:00Z",
      meal: "午",
      items: [{ name: "合成食物" }],
      kcal: 100,
      protein_g: 10,
      source: "estimate",
    });
    addRecord(ws, "meal", {
      ts: "2026-10-14T04:00:00Z",
      meal: "加餐",
      items: [{ name: "合成食物" }],
      kcal: 100,
      protein_g: 20,
      source: "manual",
    });
    addRecord(ws, "sleep", {
      ts: "2026-10-14T22:00:00Z",
      start: "2026-10-14T15:00:00Z",
      end: "2026-10-14T22:00:00Z",
      duration_min: 420,
      source: "manual",
    });
    for (const exercise of ["深蹲", "卧推"]) {
      addRecord(ws, "workout", {
        ts: recordTime,
        exercise,
        sets: 3,
        reps: 12,
        weight_kg: 40,
        session_id: "session-1",
      });
    }
    const { slug } = await createProject(ws, { title: "合成项目", kind: "personal" });
    for (const [ts, kind, value] of [
      ["2026-10-09T03:00:00Z", "words", 1000],
      ["2026-10-14T03:00:00Z", "words", 1300],
      ["2026-10-16T03:00:00Z", "words", 1300],
      ["2026-10-14T03:00:00Z", "commits", 2],
      ["2026-10-16T03:00:00Z", "commits", 0],
    ] as const)
      addRecord(ws, "project_metric", { ts, project: slug, kind, value });
    const data = await service.overview();
    expect(data.empty).toBe(false);
    const protein = data.metrics.find((m) => m.key === "protein");
    expect(protein?.value).toBe(15);
    expect(protein?.daily.map((d) => d.value)).toEqual([null, null, null, null, 30, null, 0]);
    expect(protein?.estimated).toBe(true);
    expect(data.metrics.find((m) => m.key === "sleep")?.daily.map((d) => d.value)).toEqual([
      null,
      null,
      null,
      null,
      null,
      7,
      null,
    ]);
    expect(data.metrics.find((m) => m.key === "workouts")?.daily.map((d) => d.value)).toEqual([
      null,
      null,
      null,
      null,
      null,
      null,
      1,
    ]);
    expect(data.projects[0]?.daily.map((d) => [d.words, d.commits])).toEqual([
      [null, null],
      [null, null],
      [null, null],
      [null, null],
      [300, 2],
      [null, null],
      [0, 0],
    ]);
    expect(data.metrics.find((m) => m.key === "protein")?.sources.length).toBeGreaterThan(0);
    expect(data.blocks[0]?.start).toBe("18:00");
    expect(data.pending).toBe(1);
    expect(data.daily?.unresolved).toBe(1);
    expect(data.versions.some((v) => v.source === "agent")).toBe(true);
  } finally {
    vi.useRealTimers();
    await ctx.fiber.dispose();
    rmSync(root, { recursive: true, force: true });
  }
});
