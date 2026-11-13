import { execFileSync, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it } from "vitest";
import {
  assertScheduleCompatible,
  backupStateRoot,
  prepareDshState,
  restoreDshState,
  stateInventory,
} from "../state-backup.mjs";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "kaitu-dsh-backup-"));
  roots.push(root);
  const state = join(root, "state");
  for (const [path, contents] of [
    [
      "storages/schedule.json",
      JSON.stringify({ unit: { name: "schedule", version: 1 }, global: null, tables: { tasks: {} } }),
    ],
    [
      "ai/storages/schedule.json",
      JSON.stringify({ unit: { name: "schedule", version: 1 }, global: null, tables: { tasks: {} } }),
    ],
    ["profiles/desktop/cordis.patch.yml", "[]\n"],
    ["profiles/.DS_Store", "synthetic ordinary metadata"],
    ["credentials/synthetic.json", '{"value":"synthetic-only"}'],
    ["sessions/nested/session.jsonl", '{"id":"synthetic"}\n'],
    ["unknown/future.bin", "\x00\x01future-state"],
  ]) {
    mkdirSync(dirname(join(state, path)), { recursive: true });
    writeFileSync(join(state, path), contents);
  }
  return { root, state };
}

it("backs up the complete old state once, before writes, and restores into a verified fresh directory", () => {
  const { root, state } = fixture();
  if (process.platform !== "win32") symlinkSync("../sessions", join(state, "unknown/link"));
  const before = stateInventory(state);
  const backup = prepareDshState(state, "0.2.2-rc.1");
  expect(stateInventory(join(backup, "state"))).toEqual(before);
  writeFileSync(
    join(state, "storages/schedule.json"),
    JSON.stringify({ unit: { name: "schedule", version: 2 }, global: null, tables: { tasks: {} } }),
  );
  expect(prepareDshState(state, "0.2.2-rc.1")).toBe(backup);
  expect(backupStateRoot(join(state, "ai"), state)).toBe(state);
  expect(() => backupStateRoot(join(root, "unrelated"), state)).toThrow();
  expect(prepareDshState(backupStateRoot(join(state, "ai"), state), "0.2.2-rc.1")).toBe(backup);
  const restored = restoreDshState(backup, join(root, "restored"));
  expect(stateInventory(restored)).toEqual(before);
  expect(() => assertScheduleCompatible(restored, "0.2.1-rc.3")).not.toThrow();
  expect(() => assertScheduleCompatible(state, "0.2.1-rc.3")).toThrow();
  expect(() => restoreDshState(backup, state)).toThrow();
  writeFileSync(join(backup, "state/unknown/future.bin"), "tampered");
  expect(() => restoreDshState(backup, join(root, "broken-restore"))).toThrow();
  expect(() => prepareDshState(state, "0.2.2-rc.1")).toThrow();
  expect(existsSync(join(root, "broken-restore"))).toBe(false);
});

it("refuses v2 without an older backup, malformed state and incomplete backup receipts without modifying the source", () => {
  const { state } = fixture();
  for (const contents of [
    JSON.stringify({ unit: { name: "schedule", version: 2 }, global: null, tables: { tasks: {} } }),
    "{broken",
  ]) {
    writeFileSync(join(state, "ai/storages/schedule.json"), contents);
    const before = stateInventory(state);
    expect(() => prepareDshState(state, "0.2.2-rc.1")).toThrow();
    expect(stateInventory(state)).toEqual(before);
  }
  writeFileSync(
    join(state, "ai/storages/schedule.json"),
    JSON.stringify({ unit: { name: "schedule", version: 1 }, global: null, tables: { tasks: {} } }),
  );
  writeFileSync(
    join(state, "dsh-upgrade.json"),
    JSON.stringify({ version: 1, backup: "missing", sha256: "synthetic" }),
  );
  const before = stateInventory(state);
  expect(() => prepareDshState(state, "0.2.2-rc.1")).toThrow();
  expect(stateInventory(state)).toEqual(before);
});

