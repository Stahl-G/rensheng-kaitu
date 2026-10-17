import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { initWorkspace } from "@kaitu/core";
import { expect, it } from "vitest";

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
