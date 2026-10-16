import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { confinedFileSystem } from "./sdk-filesystem.mjs";
import { agentSearch } from "./sdk-search.mjs";

const load = (name) => import(pathToFileURL(join(process.env.KAITU_DSH_MODULES, name, "lib/index.js")).href);
const [{ LocalFileSystem }, { FsError }] = await Promise.all([
  load("@deepseek-ai/dsh-fs-local"),
  load("@deepseek-ai/dsh-fs"),
]);
const root = realpathSync(process.env.KAITU_DIR);
export const name = "kaitu-sdk-host";
export const inject = ["loader", "tools"];
export async function apply(ctx) {
  await ctx.plugin(confinedFileSystem(LocalFileSystem, FsError, root), { cwd: root });
  ctx.inject(["fs"], (services) => {
    services.on("tools/execute", async (exec, next) => {
      if (exec.name === "glob" || exec.name === "grep") {
        const args = exec.arguments ?? {};
        const target = await services.fs.resolve(args.path ?? ".", {
          cwd: exec.agent?.session.header.cwd ?? root,
          signal: exec.signal,
        });
        const require = createRequire(join(process.env.KAITU_DSH_MODULES, "package.json"));
        const executable =
          exec.name === "grep"
            ? require("@vscode/ripgrep").rgPath.replace(/\.asar(?=[\\/])/u, ".asar.unpacked")
            : undefined;
        const value = await agentSearch(
          root,
          exec.name,
          { ...args, path: target.targetKey },
          exec.signal,
          executable,
        );
        return { isError: false, value, content: [{ type: "text", text: JSON.stringify(value) }] };
      }
      const args = exec.arguments;
      if (exec.name === "kaitu_import" || (exec.name === "kaitu_photos" && args?.operation === "add")) {
        await services.fs.resolve(args.path);
      }
      if (
        (exec.name === "kaitu_projects" && ["link", "linked-read", "sync"].includes(args?.operation)) ||
        (exec.name === "kaitu_drive" && args?.operation !== "status")
      )
        throw new FsError("问问只能访问当前开图资料", "FS_SANDBOX_DENIED");
      return next();
    });
  });
}
