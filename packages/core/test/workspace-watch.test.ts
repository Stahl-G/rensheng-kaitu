import { once } from "node:events";
import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { historyDirectory } from "../src/history.js";
import { enableSync } from "../src/index.js";
import { startPhoneSnapshots } from "../src/phone-snapshots.js";
import { watchWorkspace } from "../src/workspace-watch.js";
import { freshWorkspace, tmp } from "./helpers.js";

it("资料监听在遍历前排除内部历史和缓存，新目录、修改、改名、删除及重建仍触发失效", async () => {
  const ws = await freshWorkspace();
  const changed: string[] = [];
  const watcher = watchWorkspace(ws.root, (file) => changed.push(file));
  try {
    await once(watcher, "ready");
    const watched = Object.keys(watcher.getWatched());
    expect(watched.some((dir) => dir.startsWith(historyDirectory(ws)))).toBe(false);
    expect(watched.some((dir) => dir.startsWith(join(ws.root, ".kaitu/cache")))).toBe(false);
    const directory = join(ws.root, "projects/watch-journey");
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, "first.md"), "合成第一版\n");
    await expect.poll(() => changed).toContain("projects/watch-journey/first.md");
    changed.length = 0;
    writeFileSync(join(directory, "first.md"), "合成实际编辑\n");
    await expect.poll(() => changed).toContain("projects/watch-journey/first.md");
    changed.length = 0;
    renameSync(join(directory, "first.md"), join(directory, "renamed.md"));
    await expect.poll(() => changed).toContain("projects/watch-journey/renamed.md");
    await expect.poll(() => changed).toContain("projects/watch-journey/first.md");
    rmSync(directory, { recursive: true });
    await expect.poll(() => changed).toContain("projects/watch-journey");
    changed.length = 0;
    mkdirSync(directory);
    writeFileSync(join(directory, "rebuilt.md"), "合成重新出现\n");
    await expect.poll(() => changed).toContain("projects/watch-journey/rebuilt.md");
  } finally {
    await watcher.close();
  }
});

it("手机快照复用已有监听，停止后退订但不关闭借用的监听", async () => {
  const ws = await freshWorkspace();
  await enableSync(ws, "drive", { dir: tmp(), name: "synthetic-shared-watch" });
  const changed: string[] = [];
  const watcher = watchWorkspace(ws.root, (file) => changed.push(file));
  const errors: unknown[] = [];
  const stop = startPhoneSnapshots(ws, (error) => errors.push(error), watcher);
  try {
    await once(watcher, "ready");
    ws.writeText("inbox/notes/2026-10-20/shared-watch.md", "手机共享监听的合成原文\n");
    await expect
      .poll(() => ws.exists("phone/library.json") && ws.readText("phone/library.json"), { timeout: 5000 })
      .toContain("手机共享监听的合成原文");
    await stop();
    expect(errors).toEqual([]);
    expect(watcher.listenerCount("all")).toBe(1);
    ws.writeText("inbox/notes/2026-10-20/after-stop.md", "停止手机后台后仍监听\n");
    await expect.poll(() => changed).toContain("inbox/notes/2026-10-20/after-stop.md");
  } finally {
    await stop();
    await watcher.close();
  }
});
