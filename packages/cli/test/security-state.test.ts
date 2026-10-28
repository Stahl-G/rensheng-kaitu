import { randomUUID } from "node:crypto";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  Workspace,
  addMemory,
  addRecord,
  agentConnections,
  enableDrive,
  exportWorkspace,
  historyDirectory,
  initWorkspace,
  localStateRoot,
  publicRecords,
  readAgentFile,
  readRecords,
  setFinanceAccess,
  snapshot,
  stateDirectory,
} from "@kaitu/core";
import { expect, it } from "vitest";
const { unzipSync } = createRequire(new URL("../../core/package.json", import.meta.url))("fflate");
// @ts-expect-error Desktop support modules run directly in Electron Node.
import { desktopPaths } from "../../desktop/environment.mjs";
// @ts-expect-error Desktop support modules run directly in Electron Node.
import { confinedFileSystem } from "../../desktop/sdk-filesystem.mjs";
// @ts-expect-error Desktop support modules run directly in Electron Node.
import { agentSearch } from "../../desktop/sdk-search.mjs";

it("人用混合快照保留财务，但 Agent 全文读取与 grep 不返回快照或别名", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "kaitu-phone-private-")));
  try {
    const ws = await initWorkspace(root);
    const secret = "SYNTHETIC_PRIVATE_ATLAS_FINANCE";
    for (const name of ["life-atlas", "library"]) {
      ws.writeJson(`phone/${name}.json`, {
        format: `kaitu.phone.${name}`,
        domains: [{ id: "finance", title: secret }],
      });
      symlinkSync(ws.resolve(`phone/${name}.json`), join(root, `${name}-alias.json`));
      expect(ws.readText(`phone/${name}.json`)).toContain(secret);
    }
    ws.writeText("public.md", "Synthetic public source");
    for (const connection of ["remote-mcp", "local-ask"] as const) {
      setFinanceAccess(ws, connection, true);
      for (const path of [
        "phone/life-atlas.json",
        "phone/library.json",
        "life-atlas-alias.json",
        "library-alias.json",
      ])
        expect(() => readAgentFile(ws, path, connection)).toThrow();
      const result = await agentSearch(
        root,
        "grep",
        { pattern: ".*" },
        undefined,
        "synthetic-rg",
        async (_executable: string, args: string[]) => ({
          stdout: args
            .slice(args.indexOf("--") + 1)
            .map((file) => {
              expect(file).not.toMatch(/(?:life-atlas|library)(?:-alias)?\.json$/);
              return JSON.stringify({
                type: "match",
                data: { path: { text: file }, line_number: 1, lines: { text: readFileSync(file, "utf8") } },
              });
            })
            .join("\n"),
        }),
        connection,
      );
      expect(JSON.stringify(result)).not.toContain(secret);
      expect(result.matches.some((row: { path: string }) => row.path === "public.md")).toBe(true);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it("财务模块改目录后，文件、别名、搜索和记录投影仍遵循各连接开关", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "kaitu-renamed-finance-")));
  try {
    const ws = await initWorkspace(root);
    addRecord(ws, "finance_account", {
      name: "Synthetic wallet",
      kind: "wallet",
      source: "manual",
      currency: "CNY",
    });
    const rows = readRecords(ws, "finance_account");
    renameSync(ws.resolve("finance"), ws.resolve("ledger"));
    symlinkSync(ws.resolve("ledger/STATUS.md"), join(root, "ledger-alias.md"));
    expect(() => readAgentFile(ws, "ledger/STATUS.md", "remote-mcp")).toThrow();
    expect(publicRecords(ws, "finance_account", rows)).toEqual([]);
    for (const connection of agentConnections) {
      for (const allowed of [false, true]) {
        setFinanceAccess(ws, connection, allowed);
        for (const path of ["ledger/STATUS.md", "ledger-alias.md"]) {
          if (allowed) expect(readAgentFile(ws, path, connection)).toBe(ws.readText("ledger/STATUS.md"));
          else expect(() => readAgentFile(ws, path, connection)).toThrow();
        }
        expect(publicRecords(ws, "finance_account", rows, connection)).toEqual(allowed ? rows : []);
        const names = await agentSearch(
          root,
          "glob",
          { pattern: "**/*" },
          undefined,
          undefined,
          undefined,
          connection,
        );
        expect(names.paths.includes("ledger/STATUS.md")).toBe(allowed);
      }
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

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
    ws.writeJson(".kaitu/secrets.json", { token: secret }, { internal: true, mode: 0o600 });
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
    await expect(agentSearch(root, "grep", { path: "state-alias", pattern: ".*" })).rejects.toThrow();
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
    const appHome = process.env.KAITU_APP_HOME;
    process.env.KAITU_APP_HOME = join(root, "program");
    ws.writeText("program/credential.txt", secret);
    try {
      const entries = unzipSync(Buffer.from(exportWorkspace(ws).base64, "base64")) as Record<
        string,
        Uint8Array
      >;
      const contents = Object.values(entries)
        .map((bytes) => Buffer.from(bytes).toString("utf8"))
        .join("\n");
      expect(contents).not.toContain(secret);
      expect(contents).toContain("updated-note");
      await expect(files.resolve("program/credential.txt")).rejects.toThrow();
      const names = await agentSearch(root, "glob", { pattern: "**/*" });
      expect(names.paths.some((name: string) => name.startsWith("program/"))).toBe(false);
    } finally {
      if (appHome === undefined) Reflect.deleteProperty(process.env, "KAITU_APP_HOME");
      else process.env.KAITU_APP_HOME = appHome;
    }
    expect(() => desktopPaths({ KAITU_DIR: root, KAITU_APP_HOME: join(root, "program") })).toThrow();
    const memory = await addMemory(ws, {
      type: "fact",
      name: "Private",
      text: "Synthetic private memory",
      sensitive: true,
    });
    for (const allowed of [false, true]) {
      setFinanceAccess(ws, "local-ask", allowed);
      const names = await agentSearch(root, "glob", { pattern: "**/*" });
      expect(names.paths.includes(`memory/${memory.file}`)).toBe(false);
      expect(names.paths.includes("finance/STATUS.md")).toBe(allowed);
      await agentSearch(
        root,
        "grep",
        { pattern: "Synthetic" },
        undefined,
        "synthetic-rg",
        async (_executable: string, args: string[]) => {
          expect(args.join(" ")).not.toContain(memory.file);
          expect(args.join(" ")).not.toContain("memory/MEMORY.md");
          if (!allowed) expect(args.some((arg) => /[/\\]finance[/\\]/.test(arg))).toBe(false);
          return { stdout: "" };
        },
      );
    }
    ws.writeText(
      ".agents/skills/normal/SKILL.md",
      "---\nname: normal\ndescription: synthetic\n---\nSynthetic skill",
    );
    symlinkSync(join(root, ".kaitu"), join(root, ".agents/skills/alias"));
    expect(await files.readText(await files.resolve(".agents/skills/normal/SKILL.md"))).toContain(
      "Synthetic skill",
    );
    await expect(files.resolve(".agents/skills/alias/secrets.json")).rejects.toThrow();
    const drive = join(temp, "drive");
    mkdirSync(drive);
    await enableDrive(reopened, { driveDir: drive });
    const external = stateDirectory(reopened.root);
    const cloudConfig = reopened.readJson<Record<string, unknown>>(".kaitu/config.json");
    Reflect.deleteProperty(cloudConfig, "state_dir");
    reopened.writeJson(".kaitu/config.json", cloudConfig, { internal: true });
    expect(stateDirectory(new Workspace(reopened.root).root)).toBe(external);
    const foreign = join(localStateRoot(), "foreign-synthetic");
    mkdirSync(foreign);
    writeFileSync(join(foreign, "secrets.json"), "foreign-original");
    renameSync(external, `${external}.saved`);
    symlinkSync(foreign, external);
    expect(() => new Workspace(reopened.root)).toThrow();
    expect(readFileSync(join(foreign, "secrets.json"), "utf8")).toBe("foreign-original");
    rmSync(external);
    renameSync(`${external}.saved`, external);
    const other = join(temp, "other");
    mkdirSync(join(other, ".kaitu"), { recursive: true });
    writeFileSync(join(other, ".kaitu/config.json"), JSON.stringify({ ...cloudConfig, state_dir: external }));
    expect(() => new Workspace(other)).toThrow();
    const legacy = join(localStateRoot(), randomUUID());
    mkdirSync(legacy);
    writeFileSync(join(legacy, "secrets.json"), JSON.stringify({ token: "synthetic-legacy-secret" }), {
      mode: 0o600,
    });
    const legacyRoot = join(temp, "legacy-workspace");
    mkdirSync(join(legacyRoot, ".kaitu"), { recursive: true });
    cpSync(join(reopened.root, "me"), join(legacyRoot, "me"), { recursive: true });
    writeFileSync(
      join(legacyRoot, ".kaitu/config.json"),
      JSON.stringify({ ...cloudConfig, state_dir: legacy }),
    );
    const legacyWorkspace = new Workspace(legacyRoot);
    expect(legacyWorkspace.readJson<{ token: string }>(".kaitu/secrets.json").token).toBe(
      "synthetic-legacy-secret",
    );
    expect(stateDirectory(legacyRoot)).toBe(legacy);
    const cloud = join(process.env.HOME as string, "Library/CloudStorage/GoogleDrive-synthetic/kaitu");
    mkdirSync(join(cloud, ".kaitu"), { recursive: true });
    cpSync(join(reopened.root, "me"), join(cloud, "me"), { recursive: true });
    writeFileSync(join(cloud, ".kaitu/config.json"), JSON.stringify(cloudConfig));
    writeFileSync(join(cloud, ".kaitu/secrets.json"), JSON.stringify({ token: secret }));
    const migrated = new Workspace(cloud, { maintain: false });
    new Workspace(cloud);
    expect(stateDirectory(migrated.root)).not.toBe(join(cloud, ".kaitu"));
    expect(migrated.readJson<{ token: string }>(".kaitu/secrets.json").token).toBe(secret);
    expect(existsSync(join(cloud, ".kaitu/secrets.json"))).toBe(false);
  } finally {
    rmSync(join(process.env.HOME as string, "Library/CloudStorage/GoogleDrive-synthetic"), {
      recursive: true,
      force: true,
    });
    rmSync(temp, { recursive: true, force: true });
  }
});
