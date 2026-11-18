import type { BundleInfo, ChangeResult } from "@deepseek-ai/dsh-api-remotes/client";
import { expect, test, vi } from "vitest";
import type fixtureIndex from "../../../docs/site/plugins/index.json";

vi.mock("../../../docs/site/plugins/index.json", async (importOriginal) => {
  const { default: original } = await importOriginal<{ default: typeof fixtureIndex }>();
  const index = structuredClone(original);
  const fortune = index.plugins.find((entry) => entry.name === "kaitu-fortune");
  if (fortune)
    fortune.versions.unshift({ ...fortune.versions[0], version: "9.0.0", engines: { dsh: ">=0.3.0" } });
  return { default: index };
});
import type { PluginItem } from "../src/client/Plugins.js";
import { createHostPluginRequest } from "../src/client/host-plugins.js";

test("host installation and removal update status without removing directory entries", async () => {
  let bundles: BundleInfo[] = [];
  const calls: string[] = [];
  const request = createHostPluginRequest({
    listBundles: async () => bundles,
    installBundle: async (spec) => {
      calls.push(spec);
      bundles = [{ name: "kaitu-fortune", installed: true, removable: true, version: "0.1.4" } as BundleInfo];
      return { application: "applied" } as ChangeResult;
    },
    removeBundle: async (name) => {
      calls.push(name);
      bundles = [];
      return { application: "applied" } as ChangeResult;
    },
    open: () => {},
  });
  const before = (await request("list")) as PluginItem[];
  for (const name of ["kaitu-fortune", "kaitu-novel-workspace", "kaitu-auday"]) {
    const entries = before.filter((item) => item.name === name);
    expect(entries).toHaveLength(1);
  }
  const entry = before.find((item) => item.name === "kaitu-fortune");
  expect(entry?.license).toBe("AGPL-3.0-only");
  await request("install", entry?.spec);
  expect(((await request("list")) as PluginItem[]).find((item) => item.name === entry?.name)?.installed).toBe(
    true,
  );
  await request("remove", entry?.name);
  const after = (await request("list")) as PluginItem[];
  expect(after.map((item) => item.name)).toEqual(before.map((item) => item.name));
  expect(after.every((item) => !item.installed)).toBe(true);
  expect(calls).toEqual([entry?.spec, entry?.name]);
});

test("unlisted specs cannot be installed and failed host changes remain failures", async () => {
  const calls: string[] = [];
  const request = createHostPluginRequest({
    listBundles: async () => [],
    installBundle: async (spec) => {
      calls.push(spec);
      return {
        application: "failed",
        error: { code: "operation-error", diagnostic: "install refused" },
      } as ChangeResult;
    },
    removeBundle: async () => ({ application: "restart-required" }) as ChangeResult,
    open: () => {},
  });
  const items = (await request("list")) as PluginItem[];
  await expect(request("install", "")).rejects.toThrow();
  expect(calls).toEqual([]);
  await expect(request("install", items.find((item) => item.spec)?.spec)).rejects.toThrow("install refused");
  await expect(request("remove", "kaitu-fortune")).resolves.toEqual({ application: "restart-required" });
});

test("incompatible installed novels remain removable but are not offered an install or update", async () => {
  const calls: string[] = [];
  const request = createHostPluginRequest({
    listBundles: async () => [
      {
        name: "kaitu-novel-workspace",
        installed: true,
        removable: true,
        version: "0.3.3-rc.1",
      } as BundleInfo,
    ],
    installBundle: async (spec) => {
      calls.push(spec);
      return { application: "applied" } as ChangeResult;
    },
    removeBundle: async () => ({ application: "applied" }) as ChangeResult,
    open: () => {},
  });
  const item = ((await request("list")) as PluginItem[]).find(
    (item) => item.name === "kaitu-novel-workspace",
  );
  expect(item).toMatchObject({
    installed: true,
    installedVersion: "0.3.3-rc.1",
    spec: "",
    updateAvailable: false,
  });
  await expect(request("install", item?.spec)).rejects.toThrow();
  expect(calls).toEqual([]);
  await expect(request("remove", "kaitu-novel-workspace")).resolves.toMatchObject({ application: "applied" });
});

test.each([
  ["0.1.6", true],
  ["0.1.7-rc.4", false],
  ["9.0.0", false],
  ["8.0.0", false],
])("compatible candidate never downgrades installed %s", async (version, updateAvailable) => {
  const request = createHostPluginRequest({
    listBundles: async () => [
      { name: "kaitu-fortune", installed: true, removable: true, version } as BundleInfo,
    ],
    installBundle: async () => ({ application: "applied" }) as ChangeResult,
    removeBundle: async () => ({ application: "applied" }) as ChangeResult,
    open: () => {},
  });
  expect(
    ((await request("list")) as PluginItem[]).find((item) => item.name === "kaitu-fortune"),
  ).toMatchObject({ version: "0.1.7-rc.4", updateAvailable });
});
