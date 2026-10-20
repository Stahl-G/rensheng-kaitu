import { randomUUID } from "node:crypto";
import { closeSync, createReadStream, fstatSync, openSync, readSync, readdirSync, writeSync } from "node:fs";
import { promises as fs } from "node:fs";
import { type ServerResponse, createServer } from "node:http";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { Zip, ZipDeflate } from "fflate";
import { assertAgentPath } from "./agent-file-policy.js";
import type { IndexControls } from "./chat-search.js";
import { type DataProgress, type DataRunOptions, runDataWorker } from "./data-worker.js";
import { KaituError } from "./errors.js";
import { localStateRoot } from "./local-state.js";
import type { Workspace } from "./workspace.js";

/** 在 worker 内流式压缩；内存只保留一块正文与 ZIP 目录信息。输出由主线程创建的私有目录持有。 */
export function writeWorkspaceArchive(ws: Workspace, output: string, controls: IndexControls = {}) {
  const destination = openSync(output, "wx", 0o600);
  let completed = 0;
  let bytes = 0;
  let processedBytes = 0;
  const zip = new Zip((error, chunk) => {
    if (error) throw error;
    controls.check?.();
    let offset = 0;
    while (offset < chunk.length) offset += writeSync(destination, chunk, offset, chunk.length - offset);
    bytes += chunk.length;
  });
  const buffer = Buffer.allocUnsafe(256 * 1024);
  const walk = (directory: string) => {
    controls.check?.();
    for (const entry of readdirSync(ws.resolve(directory, { internal: true }), { withFileTypes: true })) {
      controls.check?.();
      if (entry.isSymbolicLink() || entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const file = directory ? `${directory}/${entry.name}` : entry.name;
      try {
        assertAgentPath(ws.root, file);
      } catch {
        continue;
      }
      if (entry.isDirectory()) walk(file);
      else if (entry.isFile()) {
        if (ws.isUnavailable(file)) throw new KaituError(`还没从云盘下载：${file}`, "CLOUD_UNAVAILABLE");
        const source = openSync(ws.resolve(file), "r");
        try {
          const stream = new ZipDeflate(file);
          zip.add(stream);
          let remaining = fstatSync(source).size;
          while (true) {
            controls.check?.();
            const length = readSync(source, buffer, 0, Math.min(buffer.length, remaining), null);
            remaining -= length;
            const final = !length || remaining === 0;
            stream.push(buffer.subarray(0, length), final);
            processedBytes += length;
            controls.progress?.({ phase: "compress", completed, bytes: processedBytes });
            if (final) break;
          }
        } finally {
          closeSync(source);
        }
        controls.progress?.({ phase: "compress", bytes: processedBytes, completed: ++completed });
      }
    }
  };
  try {
    controls.progress?.({ phase: "compress", completed });
    walk("");
    controls.check?.();
    zip.end();
    controls.progress?.({ phase: "compress", bytes: processedBytes, completed, total: completed });
    return { name: `kaitu-${new Date().toISOString().slice(0, 10)}.zip`, bytes };
  } finally {
    zip.terminate();
    closeSync(destination);
  }
}
export interface WorkspaceArchive {
  name: string;
  path: string;
  bytes: number;
  dispose(): Promise<void>;
}
export async function exportWorkspaceAsync(
  ws: Workspace,
  options: DataRunOptions = {},
): Promise<WorkspaceArchive> {
  options.signal?.throwIfAborted();
  const parent = join(localStateRoot(), "exports");
  await fs.mkdir(parent, { recursive: true, mode: 0o700 });
  const directory = await fs.mkdtemp(join(parent, "export-"));
  const path = join(directory, "workspace.zip");
  const dispose = () => fs.rm(directory, { recursive: true, force: true });
  try {
    const result = await runDataWorker<{ name: string; bytes: number }>(
      ws,
      "export",
      { output: path },
      options,
    );
    return { ...result, path, dispose };
  } catch (error) {
    await dispose();
    throw error;
  }
}
export interface WorkspaceExportState {
  status: "idle" | "running" | "ready" | "downloading" | "failed" | "cancelled";
  progress?: DataProgress;
  error?: string;
  file?: { name: string; url: string };
}
type ExportJob = {
  root: string;
  token: string;
  controller: AbortController;
  state: WorkspaceExportState;
  done: Promise<void>;
  file?: WorkspaceArchive;
  claimed?: boolean;
  expiry?: ReturnType<typeof setTimeout>;
};
const exports = new WeakMap<Workspace, ExportJob>();
async function removeJob(ws: Workspace, job: ExportJob) {
  clearTimeout(job.expiry);
  job.controller.abort();
  await job.done.catch(() => {});
  await job.file?.dispose();
  if (exports.get(ws) === job) exports.delete(ws);
}
export async function workspaceExportRequest(
  ws: Workspace,
  action: "start" | "status" | "cancel" | "result",
  downloadBase = "/api/export/",
): Promise<WorkspaceExportState> {
  let job = exports.get(ws);
  if (job && job.root !== ws.root) {
    await removeJob(ws, job);
    job = undefined;
  }
  if (action === "cancel") {
    if (job) await removeJob(ws, job);
    return { status: "cancelled" };
  }
  if (action === "result") {
    if (!job?.file || job.state.status !== "ready" || job.claimed)
      throw new KaituError("导出尚未完成，请稍后重试", "NOT_READY");
    return { status: "ready", file: { name: job.file.name, url: `${downloadBase}${job.token}` } };
  }
  if (action === "start" && job?.claimed) return job.state;
  if (action === "start" && job?.state.status !== "running") {
    const previous = job;
    const next: ExportJob = {
      root: ws.root,
      token: randomUUID(),
      controller: new AbortController(),
      state: { status: "running", progress: { phase: "compress", completed: 0 } },
      done: Promise.resolve(),
    };
    exports.set(ws, next);
    next.done = (async () => {
      if (previous) await removeJob(ws, previous);
      return exportWorkspaceAsync(ws, {
        signal: next.controller.signal,
        progress: (p) => {
          next.state.progress = p;
        },
      });
    })().then(
      async (file) => {
        next.file = file;
        if (next.controller.signal.aborted) {
          await file.dispose();
          return;
        }
        next.state.status = "ready";
        // 只限制无人领取的已完成结果，不限制必要全量工作的执行时间。
        next.expiry = setTimeout(
          () => {
            void removeJob(ws, next).catch(() => {
              next.state = {
                status: "failed",
                error: "导出临时文件清理失败，请重试取消 / Temporary export cleanup failed; retry cancel",
              };
            });
          },
          10 * 60 * 1000,
        );
        next.expiry.unref();
      },
      () => {
        next.state = {
          status: "failed",
          error: "导出未完成，请检查资料可用性后重试 / Export incomplete; check file availability and retry",
        };
      },
    );
    job = next;
  }
  return job?.state ?? { status: "idle" };
}
/** 只消费当前工作区持有的随机令牌，不接受路径；流结束/中断/错误都释放临时文件。 */
export async function serveWorkspaceExport(ws: Workspace, token: string, res: ServerResponse) {
  const job = exports.get(ws);
  if (
    !job?.file ||
    job.root !== ws.root ||
    job.state.status !== "ready" ||
    job.token !== token ||
    job.claimed
  ) {
    res.writeHead(404);
    res.end();
    return;
  }
  job.claimed = true;
  job.state.status = "downloading";
  clearTimeout(job.expiry);
  const file = job.file;
  job.done = (async () => {
    try {
      res.writeHead(200, {
        "Content-Type": "application/zip",
        "Content-Length": file.bytes,
        "Content-Disposition": `attachment; filename="${file.name}"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
      });
      let completed = 0;
      const stream = createReadStream(file.path);
      job.state.progress = { phase: "download", completed, total: file.bytes };
      stream.on("data", (chunk) => {
        completed += chunk.length;
        job.state.progress = { phase: "download", completed, total: file.bytes };
      });
      await pipeline(stream, res, { signal: job.controller.signal });
    } catch {
      res.destroy();
    } finally {
      await file.dispose();
      if (exports.get(ws) === job) exports.delete(ws);
    }
  })();
  await job.done;
}
/** DSH RPC 没有下载服务；只为该服务创建回环、随机令牌的单一 ZIP 入口。 */
export async function startWorkspaceExportDownloads(ws: Workspace) {
  const server = createServer((req, res) => {
    const address = server.address();
    const host = address && typeof address !== "string" ? `127.0.0.1:${address.port}` : "";
    const match = /^\/export\/([a-f0-9-]+)$/.exec(req.url ?? "");
    if (req.method !== "GET" || req.headers.host !== host || !match) {
      res.writeHead(404);
      res.end();
      return;
    }
    void serveWorkspaceExport(ws, match[1] as string, res).catch(() => res.destroy());
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  server.unref();
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Download listener unavailable");
  return {
    base: `http://127.0.0.1:${address.port}/export/`,
    close: async () => {
      await workspaceExportRequest(ws, "cancel");
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}
