import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, test, vi } from "vitest";
// @ts-expect-error Desktop adapters are native ESM.
import { createPluginService } from "../plugins.mjs";

test("目录区分实际版本与可更新版本，卸载状态仍保留重装入口，未知版本不降级", async () => {
  const root = mkdtempSync(join(tmpdir(), "kaitu-plugin-catalog-"));
  const archive = join(root, "archive");
  const home = join(root, "home");
  const profile = join(home, "profiles/desktop");
  const packageName = "kaitu-catalog-fixture";
  const installed = join(profile, "node_modules", packageName);
  const cli = createRequire(new URL("../../cli/package.json", import.meta.url));
  const dsh = createRequire(cli.resolve("@deepseek-ai/dsh/package.json"));
  const market = dirname(dsh.resolve("@deepseek-ai/dsh-plugin-market-index/package.json"));
  mkdirSync(join(archive, "dsh/node_modules/@deepseek-ai"), { recursive: true });
  symlinkSync(market, join(archive, "dsh/node_modules/@deepseek-ai/dsh-plugin-market-index"), "junction");
  mkdirSync(installed, { recursive: true });
  const bundledCatalog = JSON.parse(
    readFileSync(new URL("../../../docs/site/plugins/index.json", import.meta.url), "utf8"),
  );
  const template = bundledCatalog.plugins.find(
    (entry: { name: string }) => entry.name === "kaitu-novel-workspace",
  );
  const catalog = {
    ...bundledCatalog,
    plugins: [
      {
        ...template,
        name: packageName,
        versions: [
          { ...template.versions[0], version: "2.0.0" },
          { ...template.versions[0], version: "1.0.0" },
        ],
      },
    ],
  };
  const fetchIndex = vi.fn(async () => new Response(JSON.stringify(catalog)));
  const writeInstalled = (version: string | null) => {
    writeFileSync(
      join(profile, "package.json"),
      JSON.stringify({ dependencies: version ? { [packageName]: version } : {} }),
    );
    writeFileSync(join(installed, "package.json"), JSON.stringify({ name: packageName, version }));
  };
  try {
    const create = () => createPluginService({ archive, runtime: join(root, "runtime"), home, fetchIndex });
    const service = create();
    writeInstalled("1.0.0");
    const initial = await service.list();
    expect(fetchIndex).not.toHaveBeenCalled();
    expect(initial.find((entry: { name: string }) => entry.name === "kaitu-auday")).toMatchObject({
      installed: false,
      version: "0.1.3",
      dshVersion: "0.2.1-rc.3",
    });
    const [updated] = await Promise.all([service.list(true), service.list(true)]);
    expect(fetchIndex).toHaveBeenCalledTimes(1);
    let item = updated.find((entry: { name: string }) => entry.name === packageName);
    expect(item).toMatchObject({
      installed: true,
      installedVersion: "1.0.0",
      version: "2.0.0",
      updateAvailable: true,
    });
    writeInstalled(null);
    item = (await service.list()).find((entry: { name: string }) => entry.name === packageName);
    expect(item.installed).toBe(false);
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
    for (const name of ["kaitu-novel-workspace", "kaitu-fortune", "kaitu-auday"]) {
      const entries = (await create().list()).filter((entry: { name: string }) => entry.name === name);
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        installed: false,
        dshVersion: "0.2.1-rc.3",
      });
    }
    const novel = "kaitu-novel-workspace";
    mkdirSync(join(profile, "node_modules", novel), { recursive: true });
    for (const version of ["0.3.0", "0.3.1", "0.3.2", "0.1.2", "0.3.3-rc.1", "0.4.0", "9.0.0"]) {
      writeFileSync(join(profile, "package.json"), JSON.stringify({ dependencies: { [novel]: version } }));
      writeFileSync(
        join(profile, "node_modules", novel, "package.json"),
        JSON.stringify({ name: novel, version }),
      );
      expect((await create().list()).find((entry: { name: string }) => entry.name === novel)).toMatchObject({
        installedVersion: version,
        version: "0.3.3-rc.1",
        updateAvailable: version === "0.1.2",
        spec: "git+https://github.com/Stahl-G/dsh-novel-workspace.git#836439b9c78bcacc27f2eb25de2461faa1d4565c",
      });
    }
    writeInstalled(null);
    const online = create();
    const stale = {
      ...bundledCatalog,
      plugins: [
        { ...template, versions: [{ ...template.versions[0], version: "0.3.2" }] },
        {
          ...bundledCatalog.plugins.find((entry: { name: string }) => entry.name === "kaitu-fortune"),
          versions: bundledCatalog.plugins
            .find((entry: { name: string }) => entry.name === "kaitu-fortune")
            .versions.slice(1),
        },
      ],
    };
    fetchIndex.mockResolvedValueOnce(new Response(JSON.stringify(stale)));
    const refreshed = await online.list(true);
    for (const name of [novel, "kaitu-fortune", "kaitu-auday"]) {
      const entries = refreshed.filter((entry: { name: string }) => entry.name === name);
      expect(entries).toHaveLength(1);
      expect(entries[0]).toEqual(initial.find((entry: { name: string }) => entry.name === name));
    }
    const refreshNovel = async (versions: object[]) => {
      fetchIndex.mockResolvedValueOnce(
        new Response(JSON.stringify({ ...catalog, plugins: [{ ...template, title: "Online", versions }] })),
      );
      return (await online.list(true)).find((entry: { name: string }) => entry.name === novel);
    };
    expect(await refreshNovel(template.versions)).toMatchObject({ title: "Online", version: "0.3.3-rc.1" });
    expect(
      await refreshNovel([
        {
          ...template.versions[0],
          source: { ...template.versions[0].source, commit: "a".repeat(40) },
        },
      ]),
    ).toMatchObject({
      version: "0.3.3-rc.1",
      spec: "git+https://github.com/Stahl-G/dsh-novel-workspace.git#836439b9c78bcacc27f2eb25de2461faa1d4565c",
    });
    const future = (version: string, dsh: string) => ({ ...template.versions[0], version, engines: { dsh } });
    expect(await refreshNovel([future("0.4.0", ">=0.2.1-rc.4 <0.3.0")])).toMatchObject({
      version: "0.3.3-rc.1",
    });
    const available = [future("9.0.0", ">=0.3.0"), future("0.4.0", ">=0.2.0 <0.3.0"), ...template.versions];
    expect(await refreshNovel(available)).toMatchObject({ title: "Online", version: "0.4.0" });
    writeFileSync(join(profile, "package.json"), JSON.stringify({ dependencies: { [novel]: "0.1.2" } }));
    writeFileSync(
      join(profile, "node_modules", novel, "package.json"),
      JSON.stringify({ name: novel, version: "0.1.2" }),
    );
    expect(await refreshNovel([future("0.4.0", "0.2.1-rc.3")])).toMatchObject({
      version: "0.4.0",
      installedVersion: "0.1.2",
      updateAvailable: true,
    });
    for (const version of ["0.3.3-rc.1", "0.4.0", "9.0.0"]) {
      writeFileSync(join(profile, "package.json"), JSON.stringify({ dependencies: { [novel]: version } }));
      writeFileSync(
        join(profile, "node_modules", novel, "package.json"),
        JSON.stringify({ name: novel, version }),
      );
      expect(await refreshNovel(available)).toMatchObject({
        installedVersion: version,
        version: "0.4.0",
        updateAvailable: version === "0.3.3-rc.1",
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
    expect(existsSync(join(desktop, "package.json"))).toBe(false);
    expect(existsSync(join(home, "profiles/sdk"))).toBe(false);
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
