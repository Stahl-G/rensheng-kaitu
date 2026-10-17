import { rmSync } from "node:fs";
import { setTimeout } from "node:timers/promises";
import { expect, it } from "vitest";
import {
  history,
  inboxNotes,
  listMemories,
  localDate,
  parseFrontmatter,
  processInbox,
  readRecords,
  readStatus,
  validateWorkspace,
} from "../src/index.js";
import { freshWorkspace, workout } from "./helpers.js";

it("四种收件箱各一个带来源版本，混合记录保留合法行与错误笔记，未稳定文件留到下一轮", async () => {
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
    expect(result.notes).toHaveLength(1);
    const versions = await history(ws);
    expect(versions.length).toBe(before.length + 5);
    for (const source of ["digest-source", "records-source", "memory-source", "proposal-source"]) {
      expect(versions.slice(0, 5).filter((v) => v.message.includes(source))).toHaveLength(1);
    }
    expect(readRecords(ws, "workout")).toHaveLength(2);
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
    expect(ws.exists("inbox/rejected")).toBe(false);
    const note = inboxNotes(ws)[0];
    expect(note?.content.endsWith(files["invalid.records.jsonl"])).toBe(true);
    expect(ws.exists("inbox/agents/invalid.records.jsonl")).toBe(false);
    expect(validateWorkspace(ws)).toEqual([]);
    const partial = "inbox/agents/partial.memory.json";
    ws.writeText(partial, '[{"type":"fact","name":"尚未完成"');
    expect((await processInbox(ws, { stableMs: 20 })).notes).toHaveLength(1);
    expect(listMemories(ws)).toHaveLength(1);
    expect(ws.exists(partial)).toBe(false);
    const afterPartial = await history(ws);
    const incoming = "inbox/agents/changing.records.jsonl";
    ws.writeText(incoming, `${JSON.stringify({ type: "workout", ...workout })}\n`);
    const processing = processInbox(ws, { stableMs: 80 });
    await setTimeout(10);
    ws.appendLine(incoming, JSON.stringify({ type: "workout", ...workout, session_id: "s2" }));
    expect((await processing).pending).toEqual([incoming]);
    expect(readRecords(ws, "workout")).toHaveLength(2);
    expect(await history(ws)).toEqual(afterPartial);
    expect((await processInbox(ws, { stableMs: 20 })).processed).toEqual([incoming]);
    expect(readRecords(ws, "workout")).toHaveLength(4);
    expect((await history(ws)).length).toBe(afterPartial.length + 1);
    expect((await processInbox(ws, { stableMs: 20 })).processed).toEqual([]);
    expect((await history(ws)).length).toBe(afterPartial.length + 1);
  } finally {
    rmSync(ws.root, { recursive: true, force: true });
  }
});

it("记录补齐来源和本地日期，剥离传输字段，保留未知类型为笔记", async () => {
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
      { type: "task", title: "给妈妈买生日礼物", status: "open", due: "2026-07-08" },
      // 不带时区的时间按工作区时区补上偏移。
      {
        type: "meal",
        meal: "晚",
        items: [{ name: "釜山猪肉汤饭" }],
        kcal: 1050,
        protein_g: 35,
        ts: "2026-07-01 19:30",
      },
    ];
    ws.writeText("inbox/agents/dot.records.jsonl", `${input.map((r) => JSON.stringify(r)).join("\n")}\n`);
    const result = await processInbox(ws, { stableMs: 0 });
    expect(result.notes).toEqual([]);
    expect(readRecords(ws, "task")).toEqual([
      expect.objectContaining({
        title: "给妈妈买生日礼物",
        status: "open",
        due: "2026-07-08",
        source: "dot",
      }),
    ]);
    expect(readRecords(ws, "meal")[0]).toMatchObject({
      meal: "晚",
      items: [{ name: "釜山猪肉汤饭" }],
      kcal: 1050,
      protein_g: 35,
      ts: "2026-07-01T19:30:00-04:00",
      source: "dot",
    });
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
    expect((await processInbox(ws, { stableMs: 0 })).notes).toEqual([]);
    expect(readRecords(ws, "metric").find((r) => r.value === 73)?.source).toBe("cloud-agent");
    ws.writeText("inbox/agents/unknown.records.jsonl", '{"type":"unknown","value":1}\n');
    expect((await processInbox(ws, { stableMs: 0 })).notes).toHaveLength(1);
    expect(inboxNotes(ws)).toHaveLength(1);
    expect(ws.exists("inbox/rejected")).toBe(false);
  } finally {
    rmSync(ws.root, { recursive: true, force: true });
  }
});

