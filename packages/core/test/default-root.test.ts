import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { defaultRoot } from "../src/workspace.js";

it("新用户默认用 ~/kaitu-ai-memory，已有的 ~/kaitu 工作区照旧打开", () => {
  const home = mkdtempSync(join(tmpdir(), "kaitu-default-root-"));
  vi.stubEnv("HOME", home);
  vi.stubEnv("KAITU_DIR", "");
  vi.stubEnv("KAITU_LOCAL_STATE_DIR", join(home, "state"));
  try {
    expect(defaultRoot()).toBe(join(home, "kaitu-ai-memory"));
    // 搬去云盘后 ~/kaitu 只剩迁移说明，云盘没挂上时也不另建一份空的新默认目录。
    mkdirSync(join(home, "kaitu"));
    writeFileSync(join(home, "kaitu/WORKSPACE-MOVED.md"), "moved");
    expect(defaultRoot()).toBe(join(home, "kaitu"));
    mkdirSync(join(home, "kaitu/.kaitu"), { recursive: true });
    writeFileSync(join(home, "kaitu/.kaitu/config.json"), "{}");
    expect(defaultRoot()).toBe(join(home, "kaitu"));
  } finally {
    vi.unstubAllEnvs();
    rmSync(home, { recursive: true, force: true });
  }
});
