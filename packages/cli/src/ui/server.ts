import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { type FSWatcher, existsSync, readFileSync, watch } from "node:fs";
import { type IncomingMessage, type ServerResponse, createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { PhoneService } from "@kaitu/channels";
import { CollectorService } from "@kaitu/channels/collectors";
import { startPhoneSnapshots } from "@kaitu/core";
import {
  type CalendarExecutor,
  CalendarPush,
  type ImportSource,
  KaituError,
  MAX_PHOTO_BYTES,
  type Pose,
  type Workspace,
  addPhotoBytes,
  assetsRoot,
  calendarPushEntries,
  calendarPushStore,
  cancelGithubCliLogin,
  completeNext,
  completeTask,
  decideProposal,
  deferSnapshots,
  disableSync,
  discardUpload,
  dshFiles,
  enableSync,
  externalHealthPaths,
  history,
  holdOverview,
  ignoredWorkspaceChange,
  importUpload,
  invalidateHistoryFile,
  onboardingStatus,
  pendingWorkspaceFiles,
  processInbox,
  pullCalendarSubscriptions,
  readPhoto,
  readWorkbench,
  refreshOverview,
  removeMemory,
  removePhoto,
  restore,
  snapshotNow,
  stageUpload,
  startWorkspaceBackup,
  subscribeOrganizer,
  syncProject,
  syncProjects,
  syncStatus,
  workspaceFileStamps,
} from "@kaitu/core";
import { dshCommand } from "../dsh.js";
import type { AskService } from "./ask.js";
import { browserAsk } from "./browser-ask.js";
import { phoneAnswer } from "./phone-answer.js";
import { planMutations, productMutations, productRequest } from "./product.js";

export interface UiOptions {
  port?: number;
  open?: boolean;
  snapshotDelayMs?: number;
  versionDelayMs?: number;
  refreshDelayMs?: number;
  inboxStableMs?: number;
  webRoot?: string;
  collectorStateRoot?: string;
  ask?: AskService;
  calendarExecutor?: CalendarExecutor;
  onWorkspaceChanging?: () => Promise<void>;
  onWorkspaceChanged?: () => Promise<void>;
  onAutomationChanged?: () => Promise<void>;
  openAi?: () => Promise<{ url?: string }>;
  pickDirectory?: () => Promise<string | null>;
  desktopUpdate?: (action: string) => Promise<unknown>;
  /** 开图 App 的插件：list、install、remove、open（打开 DSH 窗口里的插件页面）。 */
  plugins?: (action: string, input?: string) => Promise<unknown>;
  systemLocale?: string;
}
const PRODUCT_ROOT = fileURLToPath(new URL("../../../dsh-plugin/dist/standalone/", import.meta.url));
const LEGACY_ROOT = fileURLToPath(new URL("../../../web/dist/", import.meta.url));
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
};
const MAX_UPLOAD = 512 * 1024 * 1024;
const MAX_JSON = 16 * 1024;

