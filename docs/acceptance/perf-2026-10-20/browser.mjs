import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { Server } from "node:http";
import inspector from "node:inspector";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";

const [repo, fixture, output] = process.argv.slice(2);
if (!fixture?.startsWith(`${os.tmpdir()}/`) || !process.env.KAITU_PERF_PLAYWRIGHT) {
  throw new Error("temporary fixture and KAITU_PERF_PLAYWRIGHT required");
}
const base = fs.mkdtempSync(path.join(os.tmpdir(), "kaitu-v2-browser-"));
for (const key of [
  "HOME",
  "KAITU_APP_HOME",
  "KAITU_LOCAL_STATE_DIR",
  "XDG_STATE_HOME",
  "LOCALAPPDATA",
  "KAITU_DIR",
]) {
  process.env[key] = path.join(base, key);
  fs.mkdirSync(process.env[key], { recursive: true });
}
fs.cpSync(fixture, process.env.KAITU_DIR, { recursive: true });
fs.mkdirSync(output, { recursive: true });
await delay(2100);
const core = await import(pathToFileURL(path.join(repo, "packages/core/dist/index.js")).href);
const { startUi } = await import(pathToFileURL(path.join(repo, "packages/cli/dist/ui/server.js")).href);
const { chromium } = await import(pathToFileURL(process.env.KAITU_PERF_PLAYWRIGHT).href);
const start = performance.now();
core.savePreferences({ locale: "zh-CN" });
const ws = new core.Workspace(process.env.KAITU_DIR, { deferOverview: true });
const ui = await startUi(ws, { port: 0, open: false });
const serverRequests = [];
const emit = Server.prototype.emit;
if (process.env.KAITU_PERF_SEGMENTS === "1") {
  Server.prototype.emit = function (event, ...args) {
    if (event === "request" && args[0].url?.startsWith("/api/product/")) {
      const row = { url: args[0].url, at: performance.now() };
      serverRequests.push(row);
      args[1].once("finish", () => {
        row.finishedMs = performance.now() - row.at;
      });
    }
    return emit.call(this, event, ...args);
  };
}
const results = {
  at: new Date().toISOString(),
  repo,
  serverReadyMs: performance.now() - start,
  samples: [],
  errors: [],
  serverTimeOrigin: performance.timeOrigin,
  serverRequests,
  head: spawnSync("git", ["-C", repo, "rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim(),
  productPatch: spawnSync(
    "git",
    [
      "-C",
      repo,
      "diff",
      "HEAD",
      "--",
      "packages/core/src/health-page.ts",
      "packages/dsh-plugin/src/client/OverviewPage.tsx",
      "packages/core/src/history.ts",
      "packages/core/src/phone-snapshots.ts",
      "packages/core/src/workspace-watch.ts",
      "packages/core/src/index.ts",
      "packages/cli/src/ui/server.ts",
      "packages/core/package.json",
      "pnpm-lock.yaml",
    ],
    {
      encoding: "utf8",
    },
  ).stdout,
};
let browser;
let page;
let session;
const profilePost = (method) =>
  new Promise((resolve, reject) =>
    session.post(method, (error, value) => (error ? reject(error) : resolve(value))),
  );
try {
  browser = await chromium.launch({
    executablePath: process.env.KAITU_PERF_CHROMIUM ?? "/usr/bin/chromium",
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  results.browser = browser.version();
  page = await browser.newPage({ locale: "zh-CN", viewport: { width: 1440, height: 1000 } });
  page.on("pageerror", (error) => results.errors.push(String(error)));
  await page.addInitScript(() => {
    window.perfClicks = [];
    window.perfNotifications = 0;
    const NativeEventSource = window.EventSource;
    window.EventSource = class extends NativeEventSource {
      constructor(...args) {
        super(...args);
        this.addEventListener("message", () => {
          window.perfNotifications++;
        });
      }
    };
    window.perfFetches = [];
    const originalFetch = window.fetch;
    window.fetch = async (...args) => {
      const request = { url: String(args[0]), at: performance.now() };
      window.perfFetches.push(request);
      try {
        const response = await originalFetch(...args);
        const readJson = response.json.bind(response);
        response.json = async () => {
          const value = await readJson();
          request.bodyMs = performance.now() - request.at;
          return value;
        };
        return response;
      } finally {
        request.headersMs = performance.now() - request.at;
      }
    };
    window.perfLongTasks = [];
    new PerformanceObserver((list) =>
      window.perfLongTasks.push(
        ...list.getEntries().map((e) => ({ start: e.startTime, duration: e.duration })),
      ),
    ).observe({ type: "longtask", buffered: true });
    const ready = (name) => {
      const current = document.querySelector('nav [aria-current="page"]')?.textContent;
      if (name.startsWith("explore-health"))
        return (
          current === "开图" &&
          [...document.querySelectorAll("h2")].some((e) => e.textContent === "最近的训练")
        );
      if (name === "library-first")
        return current === "资料" && document.querySelector('[aria-label="各类资料"] button');
      if (name === "today-warm")
        return current === "今天" && document.querySelector('[aria-label="完成：推进合成项目 1"]');
      if (name === "capture")
        return [...document.querySelectorAll("output")].some((e) => e.textContent.includes("已保存原文"));
      if (name === "complete") return !document.querySelector('[aria-label="完成：推进合成项目 1"]');
      return false;
    };
    const observeContent = () => {
      if (!window.perfFirstContent && document.querySelector('[aria-label="完成：推进合成项目 1"]')) {
        window.perfFirstContent = -1;
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            window.perfFirstContent = performance.now();
          }),
        );
      }
      const item = window.perfClicks.at(-1);
      if (
        item &&
        ["capture", "complete"].includes(item.name) &&
        item.completeMs !== undefined &&
        item.readyForNextMs === undefined &&
        document.querySelector("#capture-text")?.disabled === false
      ) {
        item.readyForNextMs = -1;
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            item.readyForNextMs = performance.now() - item.at;
          }),
        );
      }
      if (item && item.completeMs === undefined && ready(item.name)) {
        item.completeMs = -1;
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            item.completeMs = performance.now() - item.at;
            if (
              ["capture", "complete"].includes(item.name) &&
              document.querySelector("#capture-text")?.disabled === false &&
              item.readyForNextMs === undefined
            )
              item.readyForNextMs = item.completeMs;
          }),
        );
      }
    };
    new MutationObserver(observeContent).observe(document, {
      attributes: true,
      childList: true,
      subtree: true,
    });
    document.addEventListener(
      "pointerdown",
      (e) => {
        const item = { at: performance.now(), target: e.target.textContent, name: window.perfNextName };
        window.perfClicks.push(item);
        const observer = new MutationObserver(() => {
          observer.disconnect();
          requestAnimationFrame(() =>
            requestAnimationFrame(() => {
              item.feedbackMs = performance.now() - item.at;
            }),
          );
        });
        observer.observe(document, { attributes: true, childList: true, subtree: true });
      },
      true,
    );
  });
  await page.goto(ui.url, { waitUntil: "domcontentloaded" });
  results.browserTimeOrigin = await page.evaluate(() => performance.timeOrigin);
  await page.getByRole("button", { name: "完成：推进合成项目 1", exact: true }).waitFor();
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  results.firstContentMs = await page.evaluate(() => window.perfFirstContent);
  results.paint = await page.evaluate(() =>
    performance.getEntriesByType("paint").map((e) => ({ name: e.name, start: e.startTime })),
  );
  await page.screenshot({ path: path.join(output, "today.png"), fullPage: false });
  async function click(name, locator, ready) {
    const before = await page.evaluate((nextName) => {
      window.perfNextName = nextName;
      return window.perfClicks.length;
    }, name);
    await locator.click();
    await ready();
    if (["capture", "complete"].includes(name))
      await page.waitForFunction(() => document.querySelector("#capture-text")?.disabled === false);
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    const data = await page.evaluate(
      (index) => ({
        ...window.perfClicks[index],
        driverObservedMs: performance.now() - window.perfClicks[index].at,
        requests: window.perfFetches.filter((request) => request.at >= window.perfClicks[index].at),
      }),
      before,
    );
    if (!(data.completeMs >= 0)) throw new Error(`missing browser content timestamp: ${name}`);
    results.samples.push({ name, ...data });
    console.log(JSON.stringify(results.samples.at(-1)));
  }
  const nav = page.getByRole("navigation", { name: "主要导航" });
  await click("explore-health-first", nav.getByRole("button", { name: "开图", exact: true }), () =>
    page.getByRole("heading", { name: "最近的训练", exact: true }).waitFor(),
  );
  await page.screenshot({ path: path.join(output, "health.png"), fullPage: false });
  await click("library-first", nav.getByRole("button", { name: "资料", exact: true }), () =>
    page
      .getByRole("region", { name: "各类资料" })
      .getByRole("button", { name: /在做的事/ })
      .waitFor(),
  );
  await page.screenshot({ path: path.join(output, "library.png"), fullPage: false });
  await click("today-warm", nav.getByRole("button", { name: "今天", exact: true }), () =>
    page.getByRole("button", { name: "完成：推进合成项目 1", exact: true }).waitFor(),
  );
  await page.getByLabel("随手记一句", { exact: true }).fill("浏览器 V2 合成原文回读");
  if (process.env.KAITU_PERF_PROFILE === "1") {
    session = new inspector.Session();
    session.connect();
    await profilePost("Profiler.enable");
    await profilePost("Profiler.start");
  }
  await click("capture", page.getByRole("button", { name: "记下", exact: true }), () =>
    page.locator("output").filter({ hasText: "已保存原文" }).waitFor(),
  );
  await click("complete", page.getByRole("button", { name: "完成：推进合成项目 1", exact: true }), () =>
    page.getByRole("button", { name: "完成：推进合成项目 1", exact: true }).waitFor({ state: "detached" }),
  );
  await click("explore-health-warm", nav.getByRole("button", { name: "开图", exact: true }), () =>
    page.getByRole("heading", { name: "最近的训练", exact: true }).waitFor(),
  );
  if (session) {
    const { profile } = await profilePost("Profiler.stop");
    fs.writeFileSync(path.join(output, "journey.cpuprofile"), JSON.stringify(profile));
    session.disconnect();
    session = undefined;
  }
  results.capturePersisted = core
    .inboxNotes(ws)
    .some((note) => note.content.includes("浏览器 V2 合成原文回读"));
  if (!results.capturePersisted) throw new Error("browser capture missing from workspace");
  if (process.env.KAITU_PERF_VERIFY_REFRESH === "1") {
    await nav.getByRole("button", { name: "今天", exact: true }).click();
    await page.getByLabel("随手记一句", { exact: true }).fill("并发外部编辑检查");
    let releaseResponse;
    let readStarted;
    const gate = new Promise((resolve) => {
      releaseResponse = resolve;
    });
    const reading = new Promise((resolve) => {
      readStarted = resolve;
    });
    let held = false;
    await page.route("**/api/product/overview", async (route) => {
      if (held) return route.continue();
      held = true;
      const response = await route.fetch();
      readStarted();
      await gate;
      await route.fulfill({ response });
    });
    try {
      await page.getByRole("button", { name: "记下", exact: true }).click();
      await reading;
      const before = await page.evaluate(() => window.perfNotifications);
      ws.writeText(
        "projects/synthetic-0/STATUS.md",
        ws.readText("projects/synthetic-0/STATUS.md").replace("推进合成项目 0", "V2 外部编辑并发标记"),
      );
      await page.waitForFunction((count) => window.perfNotifications > count, before);
      releaseResponse();
      await page.getByText("V2 外部编辑并发标记", { exact: true }).first().waitFor();
      results.externalDuringRefreshPreserved = true;
    } finally {
      releaseResponse();
      await page.unroute("**/api/product/overview");
    }
  }
  results.requests = await page.evaluate(() => window.perfFetches);
  results.longTasks = await page.evaluate(() => window.perfLongTasks);
  results.completePersisted = fs
    .readFileSync(path.join(ws.root, "projects/synthetic-1/STATUS.md"), "utf8")
    .includes("status: done");
} catch (error) {
  results.failure = String(error);
  if (page) {
    await page.screenshot({ path: path.join(output, "failure.png") });
    results.body = (await page.locator("body").innerText()).slice(0, 8000);
  }
  throw error;
} finally {
  session?.disconnect();
  if (browser) await browser.close();
  await ui.close();
  Server.prototype.emit = emit;
  fs.writeFileSync(path.join(output, "browser.json"), `${JSON.stringify(results, null, 2)}\n`);
}
