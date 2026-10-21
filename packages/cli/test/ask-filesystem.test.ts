import { execFileSync } from "node:child_process";
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
import { addMemory, initWorkspace, parseFrontmatter, setFinanceAccess } from "@kaitu/core";
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
    writeFileSync(join(root, "RECORDS.md"), "synthetic managed instructions");
    symlinkSync(outside, join(root, "link"));
    const files = new (confinedFileSystem(HostFiles, FsError, root))();
    expect(await files.readText(await files.resolve("NOW.md"))).toBe("synthetic Kaitu data");
    await expect(files.resolve(outside)).rejects.toMatchObject({ code: "FS_SANDBOX_DENIED" });
    await expect(files.resolve("../outside.txt")).rejects.toMatchObject({ code: "FS_SANDBOX_DENIED" });
    await expect(files.resolve("link")).rejects.toMatchObject({ code: "FS_SANDBOX_DENIED" });
    mkdirSync(join(root, "me"));
    writeFileSync(join(root, "me/goals.json"), "[]");
    for (const path of ["NOW.md", "RECORDS.md", "me/goals.json"]) {
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
  const temp = mkdtempSync(join(tmpdir(), "kaitu SDK status "));
  // Hosted Windows runners can expose TEMP through an 8.3 alias (RUNNER~1).
  const root = realpathSync(
    process.platform === "win32"
      ? execFileSync("cmd.exe", ["/d", "/c", `for %I in ("${temp}") do @echo %~sI`], {
          encoding: "utf8",
          windowsVerbatimArguments: true,
        }).trim()
      : temp,
  );
  const ctx = new Context();
  const contexts = [ctx];
  try {
    const ws = await initWorkspace(root);
    const files = new (confinedFileSystem(LocalFileSystem, BackendError, root))(ctx, {
      cwd: root,
      diffBasisMaxBytes: 1024 * 1024,
    });
    for (const path of ["../outside.md", ".kaitu/secrets.json", ".git/config"]) {
      await expect(files.resolve(path)).rejects.toMatchObject({ code: "FS_SANDBOX_DENIED" });
    }
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
    const open = await addMemory(ws, { type: "fact", name: "Open", text: "Synthetic open memory" });
    const secret = await addMemory(ws, {
      type: "fact",
      name: "Secret",
      text: "Synthetic private memory",
      sensitive: true,
    });
    for (const connection of ["local-ask", "phone-ask"] as const) {
      const readerContext = new Context();
      contexts.push(readerContext);
      const reader = new (confinedFileSystem(
        LocalFileSystem,
        BackendError,
        root,
        new Set(),
        undefined,
        connection,
      ))(readerContext, { cwd: root, diffBasisMaxBytes: 1024 * 1024 });
      await expect(reader.resolve(`memory/${secret.file}`)).rejects.toThrow();
      expect(await reader.readText(await reader.resolve(`memory/${open.file}`))).toContain(
        "Synthetic open memory",
      );
      const index = await reader.resolve("memory/MEMORY.md");
      expect(await reader.readText(index)).not.toContain("Synthetic private memory");
      expect(Buffer.from(await reader.readBytes(index, undefined, 100000)).toString()).not.toContain(
        "Synthetic private memory",
      );
      expect(
        Buffer.from(await reader.readByteRange(index, { offset: 0, length: 100000 })).toString(),
      ).not.toContain("Synthetic private memory");
      let text = "";
      for await (const chunk of await reader.streamText(index)) text += chunk;
      expect(text).toContain("Synthetic open memory");
      expect(text).not.toContain("Synthetic private memory");
      for (const allowed of [false, true]) {
        setFinanceAccess(ws, connection, allowed);
        if (allowed) expect(await reader.resolve("finance/STATUS.md")).toBeDefined();
        else await expect(reader.resolve("finance/STATUS.md")).rejects.toThrow();
      }
    }
  } finally {
    for (const context of contexts) await context.fiber.dispose();
    rmSync(root, { recursive: true, force: true });
  }
});
