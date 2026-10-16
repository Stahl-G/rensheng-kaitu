import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { KaituError } from "./errors.js";
import type { parseAppleHealth } from "./importers/apple-health.js";

type ParsedHealth = Awaited<ReturnType<typeof parseAppleHealth>>;
export function parseHealthInWorker(file: string, zone: string, shortcut: boolean): Promise<ParsedHealth> {
  let entry = new URL("./health-import-worker.js", import.meta.url);
  if (!existsSync(fileURLToPath(entry))) entry = new URL("../dist/health-import-worker.js", import.meta.url);
  return new Promise((resolve, reject) => {
    const worker = new Worker(entry, {
      workerData: { file, zone, shortcut },
      resourceLimits: { maxOldGenerationSizeMb: 128 },
    });
    let settled = false;
    const finish = (error?: Error, result?: ParsedHealth) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      if (error) reject(error);
      else resolve(result as ParsedHealth);
    };
    const timer = setTimeout(
      () => finish(new KaituError("健康文件处理超过 5 秒，请分批导入", "IMPORT_LIMIT")),
      5000,
    );
    worker.once("message", (message: { result?: ParsedHealth; error?: string }) =>
      message.error
        ? finish(new KaituError(message.error, "INVALID_IMPORT"))
        : finish(undefined, message.result),
    );
    worker.once("error", () => finish(new KaituError("健康文件超出可处理范围", "INVALID_IMPORT")));
    worker.once("exit", () => {
      if (!settled) finish(new KaituError("健康文件未能完成解析", "INVALID_IMPORT"));
    });
  });
}
