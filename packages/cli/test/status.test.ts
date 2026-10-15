import { execFile } from "node:child_process";
import { chmodSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { history, initWorkspace, processInbox, readRecords } from "@kaitu/core";
import { expect, it } from "vitest";

it("status 汇总样例的今日待确认数量和近 7 天训练次数", async () => {
  const root = mkdtempSync(join(tmpdir(), "kaitu-status-"));
  try {
    await initWorkspace(root, { sample: true });
    const { stdout } = await promisify(execFile)(process.execPath, [
      "packages/cli/dist/main.js",
      "status",
      "--dir",
      root,
      "--json-out",
    ]);
    const data = JSON.parse(stdout);
    expect(data.now.pending).toBe(2);
    expect(data.recent7.workouts).toBe(4);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it("版本库只读时 record add 仍保存数据并报告待补版本", async () => {
  const root = mkdtempSync(join(tmpdir(), "kaitu-readonly-"));
  const ws = await initWorkspace(root);
  const repository = join(root, ".kaitu/history.git");
  const permissions = (dir: string, writable: boolean) => {
    chmodSync(dir, writable ? 0o755 : 0o555);
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) permissions(path, writable);
      else chmodSync(path, writable ? 0o644 : 0o444);
    }
  };
  try {
    permissions(repository, false);
    const { stderr, stdout } = await promisify(execFile)(process.execPath, [
      "packages/cli/dist/main.js",
      "record",
      "add",
      "workout",
      "--dir",
      root,
      "--json-out",
      "--json",
      JSON.stringify({ exercise: "深蹲", sets: 3, reps: 12, weight_kg: 60, session_id: "s1" }),
    ]);
    expect(readRecords(ws, "workout")).toHaveLength(1);
    expect(JSON.parse(stdout).version).toBeNull();
    expect(stderr.trim().length).toBeGreaterThan(0);
  } finally {
    permissions(repository, true);
    rmSync(root, { recursive: true, force: true });
  }
});

it("自然语言笔记原样保留，status 计数，inbox done 归档并生成版本", async () => {
  const root = mkdtempSync(join(tmpdir(), "kaitu-notes-"));
  try {
    const ws = await initWorkspace(root);
    const content = "---\nagent: grok-bot\n---\n今天体重 70.4kg，跑了 5 公里\n";
    ws.writeText("inbox/agents/today.note.md", content);
    const before = await history(ws);
    await processInbox(ws, { stableMs: 0 });
    const run = async (...args: string[]) => {
      const { stdout } = await promisify(execFile)(process.execPath, [
        "packages/cli/dist/main.js",
        ...args,
        "--dir",
        root,
        "--json-out",
      ]);
      return JSON.parse(stdout);
    };
    const notes = await run("inbox", "notes");
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ agent: "grok-bot", content });
    expect(ws.readText(notes[0].path)).toBe(content);
    expect((await run("status")).inboxNotes).toBe(1);
    expect(await history(ws)).toHaveLength(before.length + 1);
    const archived = await run("inbox", "done", notes[0].path);
    expect(ws.exists(notes[0].path)).toBe(false);
    expect(ws.readText(archived.path)).toBe(content);
    expect(archived.path).toMatch(/^inbox\/notes\/done\/\d{4}-\d{2}-\d{2}\/today.note.md$/);
    expect(archived.version).toBeTruthy();
    expect((await run("status")).inboxNotes).toBe(0);
    expect(await run("inbox", "notes")).toEqual([]);
    expect(await history(ws)).toHaveLength(before.length + 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
