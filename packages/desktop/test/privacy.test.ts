import { EventEmitter } from "node:events";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
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
  destroyed = false;
  contents = Object.assign(new EventEmitter(), {
    isDestroyed: () => this.destroyed,
    setWindowOpenHandler: vi.fn(),
    executeJavaScript: vi.fn(async () => {}),
  });
  get webContents() {
    if (this.destroyed) throw new TypeError("Object has been destroyed");
    return this.contents;
  }
  elements = new Map<string, EventTarget & { hidden: boolean }>();
  show = vi.fn();
  isDestroyed = () => this.destroyed;
  url = "";
  loadURL = vi.fn(async (url: string) => {
    this.url = url;
    const html = decodeURIComponent(url.slice(url.indexOf(",") + 1));
    this.elements = new Map(
      ["h1", ".content", "select", ...Array.from(html.matchAll(/id="([^"]+)"/g), ([, id]) => `#${id}`)].map(
        (id) => [id, Object.assign(new EventTarget(), { hidden: false, focus() {}, scrollTop: 0 })],
      ),
    );
    const document = {
      documentElement: { lang: "en" },
      querySelector: (selector: string) => this.elements.get(selector) ?? null,
      getElementById: (id: string) => this.elements.get(`#${id}`) ?? null,
    };
    runInNewContext(html.match(/<script>([\s\S]*)<\/script>/)?.[1] ?? "", {
      document,
      location: { hash: "" },
      addEventListener() {},
    });
    this.emit("ready-to-show");
  });
  openPolicy(id = "policy-link") {
    const event = new Event("click", { cancelable: true });
    this.elements.get(`#${id}`)?.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(this.elements.get("#policy")?.hidden).toBe(id === "back");
  }
  destroy() {
    this.destroyed = true;
    this.emit("closed");
  }
  submit(action = "acknowledge", version = PRIVACY_NOTICE_VERSION) {
    const url = new URL("https://kaitu.invalid/privacy");
    url.searchParams.set("action", action);
    url.searchParams.set("version", version);
    const preventDefault = vi.fn();
    this.webContents.emit("will-navigate", { preventDefault }, url.href);
    expect(preventDefault).toHaveBeenCalledOnce();
  }
}

test("开始使用才保存本机已读版本；阅读政策、旧版本、回看和保存失败不放行", async () => {
  savePreferences({ locale: "en", exploreEntries: ["health"], privacyNoticeVersion: "older" });
  const window = new NoticeWindow();
  const pending = showPrivacyNotice({ window });
  let completed = false;
  void pending.then(() => {
    completed = true;
  });
  window.openPolicy();
  window.openPolicy("back");
  const blockedNavigation = { preventDefault: vi.fn() };
  window.webContents.emit("will-navigate", blockedNavigation, "https://outside.example/");
  expect(blockedNavigation.preventDefault).toHaveBeenCalledOnce();
  await Promise.resolve();
  expect(completed).toBe(false);
  expect(readPreferences().privacyNoticeVersion).toBe("older");
  window.submit("acknowledge", "older");
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
  reviewing.submit("close");
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
  expect(() => closed.destroy()).not.toThrow();
  expect(await cancellation).toBe(false);
  expect(readFileSync(file)).toEqual(persisted);
  const closing = new NoticeWindow();
  closing.loadURL = vi.fn(async () => {
    closing.destroy();
    throw new Error("ERR_ABORTED");
  });
  expect(await showPrivacyNotice({ window: closing, review: true })).toBe(false);
});

test("旧用户已开启自动任务仍可先读完整政策；关闭前不读工作区、不启动服务或 AI", async () => {
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
  window.openPolicy();
  await Promise.resolve();
  expect(readPreferences().privacyNoticeVersion).toBe("older");
  expect(reads).not.toHaveBeenCalled();
  expect(network).not.toHaveBeenCalled();
  expect(startUi).not.toHaveBeenCalled();
  expect(createAiProcess).not.toHaveBeenCalled();
  expect(() => window.destroy()).not.toThrow();
  await startup;
  expect(app.quit).toHaveBeenCalledOnce();
  expect(readPreferences().privacyNoticeVersion).toBe("older");
  expect(readFileSync(join(root, ".kaitu/config.json"))).toEqual(config);
  reads.mockRestore();
  network.mockRestore();
});
