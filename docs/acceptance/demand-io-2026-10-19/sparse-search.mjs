import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const project = resolve(import.meta.dirname, "../../..");
const temp = mkdtempSync(join(tmpdir(), "kaitu-sparse-search-"));
process.env.KAITU_LOCAL_STATE_DIR = join(temp, "state");
process.env.KAITU_APP_HOME = join(temp, "app");
const { agentSearch } = await import(`${project}/packages/desktop/sdk-search.mjs`);
const rg = createRequire(join(project, "packages/cli/package.json"))("@vscode/ripgrep").rgPath;
const root = join(temp, "workspace");
mkdirSync(root);
try {
  for (let i = 0; i < 11000; i++) writeFileSync(join(root, `${String(i).padStart(5, "0")}.txt`), "blank\n");
  const names = readdirSync(root);
  writeFileSync(join(root, names[100]), "needle\n");
  writeFileSync(join(root, names[10500]), "needle\n");
  const sparse = await agentSearch(root, "grep", { pattern: "needle" }, AbortSignal.timeout(30000), rg);
  assert.equal(sparse.truncated, true);
  assert.equal(sparse.scannedFiles, 10000);
  assert.equal(sparse.matches.length, 1);
  assert.equal(sparse.matches[0].path, names[100]);
  const empty = await agentSearch(root, "grep", { pattern: "not-present" }, AbortSignal.timeout(30000), rg);
  assert.equal(empty.truncated, true);
  assert.equal(empty.matches.length, 0);
  console.log(JSON.stringify({ files: names.length, sparse, empty }, null, 2));
} finally {
  rmSync(temp, { recursive: true, force: true });
}
