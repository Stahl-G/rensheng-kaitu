import {
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, test } from "vitest";
// @ts-expect-error Desktop support modules run directly in Electron Node.
import { confinedFileSystem } from "../../desktop/sdk-filesystem.mjs";

test("Ask file reads reject outside paths and symlinks, including a replaced resolved target", async () => {
  const temp = realpathSync(mkdtempSync(join(tmpdir(), "kaitu-ask-fs-")));
  class FsError extends Error {
    constructor(
      message: string,
      public code: string,
    ) {
      super(message);
    }
  }
  type Target = { displayPath: string; targetKey: string };
  class HostFiles {
    async resolve(path: string) {
      const displayPath = resolve(join(temp, "workspace"), path);
      return { displayPath, targetKey: realpathSync(displayPath) };
    }
    async readText(target: Target) {
      return readFileSync(target.targetKey, "utf8");
    }
  }
  try {
    const { mkdirSync } = await import("node:fs");
    const root = join(temp, "workspace");
    mkdirSync(root);
    const outside = join(temp, "outside.txt");
    writeFileSync(outside, "synthetic private data");
    writeFileSync(join(root, "NOW.md"), "synthetic Kaitu data");
    symlinkSync(outside, join(root, "link"));
    const files = new (confinedFileSystem(HostFiles, FsError, root))();
    expect(await files.readText(await files.resolve("NOW.md"))).toBe("synthetic Kaitu data");
    await expect(files.resolve(outside)).rejects.toMatchObject({ code: "FS_SANDBOX_DENIED" });
    await expect(files.resolve("../outside.txt")).rejects.toMatchObject({ code: "FS_SANDBOX_DENIED" });
    await expect(files.resolve("link")).rejects.toMatchObject({ code: "FS_SANDBOX_DENIED" });
    const target = await files.resolve("NOW.md");
    unlinkSync(join(root, "NOW.md"));
    symlinkSync(outside, join(root, "NOW.md"));
    await expect(files.readText(target)).rejects.toMatchObject({ code: "FS_SANDBOX_DENIED" });
    await expect(files.readText({ displayPath: outside, targetKey: outside })).rejects.toMatchObject({
      code: "FS_SANDBOX_DENIED",
    });
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
