import { expect, it, vi } from "vitest";
import { handoverPack } from "../src/handover.js";
import { history } from "../src/history.js";
import * as historyModule from "../src/history.js";
import { readMe } from "../src/me-page.js";
import {
  archiveMemory,
  captureMemory,
  listMemories,
  memoryExpectation,
  replaceMemory,
  updateMemory,
} from "../src/memory.js";
import { readRecords } from "../src/records.js";
import { validateWorkspace } from "../src/validate.js";
import { Workspace } from "../src/workspace.js";
import { clonedWorkspace } from "./helpers.js";

const observation = {
  idempotency_key: "synthetic-chat/message-1/0",
  type: "preference" as const,
  name: "合成阅读偏好",
  text: "我喜欢纸质地图",
  source: "synthetic-chat/message-1",
  origin: "user-stated" as const,
  observed_at: "2026-10-26T10:00:00+08:00",
  evidence: "我喜欢纸质地图",
  scope: "personal" as const,
};

it("自然事实自动落盘，新会话读取，纠正保留历史，单条撤销重开恢复原条且不复活重试", async () => {
  const ws = await clonedWorkspace();
  const first = await captureMemory(ws, observation);
  if (!first.entry) throw new Error("Missing persisted entry");
  expect(listMemories(new Workspace(ws.root))[0]).toMatchObject(first.entry);
  const original = ws.readText(`memory/${first.entry.file}`);
  const correction = {
    ...observation,
    idempotency_key: "synthetic-chat/message-2/0",
    text: "更正：我喜欢电子地图",
    evidence: "更正：我喜欢电子地图",
    replaces: first.entry.file,
    expected: memoryExpectation(first.entry),
  };
  const second = await captureMemory(ws, correction);
  if (!second.entry) throw new Error("Missing correction");
  expect(ws.readText(`memory/${first.entry.file}`)).toBe(original);
  expect(listMemories(ws).map((entry) => entry.text)).toEqual([correction.text]);
  expect((await captureMemory(ws, observation)).status).toBe("superseded");
  expect(readMe(ws).archivedMemories[0]).toMatchObject({
    file: first.entry.file,
    replaced_by: second.entry.file,
  });
  const later = { ...observation, idempotency_key: "synthetic-chat/message-3/0", text: "我喜欢折纸" };
  await captureMemory(ws, later);
  await archiveMemory(ws, second.entry.file, { by: "user", expected: memoryExpectation(second.entry) });
  expect(
    listMemories(new Workspace(ws.root))
      .map((entry) => entry.text)
      .sort(),
  ).toEqual([observation.text, later.text].sort());
  expect((await captureMemory(ws, correction)).status).toBe("undone");
  expect(
    readMe(new Workspace(ws.root)).archivedMemories.some((entry) => entry.file === second.entry?.file),
  ).toBe(true);
  expect(validateWorkspace(ws)).toEqual([]);
});

it("估算有依据和误差，建议不变成事实或日程承诺，禁止直接覆盖原话", async () => {
  const ws = await clonedWorkspace();
  for (const origin of ["ai-estimate", "ai-suggestion"] as const) {
    const result = await captureMemory(ws, {
      ...observation,
      idempotency_key: origin,
      origin,
      type: "decision",
      text: "合成方案用纸约20张",
      uncertainty: "按草图估算，尚未核实或采纳",
    });
    expect(result.entry).toMatchObject({
      type: "context",
      origin,
      uncertainty: "按草图估算，尚未核实或采纳",
    });
    expect(result.entry?.text).toContain("[AI ");
    if (result.entry)
      await expect(updateMemory(ws, result.entry.file, { type: "fact" })).rejects.toMatchObject({
        code: "CONFLICT",
      });
  }
  expect(handoverPack(ws, "en").text).toContain("AI estimate");
  expect(readRecords(ws, "task")).toHaveLength(0);
  expect(readRecords(ws, "event")).toHaveLength(0);
  await expect(captureMemory(ws, { ...observation, origin: "ai-estimate" })).rejects.toMatchObject({
    code: "INVALID_MEMORY",
  });
});

