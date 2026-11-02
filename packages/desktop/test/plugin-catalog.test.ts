import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, test, vi } from "vitest";
// @ts-expect-error Desktop adapters are native ESM.
import { createPluginService } from "../plugins.mjs";

test("真实目录排除不兼容版本，兼容远端候选保留安装、更新和来源语义", async () => {
  const root = mkdtempSync(join(tmpdir(), "kaitu-plugin-catalog-"));
  const archive = join(root, "archive");
  const home = join(root, "home");
  const profile = join(home, "profiles/desktop");
  const packageName = "kaitu-catalog-fixture";
  const cli = createRequire(new URL("../../cli/package.json", import.meta.url));
  const dsh = createRequire(cli.resolve("@deepseek-ai/dsh/package.json"));
  const market = dirname(dsh.resolve("@deepseek-ai/dsh-plugin-market-index/package.json"));
  mkdirSync(join(archive, "dsh/node_modules/@deepseek-ai"), { recursive: true });
  symlinkSync(market, join(archive, "dsh/node_modules/@deepseek-ai/dsh-plugin-market-index"), "junction");
  mkdirSync(profile, { recursive: true });
  const bundledCatalog = JSON.parse(
    readFileSync(new URL("../../../docs/site/plugins/index.json", import.meta.url), "utf8"),
  );
  const novel = "kaitu-novel-workspace";
  const template = bundledCatalog.plugins.find((entry: { name: string }) => entry.name === novel);
  // Only the remote response is synthetic; no released manifest or bundled index is rewritten.
  const candidate = (version: string, dsh = "0.2.1-rc.5") => ({
    ...template.versions[0],
    version,
    engines: { dsh },
    source: { ...template.versions[0].source, commit: "a".repeat(40) },
  });
  const catalog = {
    ...bundledCatalog,
    plugins: [{ ...template, name: packageName, versions: [candidate("2.0.0"), candidate("1.0.0")] }],
  };
  const fetchIndex = vi.fn(async () => new Response(JSON.stringify(catalog)));
  const writeInstalled = (version: string | null, name = packageName) => {
    writeFileSync(
      join(profile, "package.json"),
      JSON.stringify({ dependencies: version ? { [name]: version } : {} }),
    );
    const installed = join(profile, "node_modules", name);
    mkdirSync(installed, { recursive: true });
    writeFileSync(join(installed, "package.json"), JSON.stringify({ name, version }));
  };
  try {
    const create = () => createPluginService({ archive, runtime: join(root, "runtime"), home, fetchIndex });
    const service = create();
    writeInstalled(null);
    const initial = await service.list();
    expect(fetchIndex).not.toHaveBeenCalled();
    for (const name of [novel, "kaitu-fortune"])
      expect(initial.find((entry: { name: string }) => entry.name === name)).toBeUndefined();
    expect(initial.find((entry: { name: string }) => entry.name === "kaitu-auday")).toMatchObject({
      installed: false,
      version: "",
      spec: "",
      updateAvailable: false,
    });
    // The real RC3 Auday version is known, but its RC5 placeholder has no latest candidate.
    for (const name of ["kaitu-auday", novel, "kaitu-fortune"]) {
      const version = bundledCatalog.plugins.find((entry: { name: string }) => entry.name === name)
        .versions[0].version;
      writeInstalled(version, name);
      expect((await service.list()).find((entry: { name: string }) => entry.name === name)).toMatchObject({
        installed: true,
        installedVersion: version,
        version: "",
        spec: "",
        updateAvailable: false,
      });
    }
    writeInstalled("1.0.0");
    const [updated] = await Promise.all([service.list(true), service.list(true)]);
    expect(fetchIndex).toHaveBeenCalledTimes(1);
    let item = updated.find((entry: { name: string }) => entry.name === packageName);
    expect(item).toMatchObject({
      installed: true,
      installedVersion: "1.0.0",
      version: "2.0.0",
      updateAvailable: true,
    });
    expect(item.spec).toBe(`git+https://github.com/Stahl-G/dsh-novel-workspace.git#${"a".repeat(40)}`);
    writeInstalled(null);
    item = (await service.list()).find((entry: { name: string }) => entry.name === packageName);
    expect(item).toMatchObject({ installed: false, version: "2.0.0" });
    expect(item.spec).toBeTruthy();
    writeInstalled("9.0.0");
    item = (await service.list()).find((entry: { name: string }) => entry.name === packageName);
    expect(item).toMatchObject({ installedVersion: "9.0.0", updateAvailable: false });
    fetchIndex.mockRejectedValueOnce(new Error("offline"));
    await expect(service.list(true)).rejects.toThrow("无法连接插件目录");
    expect((await service.list()).find((entry: { name: string }) => entry.name === packageName)).toEqual(
      item,
    );
    fetchIndex.mockResolvedValueOnce(new Response("not JSON"));
    await expect(service.list(true)).rejects.toThrow();
    expect((await service.list()).find((entry: { name: string }) => entry.name === packageName)).toEqual(
      item,
    );
    writeInstalled(null);
    const online = create();
    const refreshNovel = async (versions: object[]) => {
      fetchIndex.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ ...catalog, plugins: [{ ...template, title: "Synthetic candidate", versions }] }),
        ),
      );
      return (await online.list(true)).find((entry: { name: string }) => entry.name === novel);
    };
    expect(await refreshNovel(template.versions)).toBeUndefined();
    expect(await refreshNovel([candidate("0.4.0", ">=0.2.1-rc.6 <0.3.0")])).toBeUndefined();
    const available = [candidate("9.0.0", ">=0.3.0"), candidate("0.4.0"), ...template.versions];
    expect(await refreshNovel(available)).toMatchObject({
      title: "Synthetic candidate",
      version: "0.4.0",
      spec: `git+https://github.com/Stahl-G/dsh-novel-workspace.git#${"a".repeat(40)}`,
    });
    for (const version of ["0.1.2", "0.3.3-rc.1", "0.4.0", "9.0.0"]) {
      writeInstalled(version, novel);
      expect(await refreshNovel(available)).toMatchObject({
        installedVersion: version,
        version: "0.4.0",
        updateAvailable: ["0.1.2", "0.3.3-rc.1"].includes(version),
      });
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("冷安装用官方模板准备两个 profile，保留已有 patch 并实际执行两次安装", async () => {
  const root = mkdtempSync(join(tmpdir(), "kaitu-cold-plugin-install-"));
  const archive = join(root, "archive");
  const runtime = join(root, "runtime");
  const home = join(root, "home");
  const desktop = join(home, "profiles/desktop");
  const cli = createRequire(new URL("../../cli/package.json", import.meta.url));
  const anchor = cli.resolve("@deepseek-ai/dsh/package.json");
  const dsh = createRequire(anchor);
  const modules = join(archive, "dsh/node_modules/@deepseek-ai");
  const packageName = "kaitu-synthetic-cold-install";
  const patch = "# synthetic existing application patch\n[]\n";
  const beforeChange = vi.fn(async () => {});
  const onChanged = vi.fn(async () => {});
  const previousHome = process.env.DSH_HOME;
  try {
    mkdirSync(modules, { recursive: true });
    symlinkSync(dirname(anchor), join(modules, "dsh"), "junction");
    symlinkSync(
      dirname(dsh.resolve("@deepseek-ai/dsh-app-boot/package.json")),
      join(modules, "dsh-app-boot"),
      "junction",
    );
    mkdirSync(join(runtime, "node"), { recursive: true });
    symlinkSync(dirname(process.execPath), join(runtime, "node/bin"), "junction");
    mkdirSync(join(runtime, "pnpm/bin"), { recursive: true });
    // Only the package mutation is synthetic; profile initialization uses the real installed DSH loader.
    writeFileSync(
      join(runtime, "pnpm/bin/pnpm.cjs"),
      `const fs = require("node:fs");
if (process.argv[3] === "synthetic-fail") { console.error("ERR_SYNTHETIC_INSTALL"); process.exit(1); }
const path = "package.json";
const manifest = JSON.parse(fs.readFileSync(path, "utf8"));
manifest.dependencies[${JSON.stringify(packageName)}] = "1.0.0";
fs.writeFileSync(path, JSON.stringify(manifest));
`,
    );
    mkdirSync(desktop, { recursive: true });
    writeFileSync(join(desktop, "cordis.patch.yml"), patch);
    const service = createPluginService({ archive, runtime, home, beforeChange, onChanged });
    await service.install(`${packageName}@1.0.0`);
    const manifests = ["desktop", "sdk"].map((profile) =>
      JSON.parse(readFileSync(join(home, "profiles", profile, "package.json"), "utf8")),
    );
    expect(manifests.map((manifest) => manifest.dependencies)).toEqual([
      { [packageName]: "1.0.0" },
      { [packageName]: "1.0.0" },
    ]);
    for (const manifest of manifests) expect(manifest.dsh.profile.bundles).toContain(packageName);
    expect(readFileSync(join(desktop, "cordis.patch.yml"), "utf8")).toBe(patch);
    expect(process.env.DSH_HOME).toBe(previousHome);
    expect(beforeChange).toHaveBeenCalledTimes(1);
    expect(onChanged).toHaveBeenCalledTimes(1);
    const failed = createPluginService({
      archive,
      runtime,
      home: join(root, "failed-home"),
      beforeChange,
      onChanged,
    });
    await expect(failed.install("synthetic-fail")).rejects.toThrow("ERR_SYNTHETIC_INSTALL");
    expect(onChanged).toHaveBeenCalledTimes(2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
