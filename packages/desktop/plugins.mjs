import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/** 开图的插件目录（DSH 插件市场索引格式 1）。 */
export const KAITU_PLUGIN_INDEX = "https://kaitu.si/plugins/index.json";
// 后台 AI（DSH 窗口）和问问用不同的 DSH profile，插件两边都装，页面和工具才都能用。
const PROFILES = ["desktop", "sdk"];

/**
 * 插件 = DSH bundle。安装、删除交给 DSH 自带的 `dsh plugin`（在 profile 目录里跑 pnpm 并登记 bundle），
 * pnpm 和 node 用 App 自带的运行时，不依赖用户电脑上装没装。
 */
export function createPluginService({ executable, archive, runtime, home, onChanged }) {
  const modules = join(archive, "dsh/node_modules");
  const bin = join(home, "bin");
  const pnpm = join(bin, "pnpm");
  if (!existsSync(pnpm)) {
    mkdirSync(bin, { recursive: true });
    writeFileSync(
      pnpm,
      `#!/bin/sh\nexec "${join(runtime, "node/bin/node")}" "${join(runtime, "pnpm/bin/pnpm.cjs")}" "$@"\n`,
    );
    chmodSync(pnpm, 0o755);
  }
  const dsh = (profile, args) =>
    new Promise((resolve, reject) => {
      const child = spawn(
        executable,
        [join(modules, "@deepseek-ai/dsh/lib/bin.js"), "plugin", "--profile", profile, ...args],
        {
          env: {
            ...process.env,
            ELECTRON_RUN_AS_NODE: "1",
            DSH_HOME: home,
            PATH: `${bin}:/usr/bin:/bin:/usr/sbin:/sbin`,
          },
          stdio: ["ignore", "ignore", "pipe"],
        },
      );
      let output = "";
      child.stderr.on("data", (chunk) => {
        output += chunk;
      });
      child.once("error", reject);
      child.once("exit", (code) => {
        if (code === 0) resolve();
        else {
          const reason = output
            .split("\n")
            .find((line) => line.startsWith("dsh: ") && !line.includes("initialized"));
          reject(new Error(reason?.replace(/^dsh: /, "") ?? "插件安装没有完成"));
        }
      });
    });
  const installed = () => {
    const file = join(home, "profiles", "desktop", "package.json");
    if (!existsSync(file)) return [];
    const manifest = JSON.parse(readFileSync(file, "utf8"));
    return Object.keys(manifest.dependencies ?? {}).filter((name) => !name.startsWith("@deepseek-ai/"));
  };
  const text = (value) =>
    typeof value === "string" ? value : (value?.["zh-CN"] ?? value?.zh ?? value?.en ?? "");
  return {
    async list() {
      const { parseMarketIndex, marketInstallTarget } = await import(
        pathToFileURL(
          createRequire(join(modules, "package.json")).resolve("@deepseek-ai/dsh-plugin-market-index"),
        ).href
      );
      const names = installed();
      const response = await fetch(KAITU_PLUGIN_INDEX, { signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error(`插件目录读取失败（HTTP ${response.status}）`);
      const index = parseMarketIndex(await response.json(), KAITU_PLUGIN_INDEX);
      const catalog = index.plugins.map((plugin) => {
        const latest = plugin.versions[0];
        return {
          name: plugin.name,
          title: text(plugin.title) || plugin.name,
          description: text(plugin.description),
          version: latest?.version ?? "",
          spec: latest ? marketInstallTarget(plugin.name, latest).spec : "",
          installed: names.includes(plugin.name),
        };
      });
      const extra = names
        .filter((name) => !catalog.some((plugin) => plugin.name === name))
        .map((name) => ({ name, title: name, description: "", version: "", spec: "", installed: true }));
      return [...catalog, ...extra];
    },
    async install(spec) {
      if (typeof spec !== "string" || !spec.trim()) throw new Error("请选择要安装的插件");
      for (const profile of PROFILES) await dsh(profile, ["add", spec]);
      await onChanged();
    },
    async remove(name) {
      if (!installed().includes(name)) throw new Error("这个插件没有安装");
      for (const profile of PROFILES) await dsh(profile, ["remove", name]);
      await onChanged();
    },
  };
}