async function body(req: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new KaituError("文件或请求过大", "TOO_LARGE");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
function json(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}
function field(data: Record<string, unknown>, key: string): string {
  if (typeof data[key] !== "string" || !data[key]) throw new KaituError(`缺少${key}`, "BAD_ARGS");
  return data[key];
}

export async function startUi(ws: Workspace, input: UiOptions = {}) {
  const files = dshFiles(ws);
  const options = { ...input, ask: input.ask ?? (await browserAsk(ws)) };
  const packagedWeb = resolve(assetsRoot(), "web");
  const WEB_ROOT =
    options.webRoot ??
    (existsSync(`${packagedWeb}/index.html`)
      ? packagedWeb
      : existsSync(`${PRODUCT_ROOT}/index.html`)
        ? PRODUCT_ROOT
        : LEGACY_ROOT);
  const calendarPush = new CalendarPush(calendarPushStore(ws), options.calendarExecutor);
  const collectors = new CollectorService(ws, options.collectorStateRoot);
  const phones = new PhoneService(ws, phoneAnswer(options.ask));
  let aiChild: ReturnType<typeof spawn> | undefined;
  let aiReady: Promise<{ url?: string }> | undefined;
  const openAi = () => {
    if (options.openAi) return options.openAi();
    if (aiReady) return aiReady;
    dshCommand(ws);
    aiReady = new Promise<{ url: string }>((resolveAi, rejectAi) => {
      aiChild = spawn(
        "npx",
        [
          "--yes",
          "@deepseek-ai/dsh@0.2.1-rc.2",
          "web",
          "--patch",
          ws.resolve(".kaitu/cache/dsh/cordis.yml", { internal: true }),
          "--port",
          "0",
          "--no-open",
        ],
        {
          env: { ...process.env, DSH_HOME: ws.resolve(".kaitu/optional-ai", { internal: true }) },
          stdio: ["ignore", "pipe", "ignore"],
          detached: process.platform !== "win32",
        },
      );
      let output = "";
      aiChild.stdout?.on("data", (chunk) => {
        output = (output + String(chunk)).slice(-4000);
        const url = /dsh web: (http:\/\/127\.0\.0\.1:\d+\/\?token=[\w-]+)/.exec(output)?.[1];
        if (url) resolveAi({ url });
      });
      aiChild.once("error", () => {
        aiReady = undefined;
        rejectAi(new KaituError("无法启动内置 AI，请检查 Node.js 与网络连接", "AI_START"));
      });
      aiChild.once("exit", () => {
        aiReady = undefined;
        aiChild = undefined;
        rejectAi(new KaituError("内置 AI 已退出，请重新打开", "AI_START"));
      });
    });
    return aiReady;
  };
  const requestedPort = options.port ?? 4870;
  if (!Number.isInteger(requestedPort) || requestedPort < 0 || requestedPort > 65535) {
    throw new KaituError("端口必须是 1–65535 的整数", "BAD_ARGS");
  }
  const clients = new Set<ServerResponse>();
  const askClients = new Set<ServerResponse>();
  const uploads = new Map<
    string,
    { source: ImportSource; file: string; name: string; preview: unknown; digest: string; expires: number }
  >();
  let queue: Promise<unknown> = Promise.resolve();
  function exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = queue.then(operation);
    queue = result.catch(() => {});
    return result;
  }
  const pullCalendars = () =>
    exclusive(async () => {
      await pullCalendarSubscriptions(ws);
      if (options.calendarExecutor) await calendarPush.sync(calendarPushEntries(ws));
      notify();
    });
  const calendarTimer = setInterval(() => void pullCalendars().catch(() => {}), 60000);
  calendarTimer.unref();
  let inboxTimer: ReturnType<typeof setTimeout> | undefined;
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;
  let watchError = "";
  let polling: ReturnType<typeof setTimeout> | undefined;
  let stamps = new Map<string, string>();
  holdOverview(ws);
  deferSnapshots(ws, (message) => {
    messages.push(message);
    clearTimeout(saveTimer);
    saveTimer = setTimeout(
      () => void exclusive(saveExternal).catch(reportError),
      options.versionDelayMs ?? 2000,
    );
  });
  const syncCalendar = () => {
    if (!options.calendarExecutor) return;
    void exclusive(async () => {
      await calendarPush.sync(calendarPushEntries(ws));
      notify();
    }).catch(() => {});
  };
  const notify = () => {
    for (const client of clients)
      client.write(`data: ${JSON.stringify({ changed: true, error: watchError || undefined })}\n\n`);
  };
  const stopBackup = startWorkspaceBackup(ws, notify);
  const stopOrganizer = subscribeOrganizer(ws, notify);
  const stopPhone = startPhoneSnapshots(ws, () => reportError());
  void pullCalendars().catch(() => {});
  const reportError = () => {
    watchError = "自动保存暂时失败，请检查文件夹权限或使用 Agent 手动保存版本。";
    notify();
  };
  let messages: string[] = [];
  async function saveExternal() {
    clearTimeout(saveTimer);
    refreshOverview(ws);
    const files = await pendingWorkspaceFiles(ws);
    const own = [...new Set(messages)];
    messages = [];
    if (!files.length) {
      watchError = "";
      return;
    }
    const version = await snapshotNow(
      ws,
      own.length
        ? own.join("；")
        : `${syncStatus(ws).mode === "drive" ? "云端改动" : "文件夹有改动"}：${files
            .slice(0, 3)
            .map((file) => file.split("/").at(-1))
            .join("、")}等 ${files.length} 个文件`,
    );
    if (!version && (await pendingWorkspaceFiles(ws)).length) {
      reportError();
      if (!closed)
        saveTimer = setTimeout(
          () => void exclusive(saveExternal).catch(reportError),
          options.snapshotDelayMs ?? 30000,
        );
    } else watchError = "";
  }
  function scheduleInbox() {
    clearTimeout(inboxTimer);
    inboxTimer = setTimeout(() => {
      if (closed) return;
      void exclusive(async () => {
        const result = await processInbox(ws, { stableMs: options.inboxStableMs });
        if (result.processed.length || result.notes.length) notify();
        if (result.pending.length && !closed) scheduleInbox();
      }).catch(reportError);
    }, options.refreshDelayMs ?? 300);
  }
  function changedFile(file: string) {
    files.invalidate();
    if (closed || ignoredWorkspaceChange(file)) return;
    invalidateHistoryFile(ws, file);
    if (file === "inbox" || file.startsWith("inbox/agents") || file.startsWith("inbox/health"))
      scheduleInbox();
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      void exclusive(async () => {
        refreshOverview(ws);
        if (options.calendarExecutor) await calendarPush.sync(calendarPushEntries(ws));
        notify();
      }).catch(reportError);
    }, options.refreshDelayMs ?? 300);
    clearTimeout(saveTimer);
    saveTimer = setTimeout(
      () => void exclusive(saveExternal).catch(reportError),
      messages.length ? (options.versionDelayMs ?? 2000) : (options.snapshotDelayMs ?? 30000),
    );
  }
  let watcher: FSWatcher | undefined;
  let externalWatchers: FSWatcher[] = [];
  const startPolling = () => {
    watcher?.close();
    if (polling) return;
    // 部分受限系统不提供文件事件，保留相同的刷新和版本语义。
    stamps = workspaceFileStamps(ws);
    // 监听失效到建立轮询基线之间也可能有改动，后台补查版本和收件箱。
    changedFile("工作区");
    scheduleInbox();
    const delay = Math.max(50, options.refreshDelayMs ?? 1000);
    function poll() {
      const started = performance.now();
      try {
        const next = workspaceFileStamps(ws);
        for (const file of new Set([...stamps.keys(), ...next.keys()])) {
          if (stamps.get(file) !== next.get(file)) changedFile(file);
        }
        stamps = next;
      } catch {
        reportError();
      }
      // 慢扫描后至少留出同等空档，让后台文件 I/O 运行，避免轮询占满事件循环。
      polling = setTimeout(poll, Math.max(delay, performance.now() - started));
    }
    polling = setTimeout(poll, delay);
  };
  function startWatching() {
    watcher?.close();
    clearTimeout(polling);
    polling = undefined;
    try {
      watcher = watch(ws.root, { recursive: true }, (_event, filename) => {
        changedFile(filename?.toString().replaceAll("\\", "/") ?? "工作区");
      });
      watcher.on("error", startPolling);
    } catch {
      startPolling();
    }
    // 外部健康收件箱（iCloud Drive 等）：文件事件触发一轮拉取
    for (const external of externalWatchers) external.close();
    externalWatchers = [];
    for (const dir of externalHealthPaths(ws)) {
      try {
        const external = watch(dir, () => scheduleInbox());
        external.on("error", () => external.close());
        externalWatchers.push(external);
      } catch {
        // 目录暂不存在（iCloud 未同步或未配置），启动拉取与后续事件会重试
      }
    }
    scheduleInbox();
  }
  startWatching();
  const heartbeat = setInterval(() => {
    for (const client of clients) client.write(": heartbeat\n\n");
    for (const [id, upload] of uploads) {
      if (upload.expires < Date.now()) {
        discardUpload(ws, upload.file);
        uploads.delete(id);
      }
    }
  }, 15000);
  let port = requestedPort;
  const server = createServer(async (req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self' https://tiles.openfreemap.org; worker-src 'self' blob:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    const hosts = [`127.0.0.1:${port}`, `localhost:${port}`];
    if (!hosts.includes(req.headers.host ?? "")) return json(res, 403, { error: "拒绝非本机 Host" });
    if (req.method !== "GET" && req.method !== "POST") return json(res, 405, { error: "不支持的请求方法" });
    if (
      req.method === "POST" &&
      (req.headers["x-kaitu"] !== "1" ||
        !hosts.map((host) => `http://${host}`).includes(req.headers.origin ?? ""))
    ) {
      return json(res, 403, { error: "写操作必须来自本机工作台" });
    }
    try {
      const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
      if (url.pathname.startsWith("/api/channels/") && req.method === "POST") {
        const input = JSON.parse((await body(req, MAX_JSON)).toString());
        if (!input || typeof input !== "object" || Array.isArray(input))
          throw new KaituError("参数必须是对象", "BAD_ARGS");
        try {
          const operation = url.pathname.slice("/api/channels/".length);
          return json(
            res,
            200,
            await (operation.startsWith("phone-") ? phones : collectors).request(operation, input),
          );
        } catch (error) {
          if (error instanceof KaituError) throw error;
          return json(res, 400, { error: "采集设置未完成，请检查参数或稍后重试" });
        }
      }
      if (url.pathname.startsWith("/api/product/") && req.method === "POST") {
        const method = url.pathname.slice("/api/product/".length);
        const args = JSON.parse(
          (
            await body(
              req,
              ["financeImportPreview", "onboardingImportPreview", "askSend"].includes(method)
                ? 49 * 1024 * 1024
                : 3 * 1024 * 1024,
            )
          ).toString(),
        );
        if (!Array.isArray(args)) throw new KaituError("参数必须是数组", "BAD_ARGS");
        if (method === "preferences" && options.systemLocale) args[0] = options.systemLocale;
        if (method === "desktopUpdate")
          return json(
            res,
            200,
            options.desktopUpdate ? await options.desktopUpdate(String(args[0] ?? "status")) : null,
          );
        if (method === "plugins") {
          if (!options.plugins) throw new KaituError("插件只在开图 App 里可用", "BAD_ARGS");
          return json(
            res,
            200,
            (await options.plugins(
              String(args[0] ?? "list"),
              typeof args[1] === "string" ? args[1] : undefined,
            )) ?? null,
          );
        }
        if (method === "findWorkspaceFiles") return json(res, 200, await files.find(String(args[0] ?? "")));
        if (method === "openWorkspacePath") {
          if (typeof args[0] !== "string" || !["open", "reveal"].includes(String(args[1] ?? "open")))
            throw new KaituError("请选择要打开的资料", "BAD_ARGS");
          return json(res, 200, await files.open(args[0], (args[1] ?? "open") as "open" | "reveal"));
        }
        if (method === "pickStorageFolder") {
          const folder = options.pickDirectory
            ? await options.pickDirectory()
            : await (await import("@deepseek-ai/dsh-host-directory-picker-native")).pickNativeDirectory(
                AbortSignal.timeout(10 * 60 * 1000),
              );
          return json(res, 200, folder);
        }
        const relocate = method === "moveStorage" || (method === "workspaceBackup" && args[0] === "activate");
        let draftId: string | undefined;
        if (method === "openAi" && typeof args[0] === "string" && args[0].trim()) {
          if (args[0].length > 100000) throw new KaituError("请求内容过长", "BAD_ARGS");
          draftId = randomUUID();
          ws.writeJson(
            ".kaitu/cache/ai-draft.json",
            { id: draftId, text: args[0] },
            { internal: true, mode: 0o600 },
          );
        }
        const result =
          method === "openAi"
            ? await openAi()
            : method.startsWith("ask") || method === "projectGoalSuggest"
              ? await productRequest(ws, method, args, options.ask, calendarPush)
              : relocate || method === "restoreVersion"
                ? await exclusive(async () => {
                    await saveExternal();
                    await options.ask?.prepareRelocation();
                    await phones.stop();
                    const oldRoot = ws.root;
                    try {
                      if (relocate) await options.onWorkspaceChanging?.();
                      return await productRequest(ws, method, args, options.ask, calendarPush);
                    } finally {
                      try {
                        if (ws.root !== oldRoot) startWatching();
                        if (relocate) await options.onWorkspaceChanged?.();
                      } finally {
                        options.ask?.relocate(ws.root);
                        phones.start();
                        notify();
                      }
                    }
                  })
                : await productRequest(ws, method, args, options.ask, calendarPush);
        if (method === "configureAutomation") await options.onAutomationChanged?.();
        if (planMutations.has(method)) syncCalendar();
        if (productMutations.has(method)) notify();
        if (
          method === "openAi" &&
          draftId &&
          result &&
          typeof result === "object" &&
          "url" in result &&
          typeof result.url === "string"
        )
          return json(res, 200, { ...result, url: `${result.url}#kaitu-draft=${draftId}` });
        return json(res, 200, result ?? null);
      }
      if (req.method === "GET") {
        if (url.pathname === "/api/ask/events" && options.ask) {
          const id = url.searchParams.get("session") ?? "";
          const history = options.ask.events(id);
          const cursor = Number(req.headers["last-event-id"] ?? url.searchParams.get("after") ?? 0);
          res.writeHead(200, { "Content-Type": "text/event-stream", Connection: "keep-alive" });
          res.write(": connected\n\n");
          const send = (event: { id: number }) =>
            res.write(`id: ${event.id}\ndata: ${JSON.stringify(event)}\n\n`);
          const unsubscribe = options.ask.subscribe(id, send);
          for (const event of history) if (event.id > cursor) send(event);
          const timer = setInterval(() => res.write(": heartbeat\n\n"), 15000);
          askClients.add(res);
          req.on("close", () => {
            unsubscribe();
            clearInterval(timer);
            askClients.delete(res);
          });
          return;
        }
        if (url.pathname.startsWith("/api/photos/")) {
          const photo = readPhoto(ws, decodeURIComponent(url.pathname.slice("/api/photos/".length)));
          res.writeHead(200, { "Content-Type": photo.contentType });
          return res.end(photo.bytes);
        }
        if (url.pathname === "/api/onboarding") return json(res, 200, onboardingStatus(ws));
        if (["/api/drive", "/api/sync"].includes(url.pathname)) return json(res, 200, syncStatus(ws));
        if (url.pathname === "/api/state") return json(res, 200, { ...readWorkbench(ws), watchError });
        if (url.pathname === "/api/history") return json(res, 200, await history(ws));
        if (url.pathname === "/api/events") {
          res.writeHead(200, { "Content-Type": "text/event-stream", Connection: "keep-alive" });
          res.write(": connected\n\n");
          clients.add(res);
          req.on("close", () => clients.delete(res));
          return;
        }
        if (url.pathname.startsWith("/api/")) return json(res, 404, { error: "接口不存在" });
        if (url.pathname === "/") {
          res.writeHead(200, { "Content-Type": MIME[".html"] });
          return res.end(readFileSync(resolve(WEB_ROOT, "index.html")));
        }
        const path = resolve(WEB_ROOT, `.${decodeURIComponent(url.pathname)}`);
        if (!path.startsWith(`${resolve(WEB_ROOT)}${sep}`) || !url.pathname.startsWith("/assets/")) {
          return json(res, 404, { error: "页面不存在" });
        }
        try {
          const content = readFileSync(path);
          res.writeHead(200, { "Content-Type": MIME[extname(path)] ?? "application/octet-stream" });
          return res.end(content);
        } catch {
          return json(res, 404, { error: "文件不存在" });
        }
      }
      if (url.pathname === "/api/photos/add") {
        const bytes = await body(req, MAX_PHOTO_BYTES);
        const result = await addPhotoBytes(ws, bytes, {
          pose: (url.searchParams.get("pose") ?? "other") as Pose,
          ts: url.searchParams.get("ts") ?? undefined,
          notes: url.searchParams.get("notes") ?? undefined,
          by: "user",
        });
        notify();
        return json(res, 200, result);
      }
      if (url.pathname === "/api/import/preview") {
        const source = url.searchParams.get("source") as ImportSource;
        const bytes = await body(req, MAX_UPLOAD);
        const result = await exclusive(async () => {
          const name = url.searchParams.get("name") ?? "";
          const file = stageUpload(ws, source, name, bytes);
          try {
            const preview = await importUpload(ws, source, file, true, name);
            const token = randomUUID();
            uploads.set(token, {
              source,
              file,
              name,
              preview,
              digest: createHash("sha256").update(bytes).digest("hex"),
              expires: Date.now() + 30 * 60000,
            });
            return { token, preview };
          } catch (error) {
            discardUpload(ws, file);
            throw error;
          }
        });
        return json(res, 200, result);
      }
      const data = JSON.parse((await body(req, MAX_JSON)).toString()) as Record<string, unknown>;
      const result = await exclusive(async () => {
        if (url.pathname === "/api/import/cancel") {
          const token = field(data, "token");
          const upload = uploads.get(token);
          if (upload) {
            discardUpload(ws, upload.file);
            uploads.delete(token);
          }
          return { ok: true };
        }
        await saveExternal();
        switch (url.pathname) {
          case "/api/sync/enable":
          case "/api/sync/disable":
          case "/api/drive/enable":
          case "/api/drive/disable": {
            await options.ask?.prepareRelocation();
            await phones.stop();
            const oldRoot = ws.root;
            try {
              await options.onWorkspaceChanging?.();
              if (!url.pathname.endsWith("enable"))
                return await disableSync(ws, {
                  to: typeof data.to === "string" && data.to ? data.to : undefined,
                });
              // 只有开启同步才要说明同步方式；关闭沿用原来的 {to}。
              const mode = url.pathname === "/api/drive/enable" ? "drive" : field(data, "mode");
              if (!["icloud", "drive", "nutstore"].includes(mode))
                throw new KaituError("请选择 icloud、drive 或 nutstore", "BAD_ARGS");
              return await enableSync(ws, mode === "icloud" ? "icloud" : "drive", {
                dir:
                  typeof data.dir === "string" && data.dir
                    ? data.dir
                    : typeof data.driveDir === "string" && data.driveDir
                      ? data.driveDir
                      : undefined,
                name: typeof data.name === "string" ? data.name : undefined,
                ...(mode === "nutstore" ? { provider: "nutstore" as const } : {}),
              });
            } finally {
              try {
                startWatching();
                if (ws.root !== oldRoot) {
                  aiChild?.kill();
                  aiChild = undefined;
                  aiReady = undefined;
                }
                await options.onWorkspaceChanged?.();
              } finally {
                options.ask?.relocate(ws.root);
                phones.start();
              }
            }
          }
          case "/api/projects/sync":
            return typeof data.slug === "string" ? syncProject(ws, data.slug) : syncProjects(ws);
          case "/api/photos/delete":
            return removePhoto(ws, field(data, "id"), { by: "user" });
          case "/api/proposal": {
            const result = await decideProposal(
              ws,
              field(data, "id"),
              field(data, "decision") as "confirmed" | "rejected",
            );
            return { ...result, calendarPush: await calendarPush.sync(calendarPushEntries(ws)) };
          }
          case "/api/tasks/done":
            return completeTask(ws, field(data, "id"), { by: "user" });
          case "/api/next":
            return completeNext(ws, field(data, "file"), field(data, "id"));
          case "/api/memory/delete":
            return removeMemory(ws, field(data, "file"), { by: "user" });
          case "/api/restore": {
            await options.ask?.prepareRelocation();
            await phones.stop();
            try {
              return await restore(ws, field(data, "version"));
            } finally {
              options.ask?.relocate(ws.root);
              phones.start();
            }
          }
          case "/api/import/confirm": {
            const token = field(data, "token");
            const upload = uploads.get(token);
            if (!upload || upload.expires < Date.now())
              throw new KaituError("预览已过期，请重新选择文件", "CONFLICT");
            try {
              if (createHash("sha256").update(ws.readBytes(upload.file)).digest("hex") !== upload.digest)
                throw new KaituError("文件已变化，请重新预览", "CONFLICT");
              const preview = await importUpload(ws, upload.source, upload.file, true, upload.name);
              if (JSON.stringify(preview) !== JSON.stringify(upload.preview)) {
                throw new KaituError("文件夹已变化，请重新预览后确认", "CONFLICT");
              }
              const before = (await history(ws, { limit: 1 }))[0]?.oid;
              return {
                result: await importUpload(ws, upload.source, upload.file, false, upload.name),
                before,
              };
            } finally {
              discardUpload(ws, upload.file);
              uploads.delete(token);
            }
          }
          default:
            throw new KaituError("接口不存在", "NOT_FOUND");
        }
      });
      notify();
      json(res, 200, result);
    } catch (error) {
      // 独立引擎是另一个 bundle，按约定的错误名称保留它的可操作提示。
      if (req.url === "/api/product/moveStorage" && (error as NodeJS.ErrnoException).code === "EBUSY")
        return json(res, 400, { error: "资料文件夹正在被其他程序占用，请关闭占用它的窗口后重试" });
      const known =
        error instanceof KaituError || (error instanceof Error && error.name === "KaituError")
          ? (error as KaituError)
          : null;
      const code = known?.code ?? "BAD_REQUEST";
      const status =
        code === "CONFLICT" ? 409 : code === "TOO_LARGE" ? 413 : code === "NOT_FOUND" ? 404 : 400;
      json(res, status, {
        ...(req.url?.startsWith("/api/product/ask") ? { code } : {}),
        error: known
          ? known.message
          : req.url?.startsWith("/api/product/ask")
            ? "AI 连接未完成，请检查连接设置后重试"
            : "请求未完成，请检查文件格式后重试",
      });
    }
  });
  const close = async () => {
    if (aiChild?.pid) {
      if (process.platform === "win32") aiChild.kill();
      else {
        try {
          process.kill(-aiChild.pid, "SIGTERM");
        } catch {
          /* 自建进程组已退出。 */
        }
      }
    }
    closed = true;
    cancelGithubCliLogin();
    watcher?.close();
    for (const external of externalWatchers) external.close();
    clearTimeout(inboxTimer);
    clearTimeout(refreshTimer);
    clearTimeout(saveTimer);
    clearInterval(heartbeat);
    clearTimeout(polling);
    for (const client of [...clients, ...askClients]) client.end();
    await phones.stop();
    await collectors.stop();
    stopBackup();
    stopOrganizer();
    stopPhone();
    clearInterval(calendarTimer);
    await options.ask?.close();
    files.dispose();
    await exclusive(saveExternal);
    for (const upload of uploads.values()) discardUpload(ws, upload.file);
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  };
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(requestedPort, "127.0.0.1", resolve);
    });
  } catch (error) {
    watcher?.close();
    stopBackup();
    stopOrganizer();
    stopPhone();
    clearInterval(calendarTimer);
    for (const external of externalWatchers) external.close();
    clearInterval(heartbeat);
    clearTimeout(polling);
    clearTimeout(inboxTimer);
    clearTimeout(refreshTimer);
    clearTimeout(saveTimer);
    throw error;
  }
  collectors.start();
  phones.start();
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("无法取得监听端口");
  port = address.port;
  // 历史盘点涉及 git 全量状态，监听已建立后放到后台，不挡住服务监听。
  setImmediate(() => {
    if (closed) return;
    void exclusive(async () => {
      for (const file of await pendingWorkspaceFiles(ws)) changedFile(file);
    }).catch(reportError);
  });
  const url = `http://127.0.0.1:${port}`;
  if (options.open !== false) {
    const command =
      process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer.exe" : "xdg-open";
    const child = spawn(command, [url], { detached: true, stdio: "ignore" });
    child.on("error", () => console.error(`请在浏览器打开 ${url}`));
    child.unref();
  }
  return { url, port, close };
}
