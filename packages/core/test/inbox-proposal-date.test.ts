import { rmSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
import { parseFrontmatter, stringifyFrontmatter } from "../src/frontmatter.js";
import * as historyModule from "../src/history.js";
import { processInbox } from "../src/inbox.js";
import { clonedWorkspace } from "./helpers.js";
const roots: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

it("keeps non-today, invalid and conflicting proposal dates as original notes without changing the plan", async () => {
  const ws = await clonedWorkspace("Asia/Shanghai");
  roots.push(ws.root);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-14T06:00:00Z"));
  const before = ws.readText("NOW.md");
  const inputs = [
    { date: "2026-11-13", title: "Synthetic old proposal" },
    { date: "2026-11-15", title: "Synthetic future proposal" },
    { date: "2026-02-30", title: "Synthetic invalid date" },
    { date: null, title: "Synthetic unknown date" },
    { date: ["2026-11-14", "2026-11-13"], title: "Synthetic array date" },
    { date: { value: "2026-11-14" }, title: "Synthetic object date" },
    { date: 20261114, title: "Synthetic number date" },
    { date: "2026-11-14T06:00:00Z", title: "Synthetic instant is not a plan date" },
    { title: "Synthetic 2026-11-13: today at 11:00" },
    { date: "2026-11-14", title: "Synthetic conflicting 2026-11-13" },
    { title: "Synthetic invalid 2026-02-30" },
  ];
  for (const [i, input] of inputs.entries()) {
    const original = JSON.stringify({ ...input, start: "11:00", end: "12:00", agent: "synthetic" });
    ws.writeText(`inbox/agents/date-${i}.proposal.json`, original);
    const result = await processInbox(ws, { stableMs: 0 });
    expect(result.processed).toEqual([]);
    expect(result.notes).toHaveLength(1);
    expect(ws.readText(result.notes[0] as string)).toContain(original);
    expect(ws.readText("NOW.md")).toBe(before);
  }
});

it.each([
  ["America/Los_Angeles", "2026-11-13"],
  ["Asia/Shanghai", "2026-11-14"],
])("uses workspace local date in %s while preserving undated legacy proposals", async (zone, date) => {
  const ws = await clonedWorkspace(zone);
  roots.push(ws.root);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-14T06:00:00Z"));
  for (const [i, input] of [
    { date, title: "Synthetic dated proposal" },
    { title: "Synthetic undated proposal" },
    { title: `Synthetic ${date} proposal` },
  ].entries()) {
    const file = `inbox/agents/current-${i}.proposal.json`;
    ws.writeText(file, JSON.stringify({ ...input, start: "11:00", end: "12:00" }));
    expect(await processInbox(ws, { stableMs: 0 })).toMatchObject({ processed: [file], notes: [] });
  }
  const plan = parseFrontmatter<{ date: string; blocks: { title: string; status: string }[] }>(
    ws.readText("NOW.md"),
  ).data;
  expect(plan.date).toBe(date);
  expect(plan.blocks).toHaveLength(3);
  expect(plan.blocks.every((block) => block.status === "pending")).toBe(true);
});

it.each([true, false])("rechecks the execution day after midnight (dated=%s)", async (dated) => {
  const ws = await clonedWorkspace("Asia/Shanghai");
  roots.push(ws.root);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-13T15:59:59Z"));
  const tomorrow = stringifyFrontmatter(
    {
      date: "2026-11-14",
      blocks: [
        {
          id: "existing",
          title: "Synthetic next-day appointment",
          start: "08:00",
          end: "09:00",
          kind: "event",
          status: "confirmed",
        },
      ],
    },
    "Synthetic next-day plan",
  );
  const originalBatch = historyModule.batchSnapshot;
  const spy = vi.spyOn(historyModule, "batchSnapshot").mockImplementation(async (...args) => {
    vi.setSystemTime(new Date("2026-11-13T16:00:01Z"));
    ws.writeText("NOW.md", tomorrow);
    return originalBatch(...args);
  });
  const file = "inbox/agents/midnight.proposal.json";
  ws.writeText(
    file,
    JSON.stringify({
      ...(dated ? { date: "2026-11-13" } : {}),
      title: "Synthetic midnight proposal",
      start: "11:00",
      end: "12:00",
    }),
  );
  const result = await processInbox(ws, { stableMs: 0 });
  expect(spy).toHaveBeenCalled();
  const plan = parseFrontmatter<{ date: string; blocks: { id: string }[] }>(ws.readText("NOW.md")).data;
  expect(plan.date).toBe("2026-11-14");
  expect(plan.blocks[0]?.id).toBe("existing");
  if (dated) {
    expect(result.notes).toHaveLength(1);
    expect(ws.readText("NOW.md")).toBe(tomorrow);
  } else {
    expect(result.notes).toEqual([]);
    expect(plan.blocks).toHaveLength(2);
  }
});
