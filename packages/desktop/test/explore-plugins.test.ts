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
    JSON.stringify({ kaitu: { explore: { ...definition, url: "https://untrusted.example/plugin" } } }),
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
    expect(route.origin).toBe("http://127.0.0.1:34567");
    expect(new URLSearchParams(route.hash.slice(1)).get("kaitu-page")).toBe("synthetic-page");
    expect(new URLSearchParams(route.hash.slice(1)).get("kaitu-embed")).toBe("1");
    expect(new URLSearchParams(route.hash.slice(1)).get("kaitu-parent")).toBe("http://127.0.0.1:23456");
    for (const url of ["https://untrusted.example/", "http://localhost:34567/", "http://127.0.0.1:23456/"])
      await expect(
        make().page("plugin:synthetic-plugin", "http://127.0.0.1:23456", async () => ({ url })),
      ).rejects.toThrow("插件页面服务地址无效");
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

it("skips missing and interrupted packages while keeping other installed Explore entries", () => {
  const home = mkdtempSync(join(tmpdir(), "kaitu-partial-explore-"));
  const profile = join(home, "profiles/desktop");
  try {
    for (const name of ["first", "broken", "last"])
      mkdirSync(join(profile, "node_modules", name), { recursive: true });
    const manifest = join(profile, "package.json");
    const before = JSON.stringify({ dependencies: { first: "1", missing: "1", broken: "1", last: "1" } });
    writeFileSync(manifest, before);
    for (const name of ["first", "last"])
      writeFileSync(
        join(profile, "node_modules", name, "package.json"),
        JSON.stringify({ kaitu: { explore: { page: name, title: name } } }),
      );
    writeFileSync(join(profile, "node_modules/broken/package.json"), '{"kaitu":');
    const service = createPluginService({
      home,
      archive: home,
      runtime: home,
      beforeChange: async () => {},
      onChanged: async () => {},
    });
    expect(service.explore().map(({ id }) => id)).toEqual(["plugin:first", "plugin:last"]);
    expect(readFileSync(manifest, "utf8")).toBe(before);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
