import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { KaituError } from "../core/dist/index.js";

/** 开图的插件目录（DSH 插件市场索引格式 1）。 */
export const KAITU_PLUGIN_INDEX = "https://kaitu.si/plugins/index.json";
// 后台 AI（DSH 窗口）和问问用不同的 DSH profile，插件两边都装，页面和工具才都能用。
const PROFILES = ["desktop", "sdk"];

/**
 * 插件 = DSH bundle。和 DSH 插件管理器做的一样：在 profile 目录里用 pnpm 装包，再把包名登记进
 * package.json 的 dsh.profile.bundles。pnpm 和 node 用 App 自带的运行时。
 * 改 profile 前先停掉后台 AI（beforeChange），改完再重新加载（onChanged）。
 */
export function createPluginService({ archive, runtime, home, beforeChange, onChanged }) {
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
  const profileDir = (profile) => join(home, "profiles", profile);
  const manifest = (profile) => JSON.parse(readFileSync(join(profileDir(profile), "package.json"), "utf8"));
  const run = (profile, args) =>
    new Promise((resolve, reject) => {
      const child = spawn(pnpm, args, {
        cwd: profileDir(profile),
        env: { ...process.env, PATH: `${bin}:/usr/bin:/bin:/usr/sbin:/sbin`, CI: "true" },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let output = "";
      child.stdout.on("data", (chunk) => {
        output += chunk;
      });
      child.stderr.on("data", (chunk) => {
        output += chunk;
      });
      child.once("error", reject);
      child.once("exit", (code) => {
        if (code === 0) resolve();
        else {
          const reason = output.split("\n").find((line) => /ERR_|error/i.test(line));
          reject(new KaituError(`插件安装没有完成：${reason?.trim() ?? `pnpm 退出码 ${code}`}`, "PLUGIN"));
        }
      });
    });
  const setBundle = (profile, name, present) => {
    const file = join(profileDir(profile), "package.json");
    const data = manifest(profile);
    const bundles = (data.dsh?.profile?.bundles ?? []).filter((item) => item !== name);
    if (present) bundles.push(name);
    data.dsh = { ...data.dsh, profile: { ...data.dsh?.profile, bundles } };
    writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
  };
  const profiles = () => PROFILES.filter((profile) => existsSync(join(profileDir(profile), "package.json")));
  const installed = () =>
    existsSync(join(profileDir("desktop"), "package.json"))
      ? Object.keys(manifest("desktop").dependencies ?? {}).filter(
          (name) => !name.startsWith("@deepseek-ai/"),
        )
      : [];
  const text = (value) => (typeof value === "string" ? value : (value?.zh ?? value?.en ?? ""));
  return {
    async list() {
      const { parseMarketIndex, marketInstallTarget } = await import(
        pathToFileURL(
          createRequire(join(modules, "package.json")).resolve("@deepseek-ai/dsh-plugin-market-index"),
        ).href
      );
      const names = installed();
      const response = await fetch(KAITU_PLUGIN_INDEX, { signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new KaituError(`插件目录读取失败（HTTP ${response.status}）`, "PLUGIN");
      const index = parseMarketIndex(await response.json(), KAITU_PLUGIN_INDEX);
      // 目录里的 kaitu-dsh 是给 DSH 装开图用的，开图 App 自己就是开图，不列出来。
      const catalog = index.plugins
        .filter((plugin) => plugin.name !== "kaitu-dsh")
        .map((plugin) => {
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
      if (typeof spec !== "string" || !spec.trim()) throw new KaituError("请选择要安装的插件", "PLUGIN");
      await beforeChange();
      try {
        for (const profile of profiles()) {
          const before = Object.keys(manifest(profile).dependencies ?? {});
          await run(profile, ["add", spec]);
          for (const name of Object.keys(manifest(profile).dependencies ?? {}))
            if (!before.includes(name)) setBundle(profile, name, true);
        }
      } finally {
        await onChanged();
      }
    },
    async remove(name) {
      if (!installed().includes(name)) throw new KaituError("这个插件没有安装", "PLUGIN");
      await beforeChange();
      try {
        for (const profile of profiles()) {
          if (!(name in (manifest(profile).dependencies ?? {}))) continue;
          setBundle(profile, name, false);
          await run(profile, ["remove", name]);
        }
      } finally {
        await onChanged();
      }
    },
  };
}
