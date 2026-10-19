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
import { Context } from "@deepseek-ai/cordis";
import { FsError as BackendError } from "@deepseek-ai/dsh-fs";
import { LocalFileSystem } from "@deepseek-ai/dsh-fs-local";
import { initWorkspace, parseFrontmatter } from "@kaitu/core";
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
    async writeText(target: Target, text: string) {
      writeFileSync(target.targetKey, text);
    }
    async editText(target: Target, text: string) {
      return this.writeText(target, text);
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
    mkdirSync(join(root, "me"));
    writeFileSync(join(root, "me/goals.json"), "[]");
    for (const path of ["NOW.md", "me/goals.json"]) {
      const managed = await files.resolve(path);
      await expect(files.writeText(managed, "AI 决定")).rejects.toThrow();
      await expect(files.editText(managed, "AI 决定")).rejects.toThrow();
    }
    expect(readFileSync(join(root, "me/goals.json"), "utf8")).toBe("[]");
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

test("native SDK writes and literal edits retain user decisions and propose Agent changes", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "kaitu-sdk-status-")));
  const ctx = new Context();
  try {
    await initWorkspace(root);
    const files = new (confinedFileSystem(LocalFileSystem, BackendError, root))(ctx, {
      cwd: root,
      diffBasisMaxBytes: 1024 * 1024,
    });
    const initial =
      "---\nnext:\n  - id: user-step\n    title: User choice\n    status: done\n    by: user\n---\nOriginal body\n";
    for (const path of ["health/STATUS.md", "projects/example/STATUS.md"]) {
      const { mkdirSync } = await import("node:fs");
      mkdirSync(join(root, path, ".."), { recursive: true });
      writeFileSync(join(root, path), initial);
      const target = await files.resolve(path);
      const version = (await files.stat(target)).version;
      const content = initial.replace(
        "---\nOriginal",
        "  - id: agent-step\n    title: Agent idea\n    status: todo\n    by: user\n---\nOriginal",
      );
      await files.writeText(target, content, { kind: "replaceIfVersion", version });
      const next = () => parseFrontmatter(readFileSync(join(root, path), "utf8")).data.next;
      expect(next()).toMatchObject([
        { id: "user-step", status: "done", by: "user" },
        { id: "agent-step", status: "proposed", by: "agent" },
      ]);
      await files.editText(
        target,
        { oldString: "status: proposed", newString: "status: done" },
        {
          version: (await files.stat(target)).version,
        },
      );
      expect(next()).toMatchObject([
        { id: "user-step", status: "done", by: "user" },
        { id: "agent-step", status: "proposed", by: "agent" },
      ]);
      const saved = readFileSync(join(root, path), "utf8");
      await expect(
        files.writeText(target, initial, { kind: "replaceIfVersion", version }),
      ).rejects.toMatchObject({ code: "FS_STALE_VERSION" });
      await expect(
        files.editText(target, { oldString: "Original", newString: "Lost" }, { version }),
      ).rejects.toMatchObject({ code: "FS_STALE_VERSION" });
      const aborted = AbortSignal.abort();
      await expect(files.writeText(target, initial, undefined, aborted)).rejects.toThrow();
      await expect(
        files.editText(target, { oldString: "Original", newString: "Lost" }, undefined, aborted),
      ).rejects.toThrow();
      expect(readFileSync(join(root, path), "utf8")).toBe(saved);
    }
    const text = await files.resolve("health/plain.md");
    await files.writeText(text, "ordinary text", { kind: "createIfAbsent" });
    await files.editText(
      text,
      { oldString: "ordinary", newString: "edited" },
      {
        version: (await files.stat(text)).version,
      },
    );
    expect(readFileSync(join(root, "health/plain.md"), "utf8")).toBe("edited text");
  } finally {
    await ctx.fiber.dispose();
    rmSync(root, { recursive: true, force: true });
  }
});
