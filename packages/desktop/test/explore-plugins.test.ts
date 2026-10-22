import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { createPluginService } from "../plugins.mjs";

it("discovers installed package metadata locally, preserves origins, and reflects removal after recreation", async () => {
  const home = mkdtempSync(join(tmpdir(), "kaitu-installed-explore-"));
  const profile = join(home, "profiles/desktop");
  mkdirSync(join(profile, "node_modules/synthetic-plugin"), { recursive: true });
  const manifest = join(profile, "package.json");
  const definition = {
    title: { zh: "合成模块", en: "Synthetic" },
    description: "Synthetic content",
    icon: "◇",
    page: "synthetic-page",
  };
  writeFileSync(
    join(profile, "node_modules/synthetic-plugin/package.json"),
    JSON.stringify({ kaitu: { explore: definition } }),
  );
  writeFileSync(manifest, JSON.stringify({ dependencies: { "synthetic-plugin": "file:synthetic" } }));
  const make = () =>
    createPluginService({
      home,
      archive: home,
      runtime: home,
      beforeChange: async () => {},
      onChanged: async () => {},
    });
  try {
    const before = readFileSync(manifest, "utf8");
    expect(make().explore()).toEqual([
      {
        id: "plugin:synthetic-plugin",
        name: "synthetic-plugin",
        page: "synthetic-page",
        title: ["合成模块", "Synthetic"],
        description: ["Synthetic content", "Synthetic content"],
        icon: "◇",
      },
    ]);
    const route = new URL(
      await make().page("plugin:synthetic-plugin", "http://127.0.0.1:23456", async () => ({
        url: "http://127.0.0.1:34567/?token=synthetic-access",
      })),
    );
    expect(route.searchParams.get("token")).toBe("synthetic-access");
    expect(new URLSearchParams(route.hash.slice(1)).get("kaitu-page")).toBe("synthetic-page");
    expect(readFileSync(manifest, "utf8")).toBe(before);
    writeFileSync(manifest, JSON.stringify({ dependencies: {} }));
    expect(make().explore()).toEqual([]);
    await expect(
      make().page("plugin:synthetic-plugin", "http://127.0.0.1:23456", () => {
        throw new Error("Removed plugin must not start the host");
      }),
    ).rejects.toThrow("这个模块已卸载");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
