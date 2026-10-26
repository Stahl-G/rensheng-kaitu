import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { confinedFileSystem } from "./sdk-filesystem.mjs";
import { agentSearch } from "./sdk-search.mjs";

const resolveModule = createRequire(join(process.env.KAITU_DSH_MODULES, "package.json")).resolve;
const load = (name) => import(pathToFileURL(resolveModule(name)).href);
const [{ LocalFileSystem }, { FsError }] = await Promise.all([
  load("@deepseek-ai/dsh-fs-local"),
  load("@deepseek-ai/dsh-fs"),
]);
// Keep the selected spelling used by session cwd; the filesystem policy also checks real paths.
const root = resolve(process.env.KAITU_DIR);
const connection = process.env.KAITU_AGENT_CONNECTION === "phone-ask" ? "phone-ask" : "local-ask";
export const name = "kaitu-sdk-host";
export const inject = ["loader", "tools"];
export async function apply(ctx) {
  const attachments = new Set();
  ctx.provide("kaituAttachmentPaths", attachments);
  await ctx.plugin(
    confinedFileSystem(LocalFileSystem, FsError, root, attachments, ctx.get("attachments")?.root, connection),
    { cwd: root },
  );
  ctx.inject(["fs"], (services) => {
    services.on("tools/execute", async (exec, next) => {
      // 只收发文字的一次性对话（例如方向页的看法）：任何工具都在执行前拒绝。
      if (process.env.KAITU_AGENT_TOOLS === "none")
        throw new FsError("这次对话只收发文字，开图不执行任何工具", "FS_SANDBOX_DENIED");
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
          undefined,
          connection,
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
