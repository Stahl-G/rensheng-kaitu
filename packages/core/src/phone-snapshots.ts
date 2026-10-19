import { watch } from "node:fs";
import { readExploration } from "./exploration.js";
import { readOverviewPage } from "./overview-page.js";
import { buildPhoneLibrary, buildPhoneMap, buildPhoneToday, buildPhoneWeek } from "./phone-projections.js";
import { writePhoneReceipts } from "./phone-receipts.js";
import { lifeMap } from "./places.js";
import { syncMode } from "./sync-location.js";
import { ignoredWorkspaceChange } from "./workbench.js";
import { subscribeWorkspaceBackup, workspaceBackupStatus } from "./workspace-backup.js";
import type { Workspace } from "./workspace.js";

export function phoneReadable(ws: Workspace) {
  return syncMode(ws.root) !== "local" || workspaceBackupStatus(ws).connection?.enabled === true;
}
export async function writePhoneSnapshots(ws: Workspace, now = new Date()) {
  if (!phoneReadable(ws)) return 0;
  const data = await readOverviewPage(ws, now);
  const at = now.toISOString();
  const snapshots = {
    today: buildPhoneToday(data, at),
    week: buildPhoneWeek(data, at),
    map: buildPhoneMap(data, lifeMap(ws, now), readExploration(ws), at),
    library: buildPhoneLibrary(ws, data, at),
  };
  let writes = 0;
  for (const [name, value] of Object.entries(snapshots)) {
    const file = `phone/${name}.json`;
    if (ws.exists(file)) {
      const previous = ws.readJson<typeof value>(file);
      if (JSON.stringify({ ...value, generated_at: previous.generated_at }) === JSON.stringify(previous))
        continue;
    }
    ws.writeJson(file, value);
    writes++;
  }
  return writes + writePhoneReceipts(ws, [], now);
}

/** 常驻进程在后台生成，监听只负责失效；同步盘漏事件时每分钟补看一次。 */
export function startPhoneSnapshots(ws: Workspace, report: (error: unknown) => void = () => {}) {
  let timer: NodeJS.Timeout | undefined;
  let running = false;
  let again = false;
  let closed = false;
  const run = async () => {
    if (closed) return;
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      await writePhoneSnapshots(ws);
    } catch (error) {
      report(error);
    } finally {
      running = false;
      if (again) {
        again = false;
        schedule();
      }
    }
  };
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(() => void run(), 2000);
    timer.unref();
  };
  let watcher: ReturnType<typeof watch> | undefined;
  try {
    watcher = watch(ws.root, { recursive: true }, (_event, file) => {
      if (file && !ignoredWorkspaceChange(file)) schedule();
    });
    watcher.on("error", () => {
      watcher?.close();
      watcher = undefined;
    });
  } catch {
    /* 不支持递归监听时由定时器刷新。 */
  }
  const off = subscribeWorkspaceBackup(ws, schedule);
  const interval = setInterval(schedule, 60000);
  interval.unref();
  schedule();
  return () => {
    closed = true;
    clearTimeout(timer);
    clearInterval(interval);
    watcher?.close();
    off();
  };
}
