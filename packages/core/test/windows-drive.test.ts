import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { findWindowsDriveDirectory } from "../src/drive.js";
import { folderProvider } from "../src/sync-location.js";

it("Windows 挂载盘识别中文和英文 Drive，多个账号交给用户选择", () => {
  const root = mkdtempSync(join(tmpdir(), "kaitu-drive-mount-"));
  try {
    const chinese = join(root, "G", "我的云端硬盘");
    mkdirSync(chinese, { recursive: true });
    expect(findWindowsDriveDirectory([join(root, "G"), join(root, "H")])).toBe(chinese);
    expect(folderProvider("G:\\我的云端硬盘\\kaitu")).toBe("google-drive");
    const english = join(root, "H", "My Drive");
    mkdirSync(english, { recursive: true });
    expect(findWindowsDriveDirectory([join(root, "H")])).toBe(english);
    expect(() => findWindowsDriveDirectory([join(root, "G"), join(root, "H")])).toThrow();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
