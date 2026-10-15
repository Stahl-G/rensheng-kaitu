import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { Workspace, acquireLock, readLock, releaseLock } from "../src/index.js";

it("取锁、拒绝其他持有人，过期后接管并放锁；本地模式不产生锁", () => {
  const root = mkdtempSync(join(tmpdir(), "kaitu-lock-"));
  try {
    const ws = new Workspace(join(root, "workspace"), { maintain: false });
    expect(acquireLock(ws, "local", "本地写入")).toBeNull();
    expect(readLock(ws)).toBeNull();
    ws.writeJson(".kaitu/config.json", { state_dir: join(root, "state") }, { internal: true });
    const first = acquireLock(ws, "dot", "更新状态");
    expect(readLock(ws)).toEqual(first);
    expect(Date.parse(first?.expires_at ?? "") - Date.parse(first?.acquired_at ?? "")).toBe(15 * 60000);
    expect(() => acquireLock(ws, "grok", "接手")).toThrowError(
      expect.objectContaining({ code: "LOCK_BUSY" }),
    );
    expect(readLock(ws)).toEqual(first);
    ws.writeJson("LOCK.json", {
      ...first,
      acquired_at: new Date(Date.now() - 16 * 60000).toISOString(),
      expires_at: new Date(Date.now() - 60000).toISOString(),
    });
    const second = acquireLock(ws, "grok", "接手");
    expect(readLock(ws)?.holder).toBe("grok");
    releaseLock(ws, first);
    expect(readLock(ws)).toEqual(second);
    releaseLock(ws, second);
    expect(Date.parse(readLock(ws)?.expires_at ?? "")).toBeLessThanOrEqual(Date.now());
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 15000);
