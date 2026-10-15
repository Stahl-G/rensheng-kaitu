import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Context } from "@deepseek-ai/cordis";
import { addRecord, initWorkspace, snapshot, stringifyFrontmatter } from "@kaitu/core";
import { expect, it } from "vitest";
import { KaituOverviewService } from "../src/overview-service.js";

it("总览 Remote 区分无记录与真实零值，并返回计划、来源和每日未决", async () => {
  const root = mkdtempSync(join(tmpdir(), "kaitu-overview-"));
  const ctx = new Context();
  try {
    const ws = await initWorkspace(root);
    const service = new KaituOverviewService(ctx, { workspace: root });
    const empty = await service.overview();
    expect(empty.metrics.map((m) => m.value)).toEqual([null, null, null, null]);
    expect(empty.empty).toBe(true);
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
    const data = await service.overview();
    expect(data.empty).toBe(false);
    expect(data.metrics.find((m) => m.key === "protein")?.value).toBe(0);
    expect(data.metrics.find((m) => m.key === "workouts")?.value).toBeNull();
    expect(data.metrics.find((m) => m.key === "protein")?.sources.length).toBeGreaterThan(0);
    expect(data.blocks[0]?.start).toBe("18:00");
    expect(data.pending).toBe(1);
    expect(data.daily?.unresolved).toBe(1);
    expect(data.versions[0]?.source).toBe("agent");
  } finally {
    await ctx.fiber.dispose();
    rmSync(root, { recursive: true, force: true });
  }
});
