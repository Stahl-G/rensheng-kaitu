import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { createSdkRuntime } from "../sdk-runtime.mjs";

it("读「连没连 AI」不启动 DSH，凭据状态只问一次，改配置后重新问", async () => {
  const directory = mkdtempSync(join(tmpdir(), "kaitu-ai-status-"));
  try {
    const home = join(directory, "state");
    const workspace = join(directory, "workspace");
    mkdirSync(home);
    mkdirSync(workspace);
    const calls = join(directory, "calls.txt");
    // 假的凭据助手：记下每次被问了什么。
    const helper = join(directory, "helper.mjs");
    writeFileSync(
      helper,
      `import { appendFileSync } from "node:fs";
const operation = process.argv[2];
appendFileSync(${JSON.stringify(calls)}, operation + "\\n");
process.stdout.write(JSON.stringify(operation === "catalog" ? [] : { configured: true, search: {} }));`,
    );
    writeFileSync(
      join(home, "kaitu-ai.json"),
      JSON.stringify({ choice: "builtin", provider: "deepseek-official", model: "deepseek-chat" }),
    );
    // 没有 DSH：modules 指向不存在的目录，读服务商列表只会在后台失败。
    const sdk = createSdkRuntime({
      executable: process.execPath,
      modules: join(directory, "missing-dsh"),
      home,
      workspace,
      plugin: join(directory, "plugin.mjs"),
      hostPlugin: join(directory, "host.mjs"),
      helper,
    });
    const first = await sdk.settings();
    const second = await sdk.settings();
    expect(first).toMatchObject({ configured: true, model: "deepseek-chat", saved: [] });
    expect(second.configured).toBe(true);
    expect(readFileSync(calls, "utf8").trim().split("\n")).toEqual(["catalog", "status"]);
    // 改了配置就不能再用旧状态。
    await sdk.configure({ choice: "external" }).catch(() => {});
    await sdk.settings();
    expect(
      readFileSync(calls, "utf8")
        .trim()
        .split("\n")
        .filter((line) => line === "status"),
    ).toHaveLength(2);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
