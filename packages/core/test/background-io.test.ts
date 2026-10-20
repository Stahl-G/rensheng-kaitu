import fs from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { unzipSync } from "fflate";
import { expect, it, onTestFailed } from "vitest";
import { reindexChatsAsync, searchChatsAsync } from "../src/chat-search.js";
import { localStateRoot } from "../src/local-state.js";
import { exportWorkspaceAsync, workspaceExportRequest } from "../src/settings.js";
import { workspaceFileStampsAsync } from "../src/workbench.js";
import { Workspace } from "../src/workspace.js";
import { freshWorkspace } from "./helpers.js";

it("首次完整索引与 ZIP 在后台保留完整范围，取消索引回滚，取消压缩不产生结果，轮询只读元数据且可中止", async () => {
  let stage = "initialize";
  onTestFailed(() => console.info(`background IO journey failed during: ${stage}`));
  const ws = await freshWorkspace();
  try {
    const directory = join(ws.root, "chats/2026/10");
    fs.mkdirSync(directory, { recursive: true });
    const chat = (id: string, text: string) =>
      [
        {
          type: "chat",
          id,
          title: id,
          source: "synthetic",
          created: "2026-10-19T00:00:00Z",
          updated: "2026-10-19T00:00:00Z",
        },
        { type: "message", id: "m1", role: "user", ts: null, text },
      ]
        .map((row) => JSON.stringify(row))
        .join("\n");
    for (let i = 0; i < 80; i++)
      fs.writeFileSync(
        join(directory, `${String(i).padStart(4, "0")}.jsonl`),
        chat(`chat-${i}`, `${"合成内容 ".repeat(1000)} ${i === 79 ? "only-last-file" : ""}`),
      );
    const progress: number[] = [];
    stage = "first search";
    const search = searchChatsAsync(ws, "only-last-file", {
      progress: (value) => progress.push(value.completed),
    });
    // 调用返回的是尚未完成的后台工作，主线程仍能处理独立读取。
    expect(ws.readText("me/goals.json")).toBeTruthy();
    expect((await search).map((row) => row.title)).toEqual(["chat-79"]);
    expect(progress.at(-1)).toBe(80);
    fs.writeFileSync(join(directory, "new.jsonl"), chat("new", "new-file"));
    stage = "cancel reindex";
    const cancellation = new AbortController();
    await expect(
      reindexChatsAsync(ws, {
        signal: cancellation.signal,
        progress: (value) => {
          if (value.phase === "index" && value.completed === 0) cancellation.abort();
        },
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    const index = new DatabaseSync(ws.resolve(".kaitu/index.sqlite", { internal: true }));
    expect(index.prepare("SELECT count(*) AS count FROM files").get()?.count).toBe(80);
    index.close();
    stage = "incremental search";
    expect((await searchChatsAsync(ws, "new-file")).map((row) => row.title)).toEqual(["new"]);

    stage = "cancel compression";
    const compress = new AbortController();
    await expect(
      exportWorkspaceAsync(ws, {
        signal: compress.signal,
        progress: (value) => {
          if (value.phase === "compress") compress.abort();
        },
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    stage = "complete export";
    const file = await exportWorkspaceAsync(ws);
    const entries = unzipSync(fs.readFileSync(file.path));
    await file.dispose();
    stage = "failed export cleanup";
    await expect(
      exportWorkspaceAsync(new Workspace(join(ws.root, "missing"), { maintain: false })),
    ).rejects.toThrow();
    expect(fs.readdirSync(join(localStateRoot(), "exports"))).toEqual([]);
    expect(Buffer.from(entries["chats/2026/10/0079.jsonl"] ?? []).toString()).toContain("only-last-file");
    expect(Object.keys(entries).some((path) => path.startsWith(".kaitu/"))).toBe(false);
    stage = "export job cancellation";
    expect((await workspaceExportRequest(ws, "start")).status).toBe("running");
    expect((await workspaceExportRequest(ws, "cancel")).status).toBe("cancelled");
    expect((await workspaceExportRequest(ws, "status")).status).toBe("idle");
    expect(fs.readdirSync(join(localStateRoot(), "exports"))).toEqual([]);
    stage = "metadata scans";
    const scan = new AbortController();
    await expect(
      workspaceFileStampsAsync(ws, { signal: scan.signal, progress: () => scan.abort() }),
    ).rejects.toMatchObject({ name: "AbortError" });
    const stamps = await workspaceFileStampsAsync(ws);
    expect(stamps.has("chats/2026/10/new.jsonl")).toBe(true);
    expect([...stamps].some(([path]) => path.startsWith(".kaitu/history.git/"))).toBe(false);
    expect(fs.readFileSync(join(directory, "new.jsonl"), "utf8")).toContain("new-file");
  } finally {
    fs.rmSync(ws.root, { recursive: true, force: true });
  }
});