it("a backup write failure prevents native initialization and direct Electron host loading", () => {
  const { root, state } = fixture();
  writeFileSync(`${state}.backups`, "synthetic blocked backup destination");
  const resources = join(root, "Resources");
  mkdirSync(join(resources, "kaitu/dist"), { recursive: true });
  mkdirSync(join(resources, "app/lib"), { recursive: true });
  const source = fileURLToPath(new URL("..", import.meta.url));
  for (const [from, to] of [
    ["payload-loader.mjs", "kaitu-loader.mjs"],
    ["state-backup.mjs", "kaitu-state-backup.mjs"],
    ["backup-progress.mjs", "kaitu-backup-progress.mjs"],
    ["bootstrap.mjs", "app/bootstrap.mjs"],
    ["environment.mjs", "app/kaitu-environment.mjs"],
  ])
    cpSync(join(source, from), join(resources, to));
  const marker = join(root, "unexpected-writer");
  const writer = `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'started');`;
  writeFileSync(join(resources, "kaitu/dist/initialize.mjs"), writer);
  writeFileSync(join(resources, "app/lib/main.js"), writer);
  const mockElectron = join(resources, "app/node_modules/electron");
  mkdirSync(mockElectron, { recursive: true });
  writeFileSync(join(mockElectron, "package.json"), '{"type":"module","exports":"./index.mjs"}');
  writeFileSync(
    join(mockElectron, "index.mjs"),
    `
export const BrowserWindow = {}, Menu = {}, shell = {};
export const app = { setName() {}, whenReady: async () => {}, exit() {} };
export const dialog = { showErrorBox() { console.log('synthetic-error-presented'); } };
`,
  );
  const env = {
    ...process.env,
    HOME: join(root, "home"),
    KAITU_APP_HOME: state,
    DSH_HOME: state,
    KAITU_DIR: join(root, "workspace"),
    KAITU_LOCAL_STATE_DIR: join(root, "local"),
    KAITU_BACKUP_ROOT: "",
    KAITU_EMBEDDED_AI: "1",
    ELECTRON_RUN_AS_NODE: "1",
  };
  const before = stateInventory(state);
  execFileSync(process.execPath, [join(resources, "kaitu-loader.mjs")], { env, stdio: "pipe" });
  expect(existsSync(marker)).toBe(false);
  try {
    execFileSync(process.execPath, [join(resources, "app/bootstrap.mjs")], { env, stdio: "pipe" });
    throw new Error("Bootstrap should exit");
  } catch (error) {
    expect(error.status).toBe(1);
    expect(error.stdout.toString()).toContain("synthetic-error-presented");
  }
  expect(existsSync(marker)).toBe(false);
  expect(stateInventory(state)).toEqual(before);
});

it("blocks external state links and custom storage but preserves readonly files and relative internal links", () => {
  const { root, state } = fixture();
  const config = join(state, "profiles/desktop/cordis.patch.yml");
  writeFileSync(config, "- id: storage-json\n  config:\n    root: /synthetic-other-home\n");
  expect(() => prepareDshState(state, "0.2.2-rc.1")).toThrow();
  writeFileSync(config, "[]\n");
  if (process.platform !== "win32") {
    symlinkSync(root, join(state, "external"));
    const before = stateInventory(state);
    expect(() => prepareDshState(state, "0.2.2-rc.1")).toThrow();
    expect(stateInventory(state)).toEqual(before);
    rmSync(join(state, "external"));
    symlinkSync(join(state, "sessions"), join(state, "absolute-internal"));
    expect(() => prepareDshState(state, "0.2.2-rc.1")).toThrow();
    rmSync(join(state, "absolute-internal"));
  }
  chmodSync(join(state, "unknown/future.bin"), 0o400);
  const before = stateInventory(state);
  const backup = prepareDshState(state, "0.2.2-rc.1");
  expect(stateInventory(restoreDshState(backup, join(root, "readonly-restored")))).toEqual(before);
});

