import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  watch,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, test, vi } from "vitest";
// @ts-expect-error Desktop adapters are native ESM.
import { pageBundle } from "../creator-generation.mjs";
// @ts-expect-error Desktop adapters are native ESM.
import { createCreatorService } from "../creator.mjs";
// @ts-expect-error Desktop adapters are native ESM.
import { createDesktopCreator, startDesktopAutomation } from "../local.mjs";
// @ts-expect-error Desktop adapters are native ESM.
import { createPluginService } from "../plugins.mjs";

const answer = JSON.stringify({
  title: "合成页面",
  description: "合成内容",
  icon: "M4 4h16v16H4z",
  code: "function Page() { return h('p', null, 'Synthetic'); }",
});
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "kaitu-creator-install-"));
  const home = join(root, "home");
  const runtime = join(root, "runtime");
  const archive = join(root, "archive");
  const cli = createRequire(new URL("../../cli/package.json", import.meta.url));
  const dsh = createRequire(cli.resolve("@deepseek-ai/dsh/package.json"));
  const modules = join(archive, "dsh/node_modules/@deepseek-ai");
  mkdirSync(modules, { recursive: true });
  for (const name of ["dsh", "dsh-app-boot"])
    symlinkSync(dirname(dsh.resolve(`@deepseek-ai/${name}/package.json`)), join(modules, name), "junction");
  const old = join(root, "old");
  mkdirSync(old);
  const files = pageBundle("existing", answer);
  for (const [file, contents] of Object.entries(files)) {
    mkdirSync(dirname(join(old, file)), { recursive: true });
    writeFileSync(join(old, file), contents as string);
  }
  for (const profile of ["desktop", "sdk"]) {
    const directory = join(home, "profiles", profile);
    mkdirSync(join(directory, "node_modules"), { recursive: true });
    cpSync(old, join(directory, "node_modules/existing"), { recursive: true });
    writeFileSync(
      join(directory, "package.json"),
      JSON.stringify({
        dependencies: { existing: `file:${old}` },
        dsh: { profile: { bundles: ["existing"] } },
      }),
    );
  }
  mkdirSync(join(runtime, "node/bin"), { recursive: true });
  mkdirSync(join(runtime, "pnpm/bin"), { recursive: true });
  symlinkSync(
    process.execPath,
    join(runtime, process.platform === "win32" ? "node/bin/node.exe" : "node/bin/node"),
  );
  writeFileSync(
    join(runtime, "pnpm/bin/pnpm.cjs"),
    `const fs=require('node:fs'),p=require('node:path');
const args=process.argv.slice(2),cwd=process.cwd(),root=${JSON.stringify(root)},file=p.join(cwd,'package.json');
fs.appendFileSync(p.join(root,'calls'),JSON.stringify({profile:p.basename(cwd),args})+'\\n');
const data=JSON.parse(fs.readFileSync(file));
if(args[0]==='add'&&fs.existsSync(p.join(root,'hold'))){fs.writeFileSync(p.join(root,'adding'),'');while(fs.existsSync(p.join(root,'hold')))Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10);}
if(args[0]==='add'){const src=args[1].slice(5),pkg=JSON.parse(fs.readFileSync(p.join(src,'package.json')));data.dependencies[pkg.name]=args[1];fs.cpSync(src,p.join(cwd,'node_modules',pkg.name),{recursive:true});fs.writeFileSync(file,JSON.stringify(data));if(p.basename(cwd)==='sdk'&&fs.existsSync(p.join(root,'fail'))){console.error('ERR_synthetic_install');process.exit(1);}}
if(args[0]==='remove'){delete data.dependencies[args[1]];fs.rmSync(p.join(cwd,'node_modules',args[1]),{recursive:true,force:true});fs.writeFileSync(file,JSON.stringify(data));}
if(args[0]==='install'&&fs.existsSync(p.join(root,'repair-fail'))){console.error('ERR_synthetic_recovery');process.exit(1);}
if(args[0]==='install'){fs.rmSync(p.join(cwd,'node_modules'),{recursive:true,force:true});for(const [name,spec] of Object.entries(data.dependencies)){fs.cpSync(spec.slice(5),p.join(cwd,'node_modules',name),{recursive:true});}}
`,
  );
  const before = vi.fn(async () => {});
  const after = vi.fn(async () => {});
  const plugins = createPluginService({ home, runtime, archive, beforeChange: before, onChanged: after });
  const creator = createCreatorService({ directory: join(root, "creator"), plugins });
  const draft = () => creator.stage(pageBundle(creator.identity().name, answer));
  const manifests = () =>
    ["desktop", "sdk"].map((profile) =>
      readFileSync(join(home, "profiles", profile, "package.json"), "utf8"),
    );
  return { root, home, before, after, plugins, creator, draft, manifests };
}

