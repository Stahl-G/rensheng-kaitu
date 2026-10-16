import { realpathSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import { pathToFileURL } from "node:url";

const load = (name) => import(pathToFileURL(join(process.env.KAITU_DSH_MODULES, name, "lib/index.js")).href);
const [{ SandboxProvider }, { LocalFileSystem }, { FsError }] = await Promise.all([
  load("@deepseek-ai/dsh-sandbox"),
  load("@deepseek-ai/dsh-fs-local"),
  load("@deepseek-ai/dsh-fs"),
]);
const root = realpathSync(process.env.KAITU_DIR);
const contains = (path) => {
  const value = relative(root, path);
  return value === "" || (!isAbsolute(value) && value !== ".." && !value.startsWith("../"));
};
class KaituSandbox extends SandboxProvider {
  async confine(argv, _policy, signal) {
    signal?.throwIfAborted();
    if (process.platform !== "darwin") throw new Error("开图资料沙箱需要 macOS");
    const profile = [
      "(version 1)",
      "(allow default)",
      "(deny file-write*)",
      `(allow file-write* (literal "/dev/null") (subpath ${JSON.stringify(root)}))`,
    ].join(" ");
    return {
      argv: ["/usr/bin/sandbox-exec", "-p", profile, "--", ...argv],
      enforcement: "full",
      denialSignatures: ["operation not permitted", "permission denied"],
      runnerFailureRules: [
        { fatalSignatures: ["sandbox-exec: sandbox_init:", "sandbox-exec: invalid profile"] },
      ],
    };
  }
}
class KaituFileSystem extends LocalFileSystem {
  get sandboxMode() {
    return "workspace-write";
  }
  async checked(target) {
    const fresh = await this.resolve(target.displayPath);
    if (!contains(fresh.targetKey)) throw new FsError("只能修改开图资料", "FS_SANDBOX_DENIED");
    return fresh;
  }
  async writeText(target, ...args) {
    return super.writeText(await this.checked(target), ...args);
  }
  async editText(target, ...args) {
    return super.editText(await this.checked(target), ...args);
  }
}
export const name = "kaitu-sdk-host";
export const inject = ["loader"];
export async function apply(ctx) {
  await ctx.plugin(KaituSandbox);
  await ctx.plugin(KaituFileSystem, { cwd: root });
}