it("临时、引用、假设不入长期画像；时间/单位的变化可存，真正未解冲突不写", async () => {
  const ws = await clonedWorkspace();
  for (const scope of ["temporary", "quoted", "hypothetical"] as const)
    expect((await captureMemory(ws, { ...observation, scope })).status).toBe("skipped");
  expect(listMemories(ws)).toHaveLength(0);
  // Semantic classification/resolution is supplied by the current AI, not a regex extractor.
  for (const [index, text] of ["昨天合成模型重82g", "今天合成模型重81.5g（0.0815kg）"].entries())
    await captureMemory(ws, {
      ...observation,
      idempotency_key: `weight-${index}`,
      type: "fact",
      text,
      evidence: text,
    });
  const result = await captureMemory(ws, {
    ...observation,
    idempotency_key: "conflict",
    conflict: "同一模型同一时刻给了两个重量，会影响材料计算",
  });
  expect(result.status).toBe("needs-clarification");
  expect(listMemories(ws)).toHaveLength(2);
});

it("重复触发只存一次，同键异文拒绝，写入失败和已存文件后的索引失败可恢复", async () => {
  const ws = await clonedWorkspace();
  const before = await history(ws);
  const write = vi.spyOn(ws, "writeText");
  write.mockImplementationOnce(() => {
    throw new Error("synthetic disk failure");
  });
  await expect(captureMemory(ws, observation)).rejects.toThrow("synthetic disk failure");
  expect(listMemories(ws)).toHaveLength(0);
  write.mockRestore();
  const original = ws.writeText.bind(ws);
  const indexFailure = vi.spyOn(ws, "writeText").mockImplementation((file, ...args) => {
    if (file === "memory/MEMORY.md") throw new Error("synthetic index failure");
    return original(file, ...args);
  });
  const interrupted = await captureMemory(ws, observation);
  expect(interrupted).toMatchObject({
    status: "saved",
    version: null,
    warning: expect.stringContaining("index failure"),
  });
  indexFailure.mockRestore();
  const restarted = new Workspace(ws.root);
  const duplicate = await captureMemory(restarted, observation);
  expect(duplicate.status).toBe("duplicate");
  expect(listMemories(restarted)).toHaveLength(1);
  await Promise.all([
    captureMemory(ws, observation, { scheduleVersion: () => {} }),
    captureMemory(restarted, observation, { scheduleVersion: () => {} }),
  ]);
  expect(listMemories(restarted)).toHaveLength(1);
  expect(await history(restarted)).toHaveLength(before.length + 1);
  await expect(captureMemory(restarted, { ...observation, text: "different" })).rejects.toMatchObject({
    code: "CONFLICT",
  });
  expect(restarted.readText("memory/MEMORY.md")).toContain(observation.text);
});

it("版本保存失败仍可单条撤销纠正并恢复旧条，历史原文不依赖Git成功", async () => {
  const ws = await clonedWorkspace();
  const first = await captureMemory(ws, observation);
  if (!first.entry) throw new Error("Missing original");
  const snapshot = vi.spyOn(historyModule, "snapshot").mockResolvedValueOnce(null);
  const second = await captureMemory(ws, {
    ...observation,
    idempotency_key: "history-failure",
    text: "更正为蓝纸",
    evidence: "更正为蓝纸",
    replaces: first.entry.file,
    expected: memoryExpectation(first.entry),
  });
  snapshot.mockRestore();
  expect(second).toMatchObject({
    status: "saved",
    version: null,
    notice: expect.stringContaining("版本尚未核实"),
  });
  if (!second.entry) throw new Error("Missing correction");
  await archiveMemory(ws, second.entry.file, { by: "user", expected: memoryExpectation(second.entry) });
  expect(listMemories(new Workspace(ws.root))[0]?.text).toBe(observation.text);
});

it("个人档案纠正自动记录也复用追加关联，撤销恢复原条，保留敏感标记", async () => {
  const ws = await clonedWorkspace();
  const first = await captureMemory(ws, { ...observation, sensitive: true });
  if (!first.entry) throw new Error("Missing original");
  const next = await replaceMemory(
    ws,
    first.entry.file,
    { type: "preference", name: "new", text: "合成新偏好" },
    { by: "user", expected: memoryExpectation(first.entry) },
  );
  expect(next).toMatchObject({ replaces: first.entry.file, sensitive: true });
  expect((await captureMemory(ws, { ...observation, sensitive: true })).status).toBe("superseded");
  await archiveMemory(ws, next.file, { by: "user", expected: memoryExpectation(next) });
  expect(listMemories(new Workspace(ws.root))[0]?.text).toBe(observation.text);
});
