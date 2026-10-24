import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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
  const catalog = JSON.parse(
    readFileSync(new URL("../../../docs/site/plugins/index.json", import.meta.url), "utf8"),
  );
  const template = catalog.plugins.find((entry: { name: string }) => entry.name === "kaitu-novel-workspace");
  catalog.plugins = [
    {
      ...template,
      name: packageName,
      versions: [
        { ...template.versions[0], version: "2.0.0" },
        { ...template.versions[0], version: "1.0.0" },
      ],
    },
  ];
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
      spec: "",
      version: "",
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
      expect((await create().list()).find((entry: { name: string }) => entry.name === name)).toMatchObject({
        installed: false,
      });
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
