import { watch } from "node:fs";
import { readExploration } from "./exploration.js";
import { agentCanRead } from "./exposure.js";
import { rememberComputerSnapshot, rememberOrganizer } from "./organizer.js";
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
export type PhoneGenerator = { kind: "computer" } | { kind: "agent"; name: string; spec: 1 };

export async function writePhoneSnapshots(
  ws: Workspace,
  now = new Date(),
  options: { force?: boolean; generator?: PhoneGenerator } = {},
) {
  if (!options.force && !phoneReadable(ws)) return 0;
  const data = await readOverviewPage(ws, now);
  const computer = options.generator?.kind !== "agent";
  if (computer)
    rememberOrganizer(
      ws,
      ws.exists("phone/today.json") ? ws.readText("phone/today.json") : undefined,
      undefined,
      data.daily ?? undefined,
      now,
    );
  const at = now.toISOString();
  const snapshots = {
    today: () => buildPhoneToday(data, at, ws),
    week: () => buildPhoneWeek(data, at),
    map: () => buildPhoneMap(data, lifeMap(ws, now), readExploration(ws), at),
    library: () => buildPhoneLibrary(ws, data, at),
  };
  let writes = 0;
  const errors: Error[] = [];
  for (const [name, build] of Object.entries(snapshots)) {
    const file = `phone/${name}.json`;
    try {
      const value = { ...build(), generator: options.generator ?? { kind: "computer" } };
      if (ws.exists(file)) {
        const previous = ws.readJson<typeof value>(file);
        if ("navigation" in value && value.navigation.status === "unavailable" && "navigation" in previous)
          value.navigation.files = previous.navigation.files.filter((file) =>
            agentCanRead(ws, file.path, { id: "handover", finance: false }),
          );
        if (JSON.stringify({ ...value, generated_at: previous.generated_at }) === JSON.stringify(previous))
          continue;
      }
      ws.writeJson(file, value);
      if (name === "today" && computer) rememberComputerSnapshot(ws, now);
      writes++;
    } catch (cause) {
      errors.push(
        new Error(`${file} 生成失败：${cause instanceof Error ? cause.message : String(cause)}`, { cause }),
      );
    }
  }
  writes += writePhoneReceipts(ws, [], now);
  if (errors.length) throw new AggregateError(errors, errors.map((error) => error.message).join("；"));
  return writes;
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
