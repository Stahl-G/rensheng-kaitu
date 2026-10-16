import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
const sdk = process.argv[2];
if (!sdk) throw new Error("用法：node scripts/security-sdk-smoke.mjs <已构建的 SDK 源码根目录>");
const temp = realpathSync(mkdtempSync(join(tmpdir(), "kaitu-sdk-security-")));
process.env.HOME = join(temp, "home");
process.env.KAITU_APP_HOME = join(temp, "app");
process.env.DSH_HOME = join(temp, "dsh");
process.env.DSH_AGENTS_HOME = join(temp, "agents");
process.env.KAITU_LOCAL_STATE_DIR = join(temp, "state");
const root = join(temp, "workspace");
mkdirSync(join(root, ".kaitu"), { recursive: true });
writeFileSync(join(root, ".kaitu/secrets.json"), '{"token":"synthetic-private-812"}');
writeFileSync(join(root, "note.md"), "synthetic-public-491");
symlinkSync(join(root, ".kaitu"), join(root, "program-alias"));
const require = createRequire(join(sdk, "packages/fs/fs-local/package.json"));
const { Context } = await import(pathToFileURL(require.resolve("@deepseek-ai/cordis")).href);
const { FsError } = await import(pathToFileURL(require.resolve("@deepseek-ai/dsh-fs")).href);
const { LocalFileSystem } = await import(pathToFileURL(join(sdk, "packages/fs/fs-local/lib/index.js")).href);
const { confinedFileSystem } = await import("../packages/desktop/sdk-filesystem.mjs");
const { agentSearch } = await import("../packages/desktop/sdk-search.mjs");
try {
  const ctx = new Context();
  const files = new (confinedFileSystem(LocalFileSystem, FsError, root))(ctx, {
    cwd: root,
    diffBasisMaxBytes: 1048576,
  });
  const note = await files.resolve("note.md");
  assert.equal(await files.readText(note), "synthetic-public-491");
  await files.writeText(note, "synthetic-public-492");
  assert.equal(await files.readText(note), "synthetic-public-492");
  for (const path of [".kaitu/secrets.json", "program-alias/secrets.json", "../outside"])
    await assert.rejects(() => files.resolve(path));
  const secret = {
    displayPath: join(root, ".kaitu/secrets.json"),
    targetKey: join(root, ".kaitu/secrets.json"),
  };
  for (const method of [
    "readText",
    "readBytes",
    "readByteRange",
    "streamText",
    "stat",
    "writeText",
    "editText",
  ])
    await assert.rejects(() => files[method](secret, undefined, 4096));
  assert(!(await files.listDir(await files.resolve("."))).some((entry) => entry.name === ".kaitu"));
  const grep = await agentSearch(
    root,
    "grep",
    { pattern: "synthetic" },
    undefined,
    createRequire(join(sdk, "packages/fs/tool-fs-search/package.json"))("@vscode/ripgrep").rgPath,
  );
  assert(JSON.stringify(grep).includes("synthetic-public-492"));
  assert(!JSON.stringify(grep).includes("synthetic-private-812"));
  const skillRoot = join(root, ".agents/skills");
  mkdirSync(join(skillRoot, "normal"), { recursive: true });
  writeFileSync(
    join(skillRoot, "normal/SKILL.md"),
    "---\nname: normal\ndescription: synthetic skill\n---\nSynthetic skill body",
  );
  writeFileSync(join(skillRoot, "normal/reference.md"), "synthetic-reference");
  symlinkSync(join(root, ".kaitu"), join(skillRoot, "alias"));
  const { FileSystemSkillProvider } = await import(
    pathToFileURL(join(sdk, "packages/skill/skill-filesystem/lib/index.js")).href
  );
  const provider = new FileSystemSkillProvider(
    ctx,
    { signal: new AbortController().signal, invalidate() {} },
    { includeDefaultRoots: false, customSkillDirs: [skillRoot], watch: false },
  );
  const observation = await provider.list({ cwd: root });
  const candidates = Array.isArray(observation) ? observation : observation.candidates;
  assert.equal(candidates.length, 1);
  const definition = await provider.get(candidates[0], { cwd: root });
  assert(definition.content.includes("Synthetic skill body"));
  assert.equal(
    await ctx.fs.readText(await ctx.fs.resolve(join(definition.resourceBase.path, "reference.md"))),
    "synthetic-reference",
  );
  await provider.dispose();
  console.log(
    JSON.stringify({
      sdk: JSON.parse(readFileSync(join(sdk, "packages/fs/fs-local/package.json"), "utf8")).version,
      noteReadWrite: true,
      protectedPathsDenied: true,
      rgExcludesSecrets: true,
      realSkillProvider: true,
      skillReferences: true,
    }),
  );
} finally {
  rmSync(temp, { recursive: true, force: true });
}