test("主进程等生成关闭；不同作品和市场变更共用协调，确认后双 profile 安装、停启和移除", async () => {
  const f = fixture();
  let release = () => {};
  try {
    const first = f.draft();
    const second = f.draft();
    let emit: (event: unknown) => void = () => {};
    const child = {
      create: async () => ({ id: "synthetic" }),
      subscribe: (_id: string, listener: typeof emit) => {
        emit = listener;
        return () => {};
      },
      events: () => [
        { type: "assistant/message", data: { message: { content: [{ type: "text", text: answer }] } } },
      ],
      send: async () => ({}),
      close: async () => {},
      cancel: async () => {},
    };
    const request = createDesktopCreator({
      directory: join(f.root, "creator"),
      plugins: f.plugins,
      ask: { settings: async () => ({ configured: true, backend: "dsh" }), background: () => child },
      notify: () => {},
    });
    await request("generate", JSON.stringify({ prompt: "合成需求" }));
    await expect(request("install", JSON.stringify({ ...first, confirmed: true }))).rejects.toThrow();
    expect(f.before).not.toHaveBeenCalled();
    emit({ type: "session.status", data: { status: "idle" } });
    const adding = new Promise<void>((resolve) => {
      const watcher = watch(f.root, () => {
        if (existsSync(join(f.root, "adding"))) {
          watcher.close();
          resolve();
        }
      });
    });
    writeFileSync(join(f.root, "hold"), "synthetic");
    release = () => rmSync(join(f.root, "hold"), { force: true });
    const installing = f.creator.install({ ...first, confirmed: true });
    await adding;
    const settings = { asked: true, tasks: { morning: false } };
    const ai = { open: vi.fn(async () => {}) };
    const automatic = () => startDesktopAutomation(f.plugins, ai, settings);
    f.after.mockImplementation(automatic);
    await automatic();
    settings.tasks.morning = true;
    await expect(f.creator.install({ ...second, confirmed: true })).rejects.toThrow("插件正在变更");
    await expect(f.plugins.install("market-synthetic")).rejects.toThrow("插件正在变更");
    await expect(f.plugins.remove("existing")).rejects.toThrow("插件正在变更");
    await expect(automatic()).rejects.toThrow("插件正在变更");
    expect(ai.open).not.toHaveBeenCalled();
    let settled = false;
    const waiting = f.plugins.settled().then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    release();
    await installing;
    await waiting;
    expect(ai.open).toHaveBeenCalledTimes(1);
    settings.tasks.morning = false;
    expect(f.plugins.state(first.name)).toMatchObject({ installed: true, enabled: true, incomplete: false });
    expect(f.plugins.explore().some((page: { name: string }) => page.name === first.name)).toBe(true);
    await f.plugins.setEnabled(first.name, false);
    expect(f.plugins.explore().some((page: { name: string }) => page.name === first.name)).toBe(false);
    await f.plugins.setEnabled(first.name, true);
    await f.plugins.remove(first.name);
    expect(f.plugins.state("existing").installed).toBe(true);
    expect(f.plugins.state(first.name).installed).toBe(false);
    expect(ai.open).toHaveBeenCalledTimes(1);
  } finally {
    release();
    await f.plugins.settled().catch(() => {});
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("拒绝、SDK 中途失败和停引擎期间的源码变更均保留现有插件，未确认不运行 Host", async () => {
  const f = fixture();
  try {
    const draft = f.draft();
    const before = f.manifests();
    await expect(f.creator.install(draft)).rejects.toThrow();
    expect(f.before).not.toHaveBeenCalled();
    writeFileSync(join(f.root, "fail"), "synthetic");
    await expect(f.creator.install({ ...draft, confirmed: true })).rejects.toThrow("ERR_synthetic_install");
    expect(f.manifests()).toEqual(before);
    for (const profile of ["desktop", "sdk"]) {
      expect(existsSync(join(f.home, "profiles", profile, "node_modules", draft.name))).toBe(false);
      expect(readFileSync(join(f.home, "profiles", profile, "node_modules/existing/client.js"), "utf8")).toBe(
        readFileSync(join(f.root, "old/client.js"), "utf8"),
      );
    }
    rmSync(join(f.root, "fail"));
    f.before.mockImplementationOnce(async () => {
      writeFileSync(
        join(f.root, "creator/packages", draft.id, draft.revision, "client.js"),
        "// modified while stopping",
      );
    });
    const calls = readFileSync(join(f.root, "calls"), "utf8");
    await expect(f.creator.install({ ...draft, confirmed: true })).rejects.toThrow("安装源码已改变");
    expect(f.manifests()).toEqual(before);
    const added = readFileSync(join(f.root, "calls"), "utf8").slice(calls.length);
    expect(added).not.toContain('"add"');
    writeFileSync(join(f.root, "fail"), "synthetic");
    writeFileSync(join(f.root, "repair-fail"), "synthetic");
    const resumed = f.after.mock.calls.length;
    await expect(f.creator.install({ ...f.draft(), confirmed: true })).rejects.toThrow("引擎保持停止");
    const ai = { open: vi.fn() };
    await expect(
      startDesktopAutomation(f.plugins, ai, { asked: true, tasks: { morning: true } }),
    ).rejects.toThrow("引擎保持停止");
    expect(ai.open).not.toHaveBeenCalled();
    expect(f.after).toHaveBeenCalledTimes(resumed);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});
