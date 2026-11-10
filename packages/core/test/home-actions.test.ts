import { rmSync } from "node:fs";
import { expect, test } from "vitest";
import { parseFrontmatter, stringifyFrontmatter } from "../src/frontmatter.js";
import { completeHomeNext, homeResults, undoHomeNext } from "../src/home-actions.js";
import { readRecords, updateRecord } from "../src/records.js";
import { addTask } from "../src/tasks.js";
import type { ModuleStatus } from "../src/workbench.js";
import { freshWorkspace } from "./helpers.js";

test("completion records a real result once and undo touches only the unchanged task", async () => {
  const ws = await freshWorkspace();
  try {
    const task = (await addTask(ws, { title: "Write a real result" })).record;
    const target = {
      id: task.id,
      file: "task",
      title: String(task.title),
      due: null,
      precondition: { kind: "task" as const, expectedRev: 1 },
    };
    const at = new Date("2026-11-10T03:00:00Z");
    const op = "11111111-1111-4111-8111-111111111111";
    expect(() => completeHomeNext(ws, target, "", op, at)).toThrow("一句话");
    const receipt = completeHomeNext(ws, target, "Published the first draft", op, at);
    expect(completeHomeNext(ws, target, "Published the first draft", op, at)).toEqual(receipt);
    expect(readRecords(ws, "task").find((item) => item.id === task.id)?.rev).toBe(2);
    expect(
      homeResults(readRecords(ws, "task"), [], ws.timeZone(), "2026-11-10", at.toISOString()),
    ).toMatchObject([{ text: "Published the first draft", date: "2026-11-10" }]);
    expect(() =>
      completeHomeNext(ws, target, "Stale result", "22222222-2222-4222-8222-222222222222", at),
    ).toThrow("已变化");
    const other = (await addTask(ws, { title: "Unrelated task" })).record;
    undoHomeNext(ws, receipt.token);
    undoHomeNext(ws, receipt.token);
    expect(readRecords(ws, "task").find((item) => item.id === task.id)).toMatchObject({
      status: "open",
      rev: 3,
    });
    expect(readRecords(ws, "task").find((item) => item.id === other.id)).toEqual(other);
    expect(homeResults(readRecords(ws, "task"), [], ws.timeZone(), "2026-11-10", at.toISOString())).toEqual(
      [],
    );
    const next = { ...target, precondition: { kind: "task" as const, expectedRev: 3 } };
    const latest = completeHomeNext(ws, next, "New result", "33333333-3333-4333-8333-333333333333", at);
    updateRecord(ws, "task", task.id, { title: "Changed elsewhere" }, { by: "agent" });
    expect(() => undoHomeNext(ws, latest.token)).toThrow("已变化");
    expect(readRecords(ws, "task").find((item) => item.id === task.id)?.title).toBe("Changed elsewhere");
  } finally {
    rmSync(ws.root, { recursive: true, force: true });
  }
});

test("STATUS completion and scoped undo retain original text and unrelated later edits", async () => {
  const ws = await freshWorkspace();
  try {
    const file = "health/STATUS.md";
    const item = { id: "step", title: "Go for a walk", status: "todo" as const };
    ws.writeText(
      file,
      stringifyFrontmatter({ updated: null, next: [item] }, "# Original plan\nKeep this text.\n"),
    );
    const target = {
      id: item.id,
      file,
      title: item.title,
      due: null,
      precondition: { kind: "status" as const, expectedNext: item },
    };
    const receipt = completeHomeNext(
      ws,
      target,
      "Walked for 20 minutes",
      "44444444-4444-4444-8444-444444444444",
      new Date("2026-11-10T03:00:00Z"),
    );
    const doc = parseFrontmatter<ModuleStatus>(ws.readText(file));
    expect(doc.data.next?.[0]?.status).toBe("done");
    expect(doc.body).toContain("Keep this text.");
    expect(homeResults([], [{ file, ...doc }], ws.timeZone(), "2026-11-10")).toMatchObject([
      { text: "Walked for 20 minutes" },
    ]);
    ws.writeText(file, stringifyFrontmatter(doc.data, `${doc.body}\nAn unrelated later observation.\n`));
    undoHomeNext(ws, receipt.token);
    const restored = parseFrontmatter<ModuleStatus>(ws.readText(file));
    expect(restored.data.next).toEqual([item]);
    expect(restored.body).toContain("An unrelated later observation.");
    expect(restored.body).not.toContain("Walked for 20 minutes");
    expect(() =>
      completeHomeNext(
        ws,
        { ...target, file: "../outside.md" },
        "No",
        "55555555-5555-4555-8555-555555555555",
      ),
    ).toThrow("已变化");
  } finally {
    rmSync(ws.root, { recursive: true, force: true });
  }
});

test("seven-day activity uses actual user result timestamps and workspace dates", () => {
  const row = {
    id: "real",
    ts: "2020-01-01T00:00:00Z",
    by: "user",
    status: "done",
    title: "Old task completed now",
    notes: "完成结果：A real observation\n完成时间：2026-11-09T18:00:00Z\n",
  };
  const rows = [
    row,
    { ...row, id: "agent", by: "agent" },
    { ...row, id: "missing-time", notes: "完成结果：No completion time" },
    { ...row, id: "empty", notes: "完成时间：2026-11-09T18:00:00Z" },
    { ...row, id: "future", notes: "完成结果：Future\n完成时间：2026-11-10T06:00:00Z" },
    { ...row, id: "old", notes: "完成结果：Too old\n完成时间：2026-11-02T03:00:00Z" },
  ];
  expect(homeResults(rows, [], "Asia/Shanghai", "2026-11-10", "2026-11-10T03:00:00Z")).toMatchObject([
    { id: "real", date: "2026-11-10" },
  ]);
});