it("two first launches publish only one checkpoint and never replace the original snapshot", async () => {
  const { root, state } = fixture();
  writeFileSync(join(state, "unknown/concurrency.bin"), Buffer.alloc(2 * 1024 * 1024, 37));
  const before = stateInventory(state);
  const entry = join(root, "start.mjs");
  writeFileSync(
    entry,
    `import { prepareDshState } from ${JSON.stringify(new URL("../state-backup.mjs", import.meta.url).href)};
try { console.log(prepareDshState(${JSON.stringify(state)}, '0.2.2-rc.1')); } catch { process.exitCode=2; }`,
  );
  const run = () =>
    new Promise<{ code: number; output: string }>((resolve) => {
      const child = spawn(process.execPath, [entry], { stdio: ["ignore", "pipe", "pipe"] });
      let output = "";
      child.stdout.on("data", (data) => {
        output += data;
      });
      child.on("exit", (code) => resolve({ code, output: output.trim() }));
    });
  const results = await Promise.all([run(), run()]);
  expect(results.some((result) => result.code === 0)).toBe(true);
  const checkpoint = results.find((result) => result.code === 0)?.output;
  if (!checkpoint) throw new Error("No backup checkpoint");
  expect(stateInventory(join(checkpoint, "state"))).toEqual(before);
  const complete = readdirSync(`${state}.backups`).filter((name) => !name.startsWith("."));
  expect(complete).toEqual([basename(checkpoint)]);
  expect(prepareDshState(state, "0.2.2-rc.1")).toBe(checkpoint);
});

it("reports real backup stages and repeats validation on restart without inventing copy progress", () => {
  const { state } = fixture();
  const events: { phase: string; completed?: number; total?: number }[] = [];
  const backup = prepareDshState(state, "0.2.2-rc.1", { progress: (event) => events.push(event) });
  expect(events[0].phase).toBe("check");
  expect(events.map((event) => event.phase)).toContain("verify");
  expect(events.at(-1)?.phase).toBe("publish");
  const copies = events.filter((event) => event.phase === "copy");
  expect(copies.length).toBeGreaterThan(0);
  expect(copies.every((event, index) => event.completed === index && event.total === copies.length)).toBe(
    true,
  );
  events.length = 0;
  expect(prepareDshState(state, "0.2.2-rc.1", { progress: (event) => events.push(event) })).toBe(backup);
  expect(events.map((event) => event.phase)).toEqual(["check"]);
});

it("a failed progress observer stops preflight and releases its lock for a safe retry", () => {
  const { state } = fixture();
  const before = stateInventory(state);
  expect(() =>
    prepareDshState(state, "0.2.2-rc.1", {
      progress: ({ phase }) => {
        if (phase === "copy") throw new Error("progress process lost");
      },
    }),
  ).toThrow("progress process lost");
  expect(stateInventory(state)).toEqual(before);
  expect(existsSync(join(state, "dsh-upgrade.json"))).toBe(false);
  expect(existsSync(`${state}.backups/upgrade.lock`)).toBe(false);
  expect(prepareDshState(state, "0.2.2-rc.1")).toBeTruthy();
});

