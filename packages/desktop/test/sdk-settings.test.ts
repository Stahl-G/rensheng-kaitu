import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
// @ts-expect-error Desktop entry points are shipped as native ESM.
const { createSdkRuntime } = await import("../sdk-runtime.mjs");

test("连接状态不启动 SDK 或读目录，保存后失效；显式目录失败不伪装空列表", async () => {
  const root = mkdtempSync(join(tmpdir(), "kaitu-sdk-settings-"));
  const home = join(root, "app");
  const workspace = join(root, "workspace");
  mkdirSync(home);
  mkdirSync(workspace);
  const helper = join(root, "credentials.mjs");
  const calls = join(root, "calls.jsonl");
  writeFileSync(
    helper,
    `import {appendFileSync} from 'node:fs';
for await (const chunk of process.stdin) {}
appendFileSync(${JSON.stringify(calls)}, JSON.stringify(process.argv[2])+'\\n');
process.stdout.write(process.argv[2] === 'catalog' ? '[]' : '{"configured":true}');`,
  );
  writeFileSync(
    join(home, "kaitu-ai.json"),
    JSON.stringify({
      choice: "builtin",
      provider: "deepseek-official",
      model: "synthetic",
      supportsImages: false,
    }),
  );
  const sdk = createSdkRuntime({
    executable: process.execPath,
    archive: root,
    home,
    workspace,
    plugin: join(root, "plugin"),
    hostPlugin: join(root, "host"),
    helper,
  });
  try {
    expect((await sdk.settings()).configured).toBe(true);
    expect((await sdk.settings()).configured).toBe(true);
    expect(readFileSync(calls, "utf8").trim().split("\n")).toEqual(['"status"']);
    // No SDK modules exist here: only the explicit catalogue may try to load them.
    await expect(sdk.catalogSettings(true)).rejects.toThrow();
    expect((await sdk.settings()).configured).toBe(true);
    await sdk.configure({ choice: "external", provider: "deepseek-official", model: "synthetic" });
    expect((await sdk.settings()).configured).toBe(false);
  } finally {
    await sdk.closeSupport();
    rmSync(root, { recursive: true, force: true });
  }
});
