// 使用已构建 CLI engine worker 与桌面同布局入口，验证 worker URL 在 bundle 中可寻址。
import fs from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
const project = resolve(import.meta.dirname, "../../..");
const temporary = fs.mkdtempSync(join(tmpdir(), "kaitu-worker-bundle-"));
process.env.KAITU_LOCAL_STATE_DIR = join(temporary, "state");
process.env.KAITU_APP_HOME = join(temporary, "app");
const { build } = createRequire(join(project, "packages/dsh-plugin/package.json"))("esbuild");
const core = await import(pathToFileURL(join(project, "packages/core/dist/index.js")));
try {
  const ws = await core.initWorkspace(join(temporary, "workspace"));
  const folder = join(ws.root, "chats/2026/10");
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(
    join(folder, "only.jsonl"),
    [
      {
        type: "chat",
        id: "bundled",
        title: "bundled",
        source: "synthetic",
        created: "2026-10-19T00:00:00Z",
        updated: "2026-10-19T00:00:00Z",
      },
      { type: "message", id: "m1", role: "user", ts: null, text: "bundle-needle" },
    ]
      .map((row) => JSON.stringify(row))
      .join("\n"),
  );
  const payload = join(temporary, "payload");
  fs.mkdirSync(join(payload, "dist"), { recursive: true });
  for (const name of ["schemas", "templates"])
    fs.cpSync(join(project, name), join(payload, name), { recursive: true });
  fs.cpSync(join(project, "packages/cli/dist/engine/data-worker.mjs"), join(payload, "dist/data-worker.mjs"));
  await build({
    stdin: {
      contents: `export { runDataWorker } from ${JSON.stringify(join(project, "packages/core/src/data-worker.ts"))};`,
      resolveDir: project,
    },
    outfile: join(payload, "dist/launcher.mjs"),
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
  });
  const { runDataWorker } = await import(pathToFileURL(join(payload, "dist/launcher.mjs")));
  const found = await runDataWorker(ws, "search", { query: "bundle-needle", options: {} });
  if (found.length !== 1 || found[0].id !== "bundled") throw new Error("Bundled search incomplete");
  const zipPath = join(temporary, "bundled.zip");
  const zip = await runDataWorker(ws, "export", { output: zipPath });
  if (!zip.bytes || !zip.name.endsWith(".zip")) throw new Error("Bundled export missing");
  console.log(
    JSON.stringify(
      {
        worker: "CLI build-engine output in desktop dist/data-worker.mjs layout",
        bundledSearchResult: found[0].id,
        bundledExport: zip.name,
        zipBytes: zip.bytes,
        status: "passed",
      },
      null,
      2,
    ),
  );
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
