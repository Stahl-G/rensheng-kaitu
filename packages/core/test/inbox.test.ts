import { rmSync } from "node:fs";
import { setTimeout } from "node:timers/promises";
import { expect, it } from "vitest";
import {
  history,
  listMemories,
  localDate,
  parseFrontmatter,
  processInbox,
  readRecords,
  readStatus,
  validateWorkspace,
} from "../src/index.js";
import { freshWorkspace, workout } from "./helpers.js";

it("四种收件箱各一个带来源版本，非法整批拒绝，未稳定文件留到下一轮", async () => {
  const ws = await freshWorkspace();
  try {
    const date = localDate(new Date(), ws.timeZone());
    const files = {
      "a.digest.md": `---\ndate: ${date}\nagent: digest-source\n---\n合成简报\n`,
      "b.records.jsonl": `${JSON.stringify({ type: "workout", ...workout, agent: "records-source" })}\n`,
      "c.memory.json": JSON.stringify([
        { type: "preference", name: "合成偏好", text: "喜欢散步", agent: "memory-source" },
      ]),
      "d.proposal.json": JSON.stringify({
        title: "合成建议",
        start: "18:00",
        end: "19:00",
        agent: "proposal-source",
      }),
      "invalid.records.jsonl": `${[
        { type: "workout", ...workout },
        { type: "metric", kind: "weight", value: "invalid-without-unit" },
      ]
        .map((row) => JSON.stringify(row))
        .join("\n")}\n`,
    };
    for (const [name, text] of Object.entries(files)) ws.writeText(`inbox/agents/${name}`, text);
    const before = await history(ws);
    const result = await processInbox(ws, { stableMs: 30 });
    expect(result.processed).toHaveLength(4);
    expect(result.rejected).toEqual(["inbox/agents/invalid.records.jsonl"]);
    const versions = await history(ws);
    expect(versions.length).toBe(before.length + 4);
    for (const source of ["digest-source", "records-source", "memory-source", "proposal-source"]) {
      expect(versions.slice(0, 4).filter((v) => v.message.includes(source))).toHaveLength(1);
    }
    expect(readRecords(ws, "workout")).toHaveLength(1);
    expect(readRecords(ws, "metric")).toEqual([]);
    expect(listMemories(ws)).toHaveLength(1);
    const plan = parseFrontmatter<{ blocks: { kind: string; status: string }[] }>(ws.readText("NOW.md"));
    expect(plan.data.blocks).toHaveLength(1);
    expect(plan.data.blocks[0]).toMatchObject({ kind: "proposal", status: "pending" });
    expect(readStatus(ws).now.pending).toBe(1);
    for (const name of Object.keys(files).slice(0, 4)) {
      expect(ws.readText(`inbox/processed/${date}/${name}`)).toBe(files[name as keyof typeof files]);
      expect(ws.exists(`inbox/agents/${name}`)).toBe(false);
    }
    expect(ws.exists("inbox/rejected/invalid.records.jsonl.error.txt")).toBe(true);
    expect(ws.readText("inbox/rejected/invalid.records.jsonl")).toBe(files["invalid.records.jsonl"]);
    expect(validateWorkspace(ws)).toEqual([]);
    const partial = "inbox/agents/partial.memory.json";
    ws.writeText(partial, '[{"type":"fact","name":"尚未完成"');
    expect((await processInbox(ws, { stableMs: 20 })).pending).toEqual([partial]);
    expect(listMemories(ws)).toHaveLength(1);
    expect(ws.exists(partial)).toBe(true);
    rmSync(ws.resolve(partial));
    const incoming = "inbox/agents/changing.records.jsonl";
    ws.writeText(incoming, `${JSON.stringify({ type: "workout", ...workout })}\n`);
    const processing = processInbox(ws, { stableMs: 80 });
    await setTimeout(10);
    ws.appendLine(incoming, JSON.stringify({ type: "workout", ...workout, session_id: "s2" }));
    expect((await processing).pending).toEqual([incoming]);
    expect(readRecords(ws, "workout")).toHaveLength(1);
    expect(await history(ws)).toEqual(versions);
    expect((await processInbox(ws, { stableMs: 20 })).processed).toEqual([incoming]);
    expect(readRecords(ws, "workout")).toHaveLength(3);
    expect((await history(ws)).length).toBe(versions.length + 1);
    expect((await processInbox(ws, { stableMs: 20 })).processed).toEqual([]);
    expect((await history(ws)).length).toBe(versions.length + 1);
  } finally {
    rmSync(ws.root, { recursive: true, force: true });
  }
}, 10000);

it("记录补齐来源和本地日期，剥离传输字段，拒绝未知类型并列出可用类型", async () => {
  const ws = await freshWorkspace("America/New_York");
  try {
    const input = [
      { type: "metric", kind: "weight", value: 70, unit: "kg", date: "2026-07-01", agent: "dot" },
      { type: "metric", kind: "weight", value: 71, unit: "kg", date: "2026-01-01", source: "scale" },
      {
        type: "metric",
        kind: "weight",
        value: 72,
        unit: "kg",
        ts: "2026-07-02T16:00:00-04:00",
        date: "2026-07-01",
      },
      { type: "activity", date: "2026-07-01", steps: 100 },
    ];
    ws.writeText("inbox/agents/dot.records.jsonl", `${input.map((r) => JSON.stringify(r)).join("\n")}\n`);
    const result = await processInbox(ws, { stableMs: 0 });
    expect(result.rejected).toEqual([]);
    const rows = readRecords(ws, "metric");
    expect(rows.map(({ source, ts }) => ({ source, ts }))).toEqual([
      { source: "scale", ts: "2026-01-01T12:00:00-05:00" },
      { source: "dot", ts: "2026-07-01T12:00:00-04:00" },
      { source: "dot", ts: "2026-07-02T16:00:00-04:00" },
    ]);
    expect(rows.every((row) => !["agent", "type", "date"].some((key) => key in row))).toBe(true);
    expect(readRecords(ws, "activity")[0]).toMatchObject({
      date: "2026-07-01",
      ts: "2026-07-01T12:00:00-04:00",
      source: "dot",
    });
    ws.writeText(
      "inbox/agents/anonymous.records.jsonl",
      `${JSON.stringify({ type: "metric", kind: "weight", value: 73, unit: "kg" })}\n`,
    );
    expect((await processInbox(ws, { stableMs: 0 })).rejected).toEqual([]);
    expect(readRecords(ws, "metric").find((r) => r.value === 73)?.source).toBe("cloud-agent");
    ws.writeText("inbox/agents/unknown.records.jsonl", '{"type":"unknown","value":1}\n');
    expect((await processInbox(ws, { stableMs: 0 })).rejected).toHaveLength(1);
    const error = ws.readText("inbox/rejected/unknown.records.jsonl.error.txt");
    const help = JSON.parse(error.slice(error.indexOf("\n\n") + 2));
    const { listRecordTypes } = await import("../src/index.js");
    expect(help.record_types.map((ref: { type: string }) => ref.type)).toEqual(
      listRecordTypes(ws).map((ref) => ref.type),
    );
  } finally {
    rmSync(ws.root, { recursive: true, force: true });
  }
});
