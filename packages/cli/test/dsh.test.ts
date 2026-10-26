import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { initWorkspace } from "@kaitu/core";
import { expect, it } from "vitest";

it("桌面初始化保留带前置注释的 flow/block patch，添加可解析且幂等的独立端口", async () => {
  const root = mkdtempSync(join(tmpdir(), "kaitu-desktop-patch-"));
  const { parse } = createRequire(new URL("../../core/package.json", import.meta.url))("yaml");
  const dist = join(root, "payload/dist");
  mkdirSync(dist, { recursive: true });
  for (const file of ["index.js", "client.js"]) writeFileSync(join(dist, file), "export {};\n");
  const source = readFileSync(new URL("../../desktop/initialize.mjs", import.meta.url), "utf8")
    .replace('"../cli/dist/dsh.js"', JSON.stringify(new URL("../dist/dsh.js", import.meta.url).href))
    .replace(
      '"./environment.mjs"',
      JSON.stringify(new URL("../../desktop/environment.mjs", import.meta.url).href),
    );
  const initializer = join(dist, "initialize.mjs");
  writeFileSync(initializer, source);
  try {
    for (const [format, initial] of [
      ["flow", "# profile\n# custom settings\n[]\n"],
      ["block", "# profile\n- id: custom\n  config: { keep: true }\n"],
    ]) {
      const state = join(root, format);
      const profile = join(state, "profiles/desktop");
      mkdirSync(profile, { recursive: true });
      const file = join(profile, "cordis.patch.yml");
      writeFileSync(file, initial);
      const initialize = () =>
        promisify(execFile)(process.execPath, [initializer], {
          env: {
            ...process.env,
            KAITU_APP_HOME: state,
            KAITU_DIR: join(root, "workspace"),
            KAITU_APP_PORT: "0",
          },
        });
      await initialize();
      const first = readFileSync(file, "utf8");
      const entries = parse(first);
      expect(first).toContain("# profile");
      if (format === "block")
        expect(entries.find((entry: { id: string }) => entry.id === "custom").config.keep).toBe(true);
      const servers = entries.filter((entry: { id: string }) => entry.id === "webserver");
      expect(servers).toHaveLength(1);
      expect(servers[0].config.port).toBe(0);
      await initialize();
      expect(readFileSync(file, "utf8")).toBe(first);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it("dsh 插件安装只加开图、保留 DSH 品牌，重复安装保留用户段且不重复追加", async () => {
  const root = mkdtempSync(join(tmpdir(), "kaitu-dsh-install-"));
  try {
    const workspace = join(root, "workspace");
    await initWorkspace(workspace);
    const home = join(root, "dsh");
    const profile = join(home, "profiles/desktop");
    mkdirSync(profile, { recursive: true });
    const file = join(profile, "cordis.patch.yml");
    const before = "# user before\n- id: custom\n  config: { keep: true }\n";
    const after = "\n# user after\n- id: other\n  disabled: false\n\n";
    writeFileSync(
      file,
      `${before}# kaitu:start（由 kaitu dsh --install 维护）\n- insert: []\n# kaitu:end${after}`,
    );
    const install = () =>
      promisify(execFile)(
        process.execPath,
        ["packages/cli/dist/main.js", "dsh", "--install", "--dir", workspace],
        { env: { ...process.env, DSH_HOME: home } },
      );
    await install();
    const installed = readFileSync(file, "utf8");
    await install();
    expect({
      prefix: installed.slice(0, installed.indexOf("# kaitu:start")),
      suffix: installed.slice(installed.indexOf("# kaitu:end") + "# kaitu:end".length),
      brandKept: !installed.includes("ui-brand-official") && !installed.includes("brand: true"),
      overviewRegistered: installed.includes("- id: kaitu\n"),
      repeated: readFileSync(file, "utf8"),
    }).toEqual({
      prefix: before,
      suffix: after,
      brandKept: true,
      overviewRegistered: true,
      repeated: installed,
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
