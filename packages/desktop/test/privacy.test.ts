import { EventEmitter } from "node:events";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  Workspace,
  configureAutomation,
  initWorkspace,
  localStateRoot,
  readPreferences,
  savePreferences,
} from "@kaitu/core";
import { expect, test, vi } from "vitest";
// @ts-expect-error Desktop entry points are shipped as native ESM.
import { startDesktop } from "../local.mjs";
// @ts-expect-error Desktop entry points are shipped as native ESM.
import { PRIVACY_NOTICE_VERSION, showPrivacyNotice } from "../privacy.mjs";

vi.mock("../../cli/dist/ui/server.js", () => ({ startUi: vi.fn() }));
vi.mock("../ai-process.mjs", () => ({ createAiProcess: vi.fn() }));

class NoticeWindow extends EventEmitter {
  webContents = Object.assign(new EventEmitter(), {
    setWindowOpenHandler: vi.fn(),
    executeJavaScript: vi.fn(async () => {}),
  });
  show = vi.fn();
  isDestroyed = () => false;
  url = "";
  loadURL = vi.fn(async (url: string) => {
    this.url = url;
    this.emit("ready-to-show");
  });
  submit(
    action = "acknowledge",
    items = ["storage", "ai", "sync", "location", "connections", "permissions"],
    version = PRIVACY_NOTICE_VERSION,
  ) {
    const url = new URL("https://kaitu.invalid/privacy");
    url.searchParams.set("action", action);
    url.searchParams.set("version", version);
    for (const id of items) url.searchParams.append("item", id);
    const preventDefault = vi.fn();
    this.webContents.emit("will-navigate", { preventDefault }, url.href);
    expect(preventDefault).toHaveBeenCalledOnce();
  }
}

test("逐项确认才保存本机版本，退出、旧版本、只读回看和保存失败不放行", async () => {
  savePreferences({ locale: "en", exploreEntries: ["health"], privacyNoticeVersion: "older" });
  const window = new NoticeWindow();
  const pending = showPrivacyNotice({ window });
  window.submit("acknowledge", ["storage"]);
  expect(readPreferences().privacyNoticeVersion).toBe("older");
  window.submit("acknowledge", undefined, "older");
  expect(readPreferences().privacyNoticeVersion).toBe("older");
  window.submit();
  expect(await pending).toBe(true);
  expect(readPreferences()).toMatchObject({
    locale: "en",
    exploreEntries: ["health"],
    privacyNoticeVersion: PRIVACY_NOTICE_VERSION,
  });
  const returning = new NoticeWindow();
  expect(await showPrivacyNotice({ window: returning })).toBe(true);
  expect(returning.loadURL).not.toHaveBeenCalled();
  const reviewing = new NoticeWindow();
  const review = showPrivacyNotice({ window: reviewing, review: true });
  reviewing.submit("exit");
  expect(await review).toBe(false);
  expect(readPreferences().privacyNoticeVersion).toBe(PRIVACY_NOTICE_VERSION);

  const file = join(localStateRoot(), "preferences.json");
  rmSync(file);
  mkdirSync(file); // atomic rename cannot overwrite a directory
  const blocked = new NoticeWindow();
  const retry = showPrivacyNotice({ window: blocked });
  blocked.submit();
  expect(blocked.webContents.executeJavaScript).toHaveBeenCalledOnce();
  expect(readPreferences().privacyNoticeVersion).toBeUndefined();
  rmSync(file, { recursive: true });
  blocked.submit();
  expect(await retry).toBe(true);
  const persisted = readFileSync(file);
  const closed = new NoticeWindow();
  const cancellation = showPrivacyNotice({ window: closed, review: true });
  closed.emit("closed");
  expect(await cancellation).toBe(false);
  expect(readFileSync(file)).toEqual(persisted);
});

test("旧用户已开启自动任务也须先知悉；退出前不读工作区、不启动服务或 AI", async () => {
  const root = join(process.env.KAITU_APP_HOME as string, "workspace");
  const ws = await initWorkspace(root);
  configureAutomation(ws, { morning: true, organizer: true, news: true });
  savePreferences({ privacyNoticeVersion: "older" });
  mkdirSync(join(process.env.KAITU_APP_HOME as string, "logs"), { recursive: true });
  const config = readFileSync(join(root, ".kaitu/config.json"));
  const reads = vi.spyOn(Workspace.prototype, "readJson");
  const network = vi.spyOn(globalThis, "fetch");
  const { startUi } = await import("../../cli/dist/ui/server.js");
  // @ts-expect-error Native ESM desktop adapter.
  const { createAiProcess } = await import("../ai-process.mjs");
  let window!: NoticeWindow;
  let opened!: () => void;
  const firstScreen = new Promise<void>((resolve) => {
    opened = resolve;
  });
  const app = Object.assign(new EventEmitter(), {
    requestSingleInstanceLock: () => true,
    whenReady: async () => {},
    getPath: () => "/tmp/synthetic-kaitu/Kaitu",
    getPreferredSystemLanguages: () => ["en-US"],
    quit: vi.fn(),
  });
  const startup = startDesktop({
    app,
    BrowserWindow: class extends NoticeWindow {
      constructor() {
        super();
        window = this;
        opened();
      }
    },
  });
  await firstScreen;
  // The constructor returns before startDesktop installs the gate and loads its page.
  await Promise.resolve();
  expect(window.url.startsWith("data:text/html")).toBe(true);
  expect(reads).not.toHaveBeenCalled();
  expect(network).not.toHaveBeenCalled();
  expect(startUi).not.toHaveBeenCalled();
  expect(createAiProcess).not.toHaveBeenCalled();
  window.submit("exit");
  await startup;
  expect(app.quit).toHaveBeenCalledOnce();
  expect(readPreferences().privacyNoticeVersion).toBe("older");
  expect(readFileSync(join(root, ".kaitu/config.json"))).toEqual(config);
  reads.mockRestore();
  network.mockRestore();
});
