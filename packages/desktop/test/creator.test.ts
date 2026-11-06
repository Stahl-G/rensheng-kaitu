import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, vi } from "vitest";
// @ts-expect-error Desktop adapters are native ESM.
import { createCreatorService } from "../creator.mjs";

const bundle = (id = randomUUID()) => ({
  "package.json": JSON.stringify({
    name: `kaitu-created-${id}`,
    version: "1.0.0",
    type: "module",
    exports: { ".": "./index.js", "./client": "./client.js" },
    dsh: { bundle: { patch: "./cordis.patch.yml" }, client: { platform: "web" } },
    kaitu: { explore: { page: "synthetic-page", title: "合成页面", icon: "◇" } },
  }),
  "cordis.patch.yml": `- insert:\n  - name: "kaitu-created-${id}"\n`,
  "index.js": 'throw new Error("Candidate Host code must not run while staging or reviewing");',
  "client.js": 'throw new Error("Candidate Client code must not run while staging or reviewing");',
});

test("草稿跨实例保留，确认后交给既有安装器，失败可重试且安装与后续修改分离", async () => {
  const root = mkdtempSync(join(tmpdir(), "kaitu-creator-"));
  let release: () => void = () => {};
  const install = vi.fn(async (_spec: string) => {});
  const make = () => createCreatorService({ directory: join(root, "creator"), plugins: { install } });
  try {
    const service = make();
    const draft = service.stage(bundle());
    expect(install).not.toHaveBeenCalled();
    expect(make().inspect(draft.id, draft.revision)).toEqual(draft);
    await expect(service.install(draft)).rejects.toThrow("确认安装");
    expect(install).not.toHaveBeenCalled();
    // 模拟现有 beforeChange 拒绝正在生成的会话；不把失败说成已生效。
    install.mockRejectedValueOnce(new Error("回复尚未结束"));
    await expect(service.install({ ...draft, confirmed: true })).rejects.toThrow("回复尚未结束");
    expect(make().inspect(draft.id, draft.revision)).toEqual(draft);
    install.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const pending = service.install({ ...draft, confirmed: true });
    await expect(service.install({ ...draft, confirmed: true })).rejects.toThrow("正在安装");
    const spec = install.mock.calls.at(-1)?.[0] as unknown as string;
    const installed = spec.slice("file:".length);
    expect(readFileSync(join(installed, "index.js"), "utf8")).toBe(draft.files["index.js"]);
    const changed = bundle(draft.id);
    changed["client.js"] = "// revised synthetic page";
    const next = service.stage(changed);
    expect(next.name).toBe(draft.name);
    expect(next.revision).not.toBe(draft.revision);
    writeFileSync(join(draft.source, "client.js"), "// edited during installation");
    release();
    expect(await pending).toMatchObject({ installation: "completed", activation: "unverified" });
    expect(readFileSync(join(installed, "client.js"), "utf8")).toBe(draft.files["client.js"]);
    await expect(service.install({ ...draft, confirmed: true })).rejects.toThrow("源码已改变");
    await make().install({ ...next, confirmed: true });
    expect(install).toHaveBeenLastCalledWith(expect.stringContaining(next.revision));
  } finally {
    release();
    rmSync(root, { recursive: true, force: true });
  }
});

test("生成文件不能逃出受管目录，脚本依赖与源码或安装副本篡改均在安装前拒绝", async () => {
  const root = mkdtempSync(join(tmpdir(), "kaitu-creator-boundary-"));
  const install = vi.fn(async (_spec: string) => {});
  const service = createCreatorService({ directory: join(root, "creator"), plugins: { install } });
  try {
    for (const path of [
      "../outside.js",
      "/outside.js",
      "nested/../../outside.js",
      "nested\\outside.js",
      ".npmrc",
      "node_modules/payload.js",
      "NODE_MODULES/payload.js",
      "CON.txt",
      "assets/NUL",
      "assets/file.",
    ])
      expect(() => service.stage({ ...bundle(), [path]: "synthetic" })).toThrow();
    for (const extra of [{ scripts: { prepare: "node index.js" } }, { dependencies: { unknown: "*" } }]) {
      const files = bundle();
      files["package.json"] = JSON.stringify({ ...JSON.parse(files["package.json"]), ...extra });
      expect(() => service.stage(files)).toThrow("安装脚本或依赖");
    }
    expect(existsSync(join(root, "outside.js"))).toBe(false);
    const draft = service.stage(bundle());
    await expect(service.install({ ...draft, id: "../../outside", confirmed: true })).rejects.toThrow();
    const target = join(draft.source, "index.js");
    rmSync(target);
    symlinkSync(join(root, "outside.js"), target);
    await expect(service.install({ ...draft, confirmed: true })).rejects.toThrow("符号链接");
    expect(install).not.toHaveBeenCalled();
    rmSync(target);
    writeFileSync(target, draft.files["index.js"]);
    await service.install({ ...draft, confirmed: true });
    const spec = install.mock.calls[0][0];
    writeFileSync(join(spec.slice("file:".length), "index.js"), "// altered installed source");
    await expect(service.install({ ...draft, confirmed: true })).rejects.toThrow("安装副本已改变");
    expect(install).toHaveBeenCalledTimes(1);
    const redirected = join(root, "redirected");
    symlinkSync(root, redirected, "junction");
    const unsafe = createCreatorService({ directory: redirected, plugins: { install } });
    expect(() => unsafe.stage(bundle())).toThrow("符号链接");
    expect(existsSync(join(root, "drafts"))).toBe(false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
import { randomUUID } from "node:crypto";
