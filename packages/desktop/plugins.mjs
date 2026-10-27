import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { delimiter, join } from "node:path";
import { pathToFileURL } from "node:url";
import semver from "semver";
import bundledIndex from "../../docs/site/plugins/index.json" with { type: "json" };
import { KaituError } from "../core/dist/index.js";
import { DSH_VERSION } from "./payload-loader.mjs";

/** 开图的插件目录（DSH 插件市场索引格式 1）。 */
export const KAITU_PLUGIN_INDEX = "https://kaitu.si/plugins/index.json";
// 后台 AI（DSH 窗口）和问问用不同的 DSH profile，插件两边都装，页面和工具才都能用。
const PROFILES = ["desktop", "sdk"];
const compatibleVersion = (plugin) =>
  plugin?.versions.find(
    (version) =>
      !version.engines.dsh || semver.satisfies(DSH_VERSION, version.engines.dsh, { includePrerelease: true }),
  );

/**
 * 插件 = DSH bundle。和 DSH 插件管理器做的一样：在 profile 目录里用 pnpm 装包，再把包名登记进
 * package.json 的 dsh.profile.bundles。pnpm 和 node 用 App 自带的运行时。
 * 改 profile 前先停掉后台 AI（beforeChange），改完再重新加载（onChanged）。
 */
