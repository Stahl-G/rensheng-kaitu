import type { BundleInfo, ChangeResult } from "@deepseek-ai/dsh-api-remotes/client";
import { expect, test } from "vitest";
import type { PluginItem } from "../src/client/Plugins.js";
import { createHostPluginRequest } from "../src/client/host-plugins.js";

test("host installation and removal update status without removing directory entries", async () => {
  let bundles: BundleInfo[] = [];
  const calls: string[] = [];
  const request = createHostPluginRequest({
    listBundles: async () => bundles,
    installBundle: async (spec) => {
      calls.push(spec);
      bundles = [{ name: "kaitu-fortune", installed: true, removable: true, version: "0.1.3" } as BundleInfo];
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
  const entry = before.find((item) => item.name === "kaitu-fortune");
  expect(entry?.spec).toMatch(/^git\+https:.*#[a-f0-9]{40}$/);
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

test("pending plugins cannot be installed and failed host changes remain failures", async () => {
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
  const pending = items.find((item) => item.name === "kaitu-auday");
  await expect(request("install", pending?.spec)).rejects.toThrow();
  expect(calls).toEqual([]);
  await expect(request("install", items.find((item) => item.spec)?.spec)).rejects.toThrow("install refused");
  await expect(request("remove", "kaitu-fortune")).resolves.toEqual({ application: "restart-required" });
});

test.each([
  ["0.3.0", false],
  ["0.3.1", false],
  ["9.0.0", false],
  ["0.1.2", false],
])("published catalog does not downgrade installed %s", async (version, updateAvailable) => {
  const request = createHostPluginRequest({
    listBundles: async () => [
      { name: "kaitu-novel-workspace", installed: true, removable: true, version } as BundleInfo,
    ],
    installBundle: async () => {
      throw new Error("No package changes in this check");
    },
    removeBundle: async () => {
      throw new Error("No package changes in this check");
    },
    open: () => {},
  });
  const item = ((await request("list")) as PluginItem[]).find(
    (item) => item.name === "kaitu-novel-workspace",
  );
  expect(item).toMatchObject({
    installedVersion: version,
    version: "0.1.2",
    updateAvailable,
    license: "MIT",
    dshVersion: "0.2.1-rc.2",
  });
});

test("published Fortune updates show the released AGPL package, not the rc.3 draft", async () => {
  const request = createHostPluginRequest({
    listBundles: async () => [
      { name: "kaitu-fortune", installed: true, removable: true, version: "0.1.1" } as BundleInfo,
    ],
    installBundle: async () => {
      throw new Error("No package changes in this check");
    },
    removeBundle: async () => {
      throw new Error("No package changes in this check");
    },
    open: () => {},
  });
  const item = ((await request("list")) as PluginItem[]).find((item) => item.name === "kaitu-fortune");
  expect(item).toMatchObject({
    installedVersion: "0.1.1",
    version: "0.1.3",
    updateAvailable: true,
    license: "AGPL-3.0-only",
    dshVersion: "0.2.1-rc.2",
  });
  expect(item?.spec).toBe(
    "git+https://github.com/Stahl-G/dsh-kaitu-fortune.git#dfbb17f941609ff59d6583ebb5d74aa029a6630e",
  );
});
