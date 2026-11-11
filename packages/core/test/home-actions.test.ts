import { rmSync } from "node:fs";
import { expect, test } from "vitest";
import {
  addGoalNext,
  addRecord,
  applyResultAction,
  collectResults,
  isTracked,
  parseFrontmatter,
  readHome,
  readHomeSources,
  resultDraft,
  snapshot,
  stringifyFrontmatter,
  ulid,
  updateRecord,
} from "../src/index.js";
import { clonedWorkspace } from "./helpers.js";

test("Mac home and goals read the shared results while local activity counts days, not rows", async () => {
  const ws = await clonedWorkspace("Asia/Shanghai");
  try {
    resultDraft(ws, ws.root, { drafts: { synthetic: "Unfinished result text" } }, { drafts: {} });
    await snapshot(ws, "Synthetic draft isolation");
    expect(await isTracked(ws, ".kaitu/result-draft.json")).toBe(false);
    ws.writeJson("me/goals.json", [{ id: "goal", title: "Synthetic goal", status: "active" }]);
    await addGoalNext(ws, "goal", "First task");
    let input = await readHomeSources(ws, new Date("2026-11-11T02:00:00Z"));
    const next = input.overview.plans.goals[0]?.next;
    if (!next) throw new Error("Missing goal task");
    await applyResultAction(
      ws,
      {
        client_id: ulid(),
        op: "complete_next_result",
        args: { file: "task", id: next.id, expected_rev: next.rev, result_text: "Task result" },
      },
      new Date("2026-11-10T15:50:00Z"),
    );
    const entry = { id: "step", title: "Project step", status: "todo" };
    ws.writeText("me/STATUS.md", stringifyFrontmatter({ next: [entry] }, "# Original body\n"));
    await applyResultAction(
      ws,
      {
        client_id: ulid(),
        op: "complete_next_result",
        args: { file: "me/STATUS.md", id: entry.id, expected_next: entry, result_text: "Project result" },
      },
      new Date("2026-11-10T15:59:00Z"),
    );
    input = await readHomeSources(ws, new Date("2026-11-11T02:00:00Z"));
    expect(readHome(input).results).toHaveLength(2);
    expect(readHome(input).resultActivityDays).toBe(1);
    expect(input.overview.plans.goals[0]).toMatchObject({ results: 1, lastResult: "Task result" });
    const second = addRecord(ws, "task", { title: "After midnight", status: "open" }, { by: "user" }).record;
    await applyResultAction(
      ws,
      {
        client_id: ulid(),
        op: "complete_next_result",
        args: { file: "task", id: second.id, expected_rev: 1, result_text: "Second day" },
      },
      new Date("2026-11-10T16:01:00Z"),
    );
    input = await readHomeSources(ws, new Date("2026-11-11T02:00:00Z"));
    expect(readHome(input).results?.map((row) => row.text)).toEqual(
      collectResults(ws).map((row) => row.text),
    );
    expect(readHome(input).resultActivityDays).toBe(2);
    expect(parseFrontmatter(ws.readText("me/STATUS.md")).body).toBe("# Original body\n");
    updateRecord(
      ws,
      "task",
      second.id,
      { notes: "完成结果：Legacy without completion time" },
      { by: "user" },
    );
    expect(readHome(await readHomeSources(ws, new Date("2026-11-11T02:00:00Z"))).resultActivityDays).toBe(1);
  } finally {
    rmSync(ws.root, { recursive: true, force: true });
  }
});
