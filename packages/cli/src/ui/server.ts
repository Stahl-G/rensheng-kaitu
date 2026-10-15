import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { type FSWatcher, readFileSync, watch } from "node:fs";
import { type IncomingMessage, type ServerResponse, createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type ImportSource,
  KaituError,
  MAX_PHOTO_BYTES,
  type Pose,
  type Workspace,
  addPhotoBytes,
  completeNext,
  completeTask,
  decideProposal,
  disableDrive,
  discardUpload,
  driveStatus,
  enableDrive,
  history,
  ignoredWorkspaceChange,
  importUpload,
  pendingWorkspaceFiles,
  processInbox,
  readPhoto,
  readWorkbench,
  refreshOverview,
  removeMemory,
  removePhoto,
  restore,
  snapshot,
  stageUpload,
  syncProject,
  syncProjects,
  workspaceFileStamps,
} from "@kaitu/core";

export interface UiOptions {
  port?: number;
  open?: boolean;
  snapshotDelayMs?: number;
  refreshDelayMs?: number;
  inboxStableMs?: number;
}
const WEB_ROOT = fileURLToPath(new URL("../../../web/dist/", import.meta.url));
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

export async function startUi(ws: Workspace, options: UiOptions = {}) {
  const requestedPort = options.port ?? 4870;
  if (!Number.isInteger(requestedPort) || requestedPort < 0 || requestedPort > 65535) {
    throw new KaituError("端口必须是 1–65535 的整数", "BAD_ARGS");
  }
  const clients = new Set<ServerResponse>();
  const uploads = new Map<
    string,
    { source: ImportSource; file: string; name: string; preview: unknown; expires: number }
  >();
  let queue: Promise<unknown> = Promise.resolve();
  function exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = queue.then(operation);
    queue = result.catch(() => {});
    return result;
  }
  let inboxTimer: ReturnType<typeof setTimeout> | undefined;
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;
  let watchError = "";
  let polling: ReturnType<typeof setInterval> | undefined;
  let stamps = workspaceFileStamps(ws);
  const notify = () => {
    for (const client of clients)
      client.write(`data: ${JSON.stringify({ changed: true, error: watchError || undefined })}\n\n`);
  };
  const reportError = () => {
    watchError = "自动保存暂时失败，请检查文件夹权限或使用 Agent 手动保存版本。";
    notify();
  };
  async function saveExternal() {
    clearTimeout(saveTimer);
    refreshOverview(ws);
    const files = await pendingWorkspaceFiles(ws);
    if (!files.length) {
      watchError = "";
      return;
    }
    const version = await snapshot(
      ws,
      `文件夹有改动：${files
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
    if (closed || ignoredWorkspaceChange(file)) return;
    if (file === "inbox" || file.startsWith("inbox/agents") || file.startsWith("inbox/health"))
      scheduleInbox();
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      void exclusive(async () => {
        refreshOverview(ws);
        notify();
      }).catch(reportError);
    }, options.refreshDelayMs ?? 300);
    clearTimeout(saveTimer);
    saveTimer = setTimeout(
      () => void exclusive(saveExternal).catch(reportError),
      options.snapshotDelayMs ?? 30000,
    );
  }
  for (const file of await pendingWorkspaceFiles(ws)) changedFile(file);
  let watcher: FSWatcher | undefined;
  const startPolling = () => {
    watcher?.close();
    if (polling) return;
    // 部分受限系统不提供文件事件，保留相同的刷新和版本语义。
    polling = setInterval(
      () => {
        try {
          const next = workspaceFileStamps(ws);
          for (const file of new Set([...stamps.keys(), ...next.keys()])) {
            if (stamps.get(file) !== next.get(file)) changedFile(file);
          }
          stamps = next;
        } catch {
          reportError();
        }
      },
      Math.max(50, options.refreshDelayMs ?? 1000),
    );
  };
  function startWatching() {
    watcher?.close();
    clearInterval(polling);
    polling = undefined;
    stamps = workspaceFileStamps(ws);
    try {
      watcher = watch(ws.root, { recursive: true }, (_event, filename) => {
        changedFile(filename?.toString().replaceAll("\\", "/") ?? "工作区");
      });
      watcher.on("error", startPolling);
    } catch {
      startPolling();
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
      "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
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
      if (req.method === "GET") {
        if (url.pathname.startsWith("/api/photos/")) {
          const photo = readPhoto(ws, decodeURIComponent(url.pathname.slice("/api/photos/".length)));
          res.writeHead(200, { "Content-Type": photo.contentType });
          return res.end(photo.bytes);
        }
        if (url.pathname === "/api/drive") return json(res, 200, driveStatus(ws));
        if (url.pathname === "/api/state") return json(res, 200, { ...readWorkbench(ws), watchError });
        if (url.pathname === "/api/history") return json(res, 200, await exclusive(() => history(ws)));
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
        const result = await exclusive(async () => {
          await saveExternal();
          return addPhotoBytes(ws, bytes, {
            pose: (url.searchParams.get("pose") ?? "other") as Pose,
            ts: url.searchParams.get("ts") ?? undefined,
            notes: url.searchParams.get("notes") ?? undefined,
            by: "user",
          });
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
            uploads.set(token, { source, file, name, preview, expires: Date.now() + 30 * 60000 });
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
          case "/api/drive/enable":
          case "/api/drive/disable": {
            try {
              return url.pathname.endsWith("enable")
                ? await enableDrive(ws, {
                    driveDir: typeof data.driveDir === "string" && data.driveDir ? data.driveDir : undefined,
                  })
                : await disableDrive(ws, {
                    to: typeof data.to === "string" && data.to ? data.to : undefined,
                  });
            } finally {
              startWatching();
            }
          }
          case "/api/projects/sync":
            return typeof data.slug === "string" ? syncProject(ws, data.slug) : syncProjects(ws);
          case "/api/photos/delete":
            return removePhoto(ws, field(data, "id"), { by: "user" });
          case "/api/proposal":
            return decideProposal(ws, field(data, "id"), field(data, "decision") as "confirmed" | "rejected");
          case "/api/tasks/done":
            return completeTask(ws, field(data, "id"), { by: "user" });
          case "/api/next":
            return completeNext(ws, field(data, "file"), field(data, "id"));
          case "/api/memory/delete":
            return removeMemory(ws, field(data, "file"), { by: "user" });
          case "/api/restore":
            return restore(ws, field(data, "version"));
          case "/api/import/confirm": {
            const token = field(data, "token");
            const upload = uploads.get(token);
            if (!upload || upload.expires < Date.now())
              throw new KaituError("预览已过期，请重新选择文件", "CONFLICT");
            try {
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
      const code = error instanceof KaituError ? error.code : "BAD_REQUEST";
      const status =
        code === "CONFLICT" ? 409 : code === "TOO_LARGE" ? 413 : code === "NOT_FOUND" ? 404 : 400;
      json(res, status, {
        error: error instanceof KaituError ? error.message : "请求未完成，请检查文件格式后重试",
      });
    }
  });
  const close = async () => {
    closed = true;
    watcher?.close();
    clearTimeout(inboxTimer);
    clearTimeout(refreshTimer);
    clearTimeout(saveTimer);
    clearInterval(heartbeat);
    clearInterval(polling);
    for (const client of clients) client.end();
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
    clearInterval(heartbeat);
    clearInterval(polling);
    clearTimeout(inboxTimer);
    clearTimeout(refreshTimer);
    clearTimeout(saveTimer);
    throw error;
  }
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("无法取得监听端口");
  port = address.port;
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
