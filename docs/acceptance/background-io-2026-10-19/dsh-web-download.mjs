// 实际已安装的 Cordis + dsh-host-webserver + 构建后的 Kaitu service，无 HTTP 服务替身。
import fs from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
const project = resolve(import.meta.dirname, "../../..");
const temporary = fs.mkdtempSync(join(tmpdir(), "kaitu-dsh-download-"));
process.env.KAITU_LOCAL_STATE_DIR = join(temporary, "state");
process.env.KAITU_APP_HOME = join(temporary, "app");
const requirePlugin = createRequire(join(project, "packages/dsh-plugin/package.json"));
const { Context } = await import(pathToFileURL(requirePlugin.resolve("@deepseek-ai/cordis")));
const installed = fs
  .readdirSync(join(project, "node_modules/.pnpm"))
  .find((name) => name.startsWith("@deepseek-ai+dsh-host-webserver@0.2.1-rc.2_"));
if (!installed) throw new Error("The locked dsh-host-webserver dependency is not installed");
const { default: WebServer } = await import(
  pathToFileURL(
    join(
      project,
      "node_modules/.pnpm",
      installed,
      "node_modules/@deepseek-ai/dsh-host-webserver/lib/index.js",
    ),
  )
);
const core = await import(pathToFileURL(join(project, "packages/core/dist/index.js")));
const { KaituOverviewService } = await import(
  pathToFileURL(join(project, "packages/dsh-plugin/dist/index.js"))
);
const ctx = new Context();
try {
  const fork = ctx.plugin(WebServer, { host: "127.0.0.1", port: 0, compression: "gzip" });
  await fork.await();
  const web = ctx.get("webServer");
  const ws = await core.initWorkspace(join(temporary, "workspace"));
  const service = new KaituOverviewService(ctx, {}, ws);
  await service.exportWorkspaceRequest("start");
  let state;
  for (let i = 0; i < 1000; i++) {
    state = await service.exportWorkspaceRequest("status");
    if (state.status !== "running") break;
    await delay(20);
  }
  if (state.status !== "ready") throw new Error("Export did not complete");
  const result = await service.exportWorkspaceRequest("result");
  if (!result.file.url.startsWith("/kaitu-export-")) throw new Error("Web service returned a loopback URL");
  const response = await fetch(new URL(result.file.url, web.getOrigin()));
  const data = Buffer.from(await response.arrayBuffer());
  if (response.status !== 200 || data.readUInt32LE(0) !== 0x04034b50 || !data.includes(Buffer.from("NOW.md")))
    throw new Error("Web route did not deliver ZIP");
  for (let i = 0; i < 1000 && (await service.exportWorkspaceRequest("status")).status !== "idle"; i++)
    await delay(20);
  if (fs.readdirSync(join(temporary, "state/exports")).length) throw new Error("Web download leaked output");
  console.log(
    JSON.stringify(
      {
        actualHostWebServer: "0.2.1-rc.2",
        compressionConfiguration: "gzip",
        sameOriginPath: true,
        status: response.status,
        contentType: response.headers.get("content-type"),
        zipBytes: data.length,
        managedDirectoriesRemaining: 0,
        outcome: "passed",
      },
      null,
      2,
    ),
  );
} finally {
  await ctx.fiber.dispose();
  fs.rmSync(temporary, { recursive: true, force: true });
}