export function createPluginService({ archive, runtime, home, beforeChange, onChanged, fetchIndex = fetch }) {
  const modules = join(archive, "dsh/node_modules");
  const bin = join(home, "bin");
  const pnpm = join(bin, "pnpm");
  const windows = process.platform === "win32";
  if (!windows && !existsSync(pnpm)) {
    mkdirSync(bin, { recursive: true });
    writeFileSync(
      pnpm,
      `#!/bin/sh\nexec "${join(runtime, "node/bin/node")}" "${join(runtime, "pnpm/bin/pnpm.cjs")}" "$@"\n`,
    );
    chmodSync(pnpm, 0o755);
  }
  const profileDir = (profile) => join(home, "profiles", profile);
  const manifest = (profile) => JSON.parse(readFileSync(join(profileDir(profile), "package.json"), "utf8"));
  const prepareProfiles = async () => {
    const resolve = createRequire(join(modules, "package.json"));
    const { initProfile, loadProfile, PROFILE_TEMPLATES } = await import(
      pathToFileURL(resolve.resolve("@deepseek-ai/dsh-app-boot")).href
    );
    const anchor = resolve.resolve("@deepseek-ai/dsh/package.json");
    for (const profile of PROFILES) {
      initProfile(profileDir(profile), PROFILE_TEMPLATES[profile === "desktop" ? "web" : profile].bundles);
      loadProfile("dsh", profile, anchor, home, { userLayer: false });
    }
  };
  const run = (profile, args) =>
    new Promise((resolve, reject) => {
      const node = join(runtime, windows ? "node/bin/node.exe" : "node/bin/node");
      const child = spawn(
        windows ? node : pnpm,
        windows ? [join(runtime, "pnpm/bin/pnpm.cjs"), ...args] : args,
        {
          cwd: profileDir(profile),
          env: { ...process.env, PATH: [bin, process.env.PATH].join(delimiter), CI: "true" },
          windowsHide: true,
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
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
  let market;
  let bundled;
  let remote = [];
  let refreshing;
  const readMarket = () => {
    market ??= import(
      pathToFileURL(
        createRequire(join(modules, "package.json")).resolve("@deepseek-ai/dsh-plugin-market-index"),
      ).href
    );
    return market;
  };
  const refreshCatalog = () => {
    refreshing ??= (async () => {
      let response;
      try {
        response = await fetchIndex(KAITU_PLUGIN_INDEX, {
          signal: AbortSignal.timeout(15000),
          credentials: "omit",
        });
      } catch (cause) {
        throw Object.assign(new KaituError("无法连接插件目录，请检查网络后重试", "PLUGIN_NETWORK"), {
          cause,
        });
      }
      if (!response.ok) throw new KaituError(`插件目录读取失败（HTTP ${response.status}）`, "PLUGIN");
      const { parseMarketIndex } = await readMarket();
      remote = parseMarketIndex(await response.json(), KAITU_PLUGIN_INDEX).plugins;
    })().finally(() => {
      refreshing = undefined;
    });
    return refreshing;
  };
  return {
    async page(id, workbenchOrigin, open) {
      const entry = this.explore().find((item) => item.id === id);
      if (!entry) throw new KaituError("这个模块已卸载", "PLUGIN");
      const { url } = await open();
      const target = new URL(url);
      if (
        target.protocol !== "http:" ||
        target.hostname !== "127.0.0.1" ||
        target.username ||
        target.password ||
        target.origin === new URL(workbenchOrigin).origin
      )
        throw new KaituError("插件页面服务地址无效", "PLUGIN");
      target.hash = new URLSearchParams({ "kaitu-page": entry.page, "kaitu-embed": "1" }).toString();
      return target.href;
    },
    explore() {
      const entries = installed().flatMap((name) => {
        try {
          const pkg = JSON.parse(
            readFileSync(join(profileDir("desktop"), "node_modules", name, "package.json"), "utf8"),
          );
          const entry = pkg.kaitu?.explore;
          if (!entry || typeof entry.page !== "string" || !entry.page || !text(entry.title)) return [];
          const pair = (value) =>
            typeof value === "string"
              ? [value, value]
              : [value?.zh ?? value?.en ?? "", value?.en ?? value?.zh ?? ""];
          return [
            {
              id: `plugin:${name}`,
              name,
              page: entry.page,
              title: pair(entry.title),
              description: pair(entry.description),
              icon: typeof entry.icon === "string" ? entry.icon : "◇",
            },
          ];
        } catch {
          return [];
        }
      });
      return entries;
    },
    async list(refresh = false) {
      const { parseMarketIndex, marketInstallTarget } = await readMarket();
      bundled ??= parseMarketIndex(bundledIndex, KAITU_PLUGIN_INDEX).plugins;
      if (refresh) await refreshCatalog();
      const names = installed();
      const versions = new Map(
        names.map((name) => {
          const file = join(profileDir("desktop"), "node_modules", name, "package.json");
          return [name, existsSync(file) ? JSON.parse(readFileSync(file, "utf8")).version : ""];
        }),
      );
      const directory = new Map();
      const knownVersions = new Map();
      for (const plugin of [...bundled, ...remote]) {
        const known = knownVersions.get(plugin.name) ?? new Set();
        for (const version of plugin.versions) known.add(version.version);
        knownVersions.set(plugin.name, known);
        const latest = compatibleVersion(plugin);
        if (plugin.versions.length && !latest) continue;
        const previous = compatibleVersion(directory.get(plugin.name));
        if (
          !previous ||
          (latest &&
            (semver.gt(latest.version, previous.version) ||
              (latest.version === previous.version &&
                marketInstallTarget(plugin.name, latest).spec ===
                  marketInstallTarget(plugin.name, previous).spec)))
        )
          directory.set(plugin.name, plugin);
      }
      // 目录里的 kaitu-dsh 是给 DSH 装开图用的，开图 App 自己就是开图，不列出来。
      const catalog = [...directory.values()]
        .filter((plugin) => plugin.name !== "kaitu-dsh")
        .map((plugin) => {
          const latest = compatibleVersion(plugin);
          return {
            name: plugin.name,
            title: text(plugin.title) || plugin.name,
            description: text(plugin.description),
            version: latest?.version ?? "",
            license: bundledIndex.plugins.find(
              (entry) => entry.name === plugin.name && entry.versions[0]?.version === latest?.version,
            )?.license,
            dshVersion: latest?.engines.dsh,
            homepage: plugin.homepage,
            spec: latest ? marketInstallTarget(plugin.name, latest).spec : "",
            installed: names.includes(plugin.name),
            installedVersion: versions.get(plugin.name),
            updateAvailable:
              knownVersions.get(plugin.name)?.has(versions.get(plugin.name)) === true &&
              semver.gt(latest.version, versions.get(plugin.name)),
          };
        });
      const extra = names
        .filter((name) => !catalog.some((plugin) => plugin.name === name))
        .map((name) => ({
          name,
          title: name,
          description: "",
          version: "",
          spec: "",
          installed: true,
          installedVersion: versions.get(name),
          updateAvailable: false,
        }));
      return [...catalog, ...extra];
    },
    async install(spec) {
      if (typeof spec !== "string" || !spec.trim()) throw new KaituError("请选择要安装的插件", "PLUGIN");
      await beforeChange();
      try {
        await prepareProfiles();
        for (const profile of PROFILES) {
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
