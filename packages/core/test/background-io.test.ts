import fs from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { unzipSync } from "fflate";
import { expect, it } from "vitest";
import { reindexChatsAsync, searchChatsAsync } from "../src/chat-search.js";
import { exportWorkspaceAsync, workspaceExportRequest } from "../src/settings.js";
import { workspaceFileStampsAsync } from "../src/workbench.js";
import { freshWorkspace } from "./helpers.js";

it("首次完整索引与 ZIP 在后台保留完整范围，取消索引回滚，取消压缩不产生结果，轮询只读元数据且可中止", async () => {
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
    for (let i = 0; i < 150; i++)
      fs.writeFileSync(
        join(directory, `${String(i).padStart(4, "0")}.jsonl`),
        chat(`chat-${i}`, `${"合成内容 ".repeat(3000)} ${i === 149 ? "only-last-file" : ""}`),
      );
    const progress: number[] = [];
    const search = searchChatsAsync(ws, "only-last-file", {
      progress: (value) => progress.push(value.completed),
    });
    // 调用返回的是尚未完成的后台工作，主线程仍能处理独立读取。
    expect(ws.readText("me/goals.json")).toBeTruthy();
    expect((await search).map((row) => row.title)).toEqual(["chat-149"]);
    expect(progress.at(-1)).toBe(150);
    fs.writeFileSync(join(directory, "new.jsonl"), chat("new", "new-file"));
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
    expect(index.prepare("SELECT count(*) AS count FROM files").get()?.count).toBe(150);
    index.close();
    expect((await searchChatsAsync(ws, "new-file")).map((row) => row.title)).toEqual(["new"]);

    const compress = new AbortController();
    await expect(
      exportWorkspaceAsync(ws, {
        signal: compress.signal,
        progress: (value) => {
          if (value.phase === "compress") compress.abort();
        },
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    const file = await exportWorkspaceAsync(ws);
    const entries = unzipSync(Buffer.from(file.base64, "base64"));
    expect(Buffer.from(entries["chats/2026/10/0149.jsonl"] ?? []).toString()).toContain("only-last-file");
    expect(Object.keys(entries).some((path) => path.startsWith(".kaitu/"))).toBe(false);
    expect(workspaceExportRequest(ws, "start").status).toBe("running");
    expect(workspaceExportRequest(ws, "cancel").status).toBe("cancelled");
    expect(workspaceExportRequest(ws, "status").status).toBe("idle");
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
