import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initWorkspace, readExploration, writeExploration } from "@kaitu/core";
import { expect, it } from "vitest";
import { progressRows } from "../src/client/progress-map.js";

it("进度图的线型只看资料：做过的画实线，有下一步画虚线，AI 建议和没有下一步的画点线，暂停的不列", async () => {
  const root = mkdtempSync(join(tmpdir(), "kaitu-progress-map-"));
  try {
    const ws = await initWorkspace(root);
    const direction = (title: string, by: "user" | "agent" = "user") =>
      writeExploration(
        ws,
        { operation: "create_direction", data: { title, motivation: "合成", hypothesis: "合成" } },
        by,
      );
    const experiment = (direction_id: string, action: string) =>
      writeExploration(ws, {
        operation: "create_experiment",
        data: {
          direction_id,
          question: "合成",
          action,
          budget: "一周",
          deadline: "2026-11-01",
          criteria: "合成",
        },
      });
    const moving = await direction("要不要换城市");
    const tried = await experiment(moving.id, "周末去看房");
    await writeExploration(ws, {
      operation: "update_experiment",
      id: tried.id,
      expected_revision: 1,
      data: { status: "completed", result: "通勤 35 分钟", conclusion: "supports" },
    });
    await experiment(moving.id, "投三家公司");
    await direction("学一门乐器");
    const paused = await direction("开一家咖啡店");
    await writeExploration(ws, {
      operation: "update_direction",
      id: paused.id,
      expected_revision: 1,
      data: { status: "paused" },
    });
    await direction("副业能养活自己吗？", "agent");

    const rows = progressRows(
      {
        goals: [
          {
            id: "g1",
            title: "规律训练",
            area: null,
            origin: null,
            results: 2,
            lastResult: "深蹲 60 kg",
            next: { id: "t1", title: "腿部训练", due: null, rev: 1 },
          },
          {
            id: "g2",
            title: "读完两本书",
            area: null,
            origin: null,
            results: 0,
            lastResult: null,
            next: null,
          },
        ],
        projects: 0,
        directions: 0,
      },
      [
        {
          slug: "app",
          title: "记账小程序",
          next: ["画首页草图"],
          daily: [{ date: "2026-10-16", words: null, commits: 3 }],
          metricFiles: [],
          file: "",
          words: null,
          commits: 3,
          from: "",
          to: "",
        },
        {
          slug: "book",
          title: "写作",
          next: [],
          daily: [{ date: "2026-10-16", words: 0, commits: null }],
          metricFiles: [],
          file: "",
          words: 0,
          commits: null,
          from: "",
          to: "",
        },
      ],
      readExploration(ws),
    );
    const line = (title: string) => {
      const row = rows.find((item) => item.title === title);
      return (
        row &&
        [row.done ? "solid" : "", row.ahead === "planned" ? "dashed" : "dotted", row.next ?? ""].join("|")
      );
    };
    expect(line("规律训练")).toBe("solid|dashed|腿部训练");
    expect(line("读完两本书")).toBe("|dotted|");
    expect(line("记账小程序")).toBe("solid|dashed|画首页草图");
    expect(line("写作")).toBe("|dotted|");
    expect(line("要不要换城市")).toBe("solid|dashed|投三家公司");
    expect(line("学一门乐器")).toBe("|dotted|");
    expect(line("副业能养活自己吗？")).toBe("|dotted|");
    expect(line("开一家咖啡店")).toBeUndefined();
    // AI 建议排在进行中的方向之后。
    expect(
      rows
        .filter((row) => row.kind === "direction")
        .map((row) => row.title)
        .at(-1),
    ).toBe("副业能养活自己吗？");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