it("requires a ready progress window before backup and cleans up on no-progress or failed startup", async () => {
  const { root, state } = fixture();
  const source = fileURLToPath(new URL("..", import.meta.url));
  cpSync(join(source, "state-backup.mjs"), join(root, "kaitu-state-backup.mjs"));
  cpSync(join(source, "backup-progress.mjs"), join(root, "backup-progress.mjs"));
  const { prepareWithProgress } = await import(join(root, "backup-progress.mjs"));
  type Progress = { phase?: string; done?: boolean };
  const events: Progress[] = [];
  const launch = (ready: boolean) => () => {
    const child = new EventEmitter() as EventEmitter & {
      pid: number;
      connected: boolean;
      send: (message: Progress, callback: () => void) => void;
      kill: () => boolean;
    };
    child.pid = process.pid;
    child.connected = true;
    child.send = (message: Progress, callback: () => void) => {
      events.push(message);
      callback();
      if (message.done) {
        child.connected = false;
        queueMicrotask(() => child.emit("exit", 0));
      }
    };
    child.kill = () => child.emit("exit", 1);
    if (ready) queueMicrotask(() => child.emit("message", { ready: true }));
    return child;
  };
  await expect(
    prepareWithProgress(state, "0.2.2-rc.1", { launch: launch(false), timeoutMs: 10 }),
  ).rejects.toThrow("未就绪");
  expect(existsSync(join(state, "dsh-upgrade.json"))).toBe(false);
  events.length = 0;
  await expect(prepareWithProgress(state, "0.2.2-rc.1", { launch: launch(true) })).resolves.toBeTruthy();
  expect(events.some((event) => event.phase === "copy")).toBe(true);
  expect(events.at(-1)).toEqual({ done: true });
});

it("bounds cleanup even when the progress process ignores both termination signals", async () => {
  const { root, state } = fixture();
  const source = fileURLToPath(new URL("..", import.meta.url));
  cpSync(join(source, "state-backup.mjs"), join(root, "kaitu-state-backup.mjs"));
  cpSync(join(source, "backup-progress.mjs"), join(root, "backup-progress.mjs"));
  const { prepareWithProgress } = await import(join(root, "backup-progress.mjs"));
  const signals: string[] = [];
  let detached = false;
  let profile = "";
  const child = Object.assign(new EventEmitter(), {
    connected: true,
    send() {},
    kill(signal: string) {
      signals.push(signal);
    },
    disconnect() {
      this.connected = false;
    },
    unref() {
      detached = true;
    },
  });
  const pending = prepareWithProgress(state, "0.2.2-rc.1", {
    launch: (_exe: string, _args: string[], options: { env: { KAITU_PROGRESS_PROFILE: string } }) => {
      profile = options.env.KAITU_PROGRESS_PROFILE;
      roots.push(profile);
      return child;
    },
    timeoutMs: 5,
    stopTimeoutMs: 5,
  });
  await expect(pending).rejects.toThrow("无法退出");
  expect(signals).toEqual(["SIGTERM", "SIGKILL"]);
  expect(detached).toBe(true);
  expect(existsSync(profile)).toBe(true);
  expect(existsSync(join(state, "dsh-upgrade.json"))).toBe(false);
});

it("observes parent disconnection while the progress page is still loading", async () => {
  const { root } = fixture();
  const source = fileURLToPath(new URL("..", import.meta.url));
  cpSync(join(source, "state-backup.mjs"), join(root, "kaitu-state-backup.mjs"));
  cpSync(join(source, "backup-progress.mjs"), join(root, "backup-progress.mjs"));
  const { showBackupProgress } = await import(join(root, "backup-progress.mjs"));
  const exits: number[] = [];
  const messages: unknown[] = [];
  const channel = Object.assign(new EventEmitter(), {
    env: { KAITU_PROGRESS_PROFILE: root },
    connected: true,
    send(message: unknown) {
      messages.push(message);
    },
  });
  let finishLoad: () => void = () => {};
  let startedLoad: () => void = () => {};
  const loading = new Promise<void>((resolve) => {
    startedLoad = resolve;
  });
  class Window {
    setMenu() {}
    loadURL() {
      startedLoad();
      return new Promise<void>((resolve) => {
        finishLoad = resolve;
      });
    }
  }
  const app = {
    setPath() {},
    whenReady: async () => {},
    exit(code: number) {
      exits.push(code);
    },
  };
  const pending = showBackupProgress({ app, BrowserWindow: Window }, channel);
  await loading;
  channel.connected = false;
  channel.emit("disconnect");
  expect(exits).toEqual([1]);
  finishLoad();
  await pending;
  expect(messages).toEqual([]);
});
