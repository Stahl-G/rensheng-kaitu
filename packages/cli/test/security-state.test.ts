import {
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  Workspace,
  historyDirectory,
  initWorkspace,
  readAgentFile,
  snapshot,
  stateDirectory,
} from "@kaitu/core";
import { expect, it } from "vitest";
// @ts-expect-error Desktop support modules run directly in Electron Node.
import { confinedFileSystem } from "../../desktop/sdk-filesystem.mjs";
// @ts-expect-error Desktop support modules run directly in Electron Node.
import { agentSearch } from "../../desktop/sdk-search.mjs";

it("scoped 文件入口拒绝程序状态及其别名，搜索不返回密钥，工作区配置不能重定向状态", async () => {
  const temp = realpathSync(mkdtempSync(join(tmpdir(), "kaitu-state-security-")));
  const root = join(temp, "workspace");
  type Target = { displayPath: string; targetKey: string };
  class FsError extends Error {
    constructor(
      message: string,
      public code: string,
    ) {
      super(message);
    }
  }
  class HostFiles {
    async resolve(path: string) {
      const displayPath = resolve(root, path);
      return { displayPath, targetKey: realpathSync(displayPath) };
    }
    async stat(target: Target) {
      return { directory: lstatSync(target.targetKey).isDirectory() };
    }
    async lstat(path: string) {
      return lstatSync(resolve(root, path));
    }
    async readText(target: Target) {
      return readFileSync(target.targetKey, "utf8");
    }
    async readBytes(target: Target) {
      return readFileSync(target.targetKey);
    }
    async readByteRange(target: Target) {
      return this.readBytes(target);
    }
    async streamText(target: Target) {
      return this.readText(target);
    }
    async watch(target: Target) {
      return this.stat(target);
    }
    async writeText(target: Target, text: string) {
      writeFileSync(target.targetKey, text);
    }
    async editText(target: Target, text: string) {
      return this.writeText(target, text);
    }
  }
  try {
    const ws = await initWorkspace(root);
    const secret = "synthetic-secret-6287";
    ws.writeJson(".kaitu/secrets.json", { token: secret }, { internal: true });
    ws.writeText("note.md", "synthetic-note");
    symlinkSync(join(root, ".kaitu"), join(root, "state-alias"));
    const files = new (confinedFileSystem(HostFiles, FsError, root))();
    const target = {
      displayPath: join(root, ".kaitu/secrets.json"),
      targetKey: join(root, ".kaitu/secrets.json"),
    };
    for (const method of [
      "readText",
      "streamText",
      "readBytes",
      "readByteRange",
      "watch",
      "stat",
      "writeText",
      "editText",
    ]) {
      await expect(files[method](target, "injected")).rejects.toMatchObject({ code: "FS_SANDBOX_DENIED" });
    }
    await expect(files.lstat(".kaitu/secrets.json")).rejects.toThrow();
    await expect(files.resolve("state-alias/secrets.json")).rejects.toThrow();
    expect(() => readAgentFile(ws, "state-alias/secrets.json")).toThrow();
    expect(
      (await files.listDir(await files.resolve("."))).map((entry: { name: string }) => entry.name),
    ).not.toContain(".kaitu");
    const names = await agentSearch(root, "glob", { pattern: "**/*" });
    expect(names.paths).toContain("note.md");
    expect(names.paths.some((path: string) => path.includes("secrets.json"))).toBe(false);
    const searched = await agentSearch(
      root,
      "grep",
      { pattern: ".*" },
      undefined,
      "synthetic-rg",
      async (_executable: string, args: string[]) => ({
        stdout: args
          .slice(args.indexOf("--") + 1)
          .map((file) =>
            JSON.stringify({
              type: "match",
              data: { path: { text: file }, line_number: 1, lines: { text: readFileSync(file, "utf8") } },
            }),
          )
          .join("\n"),
      }),
    );
    expect(JSON.stringify(searched)).not.toContain(secret);
    const note = await files.resolve("note.md");
    await files.editText(note, "updated-note");
    expect(await files.readText(note)).toBe("updated-note");
    expect(JSON.parse(readFileSync(target.targetKey, "utf8")).token).toBe(secret);
    const state = stateDirectory(root);
    const outside = join(temp, "injected-state");
    const config = ws.readJson<Record<string, unknown>>(".kaitu/config.json");
    writeFileSync(join(root, ".kaitu/config.json"), JSON.stringify({ ...config, state_dir: outside }));
    const reopened = new Workspace(root);
    await snapshot(reopened, "synthetic-state-verification");
    expect(stateDirectory(root)).toBe(state);
    expect(historyDirectory(reopened)).toBe(join(state, "history.git"));
    expect(existsSync(outside)).toBe(false);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
