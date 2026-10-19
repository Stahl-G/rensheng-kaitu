import { once } from "node:events";
import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { historyDirectory } from "../src/history.js";
import { watchWorkspace } from "../src/workspace-watch.js";
import { freshWorkspace } from "./helpers.js";

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