it("健康快捷指令稳定后才整批导入，重复投递无版本，失败文件作为附件转笔记", async () => {
  const ws = await freshWorkspace();
  try {
    const file = "inbox/health/daily.health.json";
    const samples = [
      {
        type: "body_mass",
        start: "2026-10-01T08:00:00+08:00",
        end: "2026-10-01T08:00:00+08:00",
        value: 70,
        unit: "kg",
        source: "Scale",
      },
    ];
    const payload = {
      format: "kaitu.health.v1",
      exported_at: "2026-10-02T08:30:00+08:00",
      device: "iPhone",
      samples,
    };
    const before = await history(ws);
    ws.writeText(file, "{");
    const processing = processInbox(ws, { stableMs: 80 });
    await setTimeout(10);
    ws.writeJson(file, payload);
    expect((await processing).pending).toEqual([file]);
    expect(readRecords(ws, "metric")).toEqual([]);
    expect(await history(ws)).toEqual(before);
    expect((await processInbox(ws, { stableMs: 0 })).processed).toEqual([file]);
    expect(readRecords(ws, "metric")).toMatchObject([{ kind: "weight", value: 70, unit: "kg" }]);
    const versions = await history(ws);
    expect(versions).toHaveLength(before.length + 1);
    const date = localDate(new Date(), ws.timeZone());
    expect(ws.readJson(`inbox/processed/${date}/daily.health.json`)).toEqual(payload);
    // 导出时间和文件名变化，原始样本不变，仍不生成新版本。
    ws.writeJson("inbox/health/again.health.json", { ...payload, exported_at: "2026-10-02T09:30:00+08:00" });
    await processInbox(ws, { stableMs: 0 });
    expect(await history(ws)).toEqual(versions);
    ws.writeJson("inbox/health/invalid.health.json", {
      ...payload,
      samples: [...samples, { ...samples[0], start: "2026-10-01T09:00:00" }],
    });
    const invalid = await processInbox(ws, { stableMs: 0 });
    expect(invalid.notes).toHaveLength(1);
    expect(readRecords(ws, "metric")).toHaveLength(1);
    const note = parseFrontmatter<{ attachment: string }>(ws.readText(invalid.notes[0] as string));
    expect(ws.readJson(note.data.attachment)).toMatchObject({
      samples: [...samples, { ...samples[0], start: "2026-10-01T09:00:00" }],
    });
    expect(validateWorkspace(ws)).toEqual([]);
  } finally {
    rmSync(ws.root, { recursive: true, force: true });
  }
});

it("健康并列列表：+07:00 的八天累计按本地日期导入，重复无版本，当天累计追加修订", async () => {
  const ws = await freshWorkspace("Asia/Ho_Chi_Minh");
  try {
    const file = "inbox/health/steps.health.json";
    const payload = {
      values: "2288\n7930\n1774\n4081\n6189\n3241\n4820\n383",
      starts: [
        "2026-10-08T06:44:25+07:00",
        "2026-10-09T06:41:36+07:00",
        "2026-10-10T06:14:17+07:00",
        "2026-10-11T08:52:02+07:00",
        "2026-10-12T06:38:49+07:00",
        "2026-10-13T00:02:34+07:00",
        "2026-10-14T06:36:28+07:00",
        "2026-10-15T06:41:39+07:00",
      ].join("\n"),
      type: "step_count",
    };
    ws.writeJson(file, payload);
    expect((await processInbox(ws, { stableMs: 0 })).processed).toEqual([file]);
    const records = readRecords(ws, "activity");
    expect(records.map(({ date, steps, ts }) => ({ date, steps, ts }))).toEqual([
      { date: "2026-10-08", steps: 2288, ts: "2026-10-08T00:00:00+07:00" },
      { date: "2026-10-09", steps: 7930, ts: "2026-10-09T00:00:00+07:00" },
      { date: "2026-10-10", steps: 1774, ts: "2026-10-10T00:00:00+07:00" },
      { date: "2026-10-11", steps: 4081, ts: "2026-10-11T00:00:00+07:00" },
      { date: "2026-10-12", steps: 6189, ts: "2026-10-12T00:00:00+07:00" },
      { date: "2026-10-13", steps: 3241, ts: "2026-10-13T00:00:00+07:00" },
      { date: "2026-10-14", steps: 4820, ts: "2026-10-14T00:00:00+07:00" },
      { date: "2026-10-15", steps: 383, ts: "2026-10-15T00:00:00+07:00" },
    ]);
    const versions = await history(ws);
    ws.writeJson(file, payload);
    await processInbox(ws, { stableMs: 0 });
    expect(await history(ws)).toEqual(versions);
    ws.writeJson(file, {
      type: "step_count",
      values: "1260",
      starts: "2026-10-15T06:41:39+07:00",
    });
    await processInbox(ws, { stableMs: 0 });
    const updated = readRecords(ws, "activity");
    expect(updated).toHaveLength(8);
    expect(updated.slice(0, 7)).toEqual(records.slice(0, 7));
    expect(updated[7]).toMatchObject({ id: records[7]?.id, date: "2026-10-15", steps: 1260, rev: 2 });
    expect(await history(ws)).toHaveLength(versions.length + 1);
    const empty = "inbox/health/sleep.health.json";
    ws.writeJson(empty, { type: "sleep_analysis", values: "", starts: "", ends: "" });
    const quiet = await processInbox(ws, { stableMs: 0 });
    expect(quiet.processed).toEqual([empty]);
    expect(quiet.notes).toEqual([]);
  } finally {
    rmSync(ws.root, { recursive: true, force: true });
  }
});

