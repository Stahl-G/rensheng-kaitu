import { watch } from "node:fs";
import { readExploration } from "./exploration.js";
import { agentCanRead } from "./exposure.js";
import { phoneLifeAtlas, subscribeLifeAtlas } from "./life-atlas.js";
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
  // These are disposable outputs, not source records. A malformed old copy must not block rebuilding.
  function previous<T>(file: string): T | undefined {
    if (!ws.exists(file)) return;
    try {
      return ws.readJson<T>(file);
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      console.warn(`旧手机快照无法解析，将从正本重建：${file}`);
    }
  }
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
    today: buildPhoneToday(data, at, ws),
    week: buildPhoneWeek(data, at),
    map: buildPhoneMap(data, lifeMap(ws, now), readExploration(ws), at),
    library: buildPhoneLibrary(ws, data, at),
  };
  let writes = 0;
  for (const [name, snapshot] of Object.entries(snapshots)) {
    const value = { ...snapshot, generator: options.generator ?? { kind: "computer" } };
    const file = `phone/${name}.json`;
    const prior = previous<typeof value>(file);
    if (prior) {
      if ("navigation" in value && value.navigation.status === "unavailable" && "navigation" in prior)
        value.navigation.files = prior.navigation.files.filter((file) =>
          agentCanRead(ws, file.path, { id: "handover", finance: false }),
        );
      if (JSON.stringify({ ...value, generated_at: prior.generated_at }) === JSON.stringify(prior)) continue;
    }
    ws.writeJson(file, value);
    if (name === "today" && computer) rememberComputerSnapshot(ws, now);
    writes++;
  }
  const receipts = writePhoneReceipts(ws, [], now);
  // Atlas failure must not prevent Today, Week, Map, Library or receipts from being published.
  const atlas = computer ? phoneLifeAtlas(ws, now) : undefined;
  if (atlas) {
    const file = "phone/life-atlas.json";
    const prior = previous<typeof atlas>(file);
    if (!prior || JSON.stringify({ ...atlas, generated_at: prior.generated_at }) !== JSON.stringify(prior)) {
      const content = `${JSON.stringify(atlas, null, 2)}\n`;
      if (Buffer.byteLength(content) > 16 * 1024 * 1024)
        throw new Error("人生地图快照超过 16 MiB，已保留上次版本；请在电脑减少入图资料后重试");
      ws.writeText(file, content);
      writes++;
    }
  }
  return writes + receipts;
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
  const offAtlas = subscribeLifeAtlas(ws, schedule);
  const interval = setInterval(schedule, 60000);
  interval.unref();
  schedule();
  return () => {
    closed = true;
    clearTimeout(timer);
    clearInterval(interval);
    watcher?.close();
    off();
    offAtlas();
  };
}
