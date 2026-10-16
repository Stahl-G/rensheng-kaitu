import { parentPort, workerData } from "node:worker_threads";
import { parseAppleHealth, parseHealthShortcut } from "./importers/apple-health.js";

try {
  const { file, zone, shortcut } = workerData as { file: string; zone: string; shortcut: boolean };
  const result = shortcut ? parseHealthShortcut(file, zone) : await parseAppleHealth(file, zone);
  if (result.candidates.length > 2000) throw new Error("自动导入超过 2000 条记录，请分批导入");
  parentPort?.postMessage({ result });
} catch (error) {
  parentPort?.postMessage({ error: (error as Error).message });
}