it("健康并列列表行数不一致时整份作为附件转笔记，不写入前面的有效行", async () => {
  const ws = await freshWorkspace();
  try {
    const file = "inbox/health/mismatch.health.json";
    const payload = {
      type: "body_mass",
      values: "70\n71",
      starts: "2026-10-14T08:00:00+07:00\n2026-10-15T08:00:00+07:00",
      units: "kg",
    };
    ws.writeJson(file, payload);
    const result = await processInbox(ws, { stableMs: 0 });
    expect(result.processed).toEqual([]);
    expect(result.notes).toHaveLength(1);
    expect(readRecords(ws, "metric")).toEqual([]);
    expect(ws.exists(file)).toBe(false);
    const note = parseFrontmatter<{ attachment: string }>(ws.readText(result.notes[0] as string));
    expect(ws.readJson(note.data.attachment)).toEqual(payload);
  } finally {
    rmSync(ws.root, { recursive: true, force: true });
  }
});

it("收件箱按内容收文件：普通 .json 记录、.md 笔记、多写字段的记忆和日程建议、没写日期的简报都照常处理", async () => {
  const ws = await freshWorkspace("Asia/Shanghai");
  try {
    const today = localDate(new Date(), ws.timeZone());
    const files = {
      // 没用约定后缀、带了 id
      "grok-meals.json": JSON.stringify([
        {
          type: "meal",
          id: "abc",
          meal: "午",
          items: [{ name: "牛肉面" }],
          kcal: 650,
          protein_g: 30,
          agent: "grok-bot",
        },
      ]),
      "grok-idea.md": "# 想法\n\n周末去爬山。\n",
      // 普通 .json 里写明 type: proposal 的日程建议
      "grok-stretch.json": JSON.stringify({ type: "proposal", title: "拉伸", start: "21:00", end: "21:15" }),
      "grok.memory.json": JSON.stringify([
        { type: "preference", text: "喜欢晚上训练", confidence: 0.9, agent: "grok-bot" },
      ]),
      "grok.proposal.json": JSON.stringify({
        title: "散步",
        start: "09:00",
        end: "09:30",
        reason: "天气好",
        agent: "grok-bot",
      }),
      "grok.digest.md": "---\nagent: grok-bot\n---\n今天的简报。\n",
    };
    for (const [name, text] of Object.entries(files)) ws.writeText(`inbox/agents/${name}`, text);
    const result = await processInbox(ws, { stableMs: 0 });
    // 只有 .md 笔记进待整理，而且不带错误说明
    expect(result.notes).toHaveLength(1);
    expect(ws.readText(result.notes[0] as string)).not.toContain("不支持");
    expect(readRecords(ws, "meal")).toMatchObject([
      { meal: "午", items: [{ name: "牛肉面" }], source: "grok-bot" },
    ]);
    expect(listMemories(ws).map((memory) => [memory.type, memory.text])).toEqual([
      ["preference", "喜欢晚上训练"],
    ]);
    expect(
      parseFrontmatter<{ blocks: { title: string; start: string }[] }>(ws.readText("NOW.md")).data.blocks,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ title: "散步", start: "09:00" }),
        expect.objectContaining({ title: "拉伸", start: "21:00", status: "pending" }),
      ]),
    );
    expect(ws.readText(`feed/digests/${today}.md`)).toContain("今天的简报。");
    // 写了日期却读不出：转待整理，不归到今天。
    ws.writeText(
      "inbox/agents/typo.digest.md",
      "---\ndate: 2026-13-40\nagent: grok-bot\n---\n日期写错的简报。\n",
    );
    const typo = await processInbox(ws, { stableMs: 0 });
    expect(typo.notes).toHaveLength(1);
    expect(ws.readText(typo.notes[0] as string)).toContain("简报的 date 读不出");
    expect(ws.readText(`feed/digests/${today}.md`)).not.toContain("日期写错的简报");
  } finally {
    rmSync(ws.root, { recursive: true, force: true });
  }
});
