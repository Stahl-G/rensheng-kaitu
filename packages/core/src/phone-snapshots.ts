import { existsSync, watch } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { readExploration } from "./exploration.js";
import { agentCanRead } from "./exposure.js";
import { historyReadInputs } from "./history.js";
import { rememberComputerSnapshot, rememberOrganizer } from "./organizer.js";
import { readOverviewPage } from "./overview-page.js";
import { buildPhoneLibrary, buildPhoneMap, buildPhoneToday, buildPhoneWeek } from "./phone-projections.js";
import { phoneReceipts, writePhoneReceipts } from "./phone-receipts.js";
import { lifeMap } from "./places.js";
import {
  type ProjectionManifest,
  projectionDay,
  projectionExpiry,
  projectionFingerprint,
  projectionManifest,
  projectionUnchanged,
  readProjection,
  retainHistoryInputs,
  writeProjection,
} from "./projection-cache.js";
import { schemas } from "./schema.js";
import { syncMode } from "./sync-location.js";
import { ignoredWorkspaceChange, readWorkbench } from "./workbench.js";
import { subscribeWorkspaceBackup, workspaceBackupStatus } from "./workspace-backup.js";
import type { Workspace, WorkspaceWrite } from "./workspace.js";

export function phoneReadable(ws: Workspace) {
  return syncMode(ws.root) !== "local" || workspaceBackupStatus(ws).connection?.enabled === true;
}
export type PhoneGenerator = { kind: "computer" } | { kind: "agent"; name: string; spec: 1 };

type Published = { since: number; generator: string; outputs: ProjectionManifest };
type PublishedCache = NonNullable<ReturnType<typeof readProjection<Published>>>;
const published = new WeakMap<Workspace, PublishedCache>();

export function phoneSnapshotsCurrent(ws: Workspace, now: Date, generator?: PhoneGenerator): boolean {
  const input = { root: ws.root, state: dirname(ws.resolve(".kaitu/cache", { internal: true })) };
  try {
    const memory = published.get(ws);
    const hit = memory ?? readProjection<Published>(input, "phone", now);
    if (
      hit &&
      hit.root === input.root &&
      hit.state === input.state &&
      hit.value.generator === JSON.stringify(generator ?? { kind: "computer" }) &&
      hit.value.since <= now.getTime() &&
      hit.day === projectionDay(now, hit.timeZone) &&
      (hit.expires === null || now.getTime() < hit.expires) &&
      (!memory || projectionUnchanged(input, hit.manifest)) &&
      projectionUnchanged(input, hit.value.outputs)
    ) {
      published.set(ws, hit);
      return true;
    }
  } catch {
    // A missing index cannot replace original-file checks.
  }
  published.delete(ws);
  return false;
}

/** Read-only computation; the owner publishes through its existing mutation queue. */
export async function preparePhoneSnapshots(ws: Workspace, now: Date, generator?: PhoneGenerator) {
  const input = { root: ws.root, state: dirname(ws.resolve(".kaitu/cache", { internal: true })) };
  let before: ProjectionManifest | undefined;
  try {
    before = projectionManifest(input);
  } catch {
    /* Original reads still report their errors. */
  }
  const sources = readWorkbench(ws, now);
  const data = await readOverviewPage(ws, now, sources);
  const at = now.toISOString();
  const snapshots = {
    today: () => buildPhoneToday(data, at, ws),
    week: () => buildPhoneWeek(data, at),
    map: () => {
      const map = lifeMap(ws, now);
      if (map.warnings?.length)
        throw new Error(
          map.warnings.map((warning) => (typeof warning === "string" ? warning : warning.message)).join("; "),
        );
      return buildPhoneMap(data, map, readExploration(ws), at);
    },
    library: () => buildPhoneLibrary(ws, data, at),
  };
  let cacheable = true;
  const prepared = Object.entries(snapshots).map(([name, build]) => {
    try {
      const value = { ...build(), generator: generator ?? { kind: "computer" as const } };
      cacheable = schemas().builtin(`phone-${name}.schema.json`)(value) && cacheable;
      return { name, value, error: undefined };
    } catch (error) {
      return { name, value: undefined, error: error instanceof Error ? error.message : String(error) };
    }
  });
  return {
    historyInputs: historyReadInputs(ws),
    input,
    before,
    snapshots: prepared,
    cacheable,
    timeZone: data.timeZone,
    day: data.today,
    daily: data.daily,
    expires: projectionExpiry(sources, now),
  };
}
export type PreparedPhoneSnapshots = Awaited<ReturnType<typeof preparePhoneSnapshots>>;

export function publishPhoneSnapshots(
  ws: Workspace,
  prepared: PreparedPhoneSnapshots,
  now: Date,
  generator?: PhoneGenerator,
) {
  const { input, before } = prepared;
  if (ws.root !== input.root) throw new Error("快照工作区已经改变");
  const computer = generator?.kind !== "agent";
  if (computer)
    rememberOrganizer(
      ws,
      ws.exists("phone/today.json") ? ws.readText("phone/today.json") : undefined,
      undefined,
      prepared.daily ?? undefined,
      now,
    );
  let writes = 0;
  const cacheable = prepared.cacheable;
  const errors: Error[] = [];
  for (const { name, value: built, error } of prepared.snapshots) {
    const file = `phone/${name}.json`;
    try {
      if (!built) throw new Error(error);
      const value = built;
      if (ws.exists(file)) {
        let previous: typeof value | undefined;
        try {
          const parsed = ws.readJson<typeof value>(file);
          if (schemas().builtin(`phone-${name}.schema.json`)(parsed)) previous = parsed;
        } catch (error) {
          if (!(error instanceof SyntaxError)) throw error;
        }
        if (previous) {
          if ("navigation" in value && value.navigation.status === "unavailable" && "navigation" in previous)
            value.navigation.files = previous.navigation.files.filter((file) =>
              agentCanRead(ws, file.path, { id: "handover", finance: false }),
            );
          if (JSON.stringify({ ...value, generated_at: previous.generated_at }) === JSON.stringify(previous))
            continue;
        }
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
  if (before && cacheable) {
    try {
      const manifest = projectionManifest(input);
      if (JSON.stringify(before) === JSON.stringify(manifest)) {
        const expiry = Math.min(
          prepared.expires ?? Number.POSITIVE_INFINITY,
          ...phoneReceipts(ws).map((receipt) => Date.parse(receipt.at) + 14 * 86400000 + 1),
        );
        const value: Published = {
          since: now.getTime(),
          generator: JSON.stringify(generator ?? { kind: "computer" }),
          outputs: [...prepared.snapshots.map((item) => item.name), "receipts"].map((name) => {
            const path = ws.resolve(`phone/${name}.json`);
            return [path, projectionFingerprint(path)];
          }),
        };
        writeProjection(input, "phone", {
          manifest: retainHistoryInputs(input, manifest, prepared.historyInputs),
          value,
          timeZone: prepared.timeZone,
          day: prepared.day,
          expires: Number.isFinite(expiry) ? expiry : null,
        });
        const saved = readProjection<Published>(input, "phone", now);
        if (saved) published.set(ws, saved);
      }
    } catch {
      // Successful publication remains successful if its disposable marker cannot be saved.
    }
  }
  return writes;
}

export async function writePhoneSnapshots(
  ws: Workspace,
  now = new Date(),
  options: { force?: boolean; generator?: PhoneGenerator } = {},
) {
  if (!options.force && !phoneReadable(ws)) return 0;
  if (phoneSnapshotsCurrent(ws, now, options.generator)) return 0;
  return publishPhoneSnapshots(
    ws,
    await preparePhoneSnapshots(ws, now, options.generator),
    now,
    options.generator,
  );
}

/** 常驻进程在后台生成，监听只负责失效；同步盘漏事件时每分钟补看一次。 */
export function startPhoneSnapshots(
  ws: Workspace,
  report: (error: unknown) => void = () => {},
  write: WorkspaceWrite = (operation) => operation(),
) {
  let timer: NodeJS.Timeout | undefined;
  let running = false;
  let again = false;
  let closed = false;
  let generation = 0;
  let worker: Worker | undefined;
  let retiring: Promise<unknown> = Promise.resolve();
  function retire(active: Worker) {
    if (worker === active) worker = undefined;
    retiring = Promise.all([retiring, active.terminate()]);
  }
  function prepare(root: string, now: Date): Promise<PreparedPhoneSnapshots | undefined> {
    if (!worker) {
      const entry = [
        "./phone-worker.js",
        "../dist/phone-worker.js",
        "../engine/phone-worker.js",
        "../../dist/engine/phone-worker.js",
      ]
        .map((path) => new URL(path, import.meta.url))
        .find((path) => existsSync(fileURLToPath(path)));
      if (!entry) return Promise.reject(new Error("手机快照组件缺失"));
      worker = new Worker(entry);
      const active = worker;
      active.once("exit", () => {
        if (worker === active) worker = undefined;
      });
      active.on("error", (error) => {
        if (running) return; // The pending request owns its rejection and retirement.
        retire(active);
        if (!closed) report(error);
      });
    }
    const active = worker;
    active.ref();
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timeout);
        active.off("message", received);
        active.off("error", failed);
        active.off("exit", exited);
        active.unref();
      };
      const failed = (error: Error) => {
        cleanup();
        retire(active);
        reject(error);
      };
      const exited = () => {
        cleanup();
        reject(new Error("手机快照读取中断"));
      };
      const received = (message: { prepared?: PreparedPhoneSnapshots; error?: string }) => {
        cleanup();
        if (message.error) reject(new Error(message.error));
        else resolve(message.prepared);
      };
      const timeout = setTimeout(() => failed(new Error("手机快照读取超时")), 30000);
      active.once("message", received);
      active.once("error", failed);
      active.once("exit", exited);
      active.postMessage({ root, at: now.toISOString() });
    });
  }
  const run = async () => {
    if (closed) return;
    if (watchedRoot !== ws.root) observe();
    if (!phoneReadable(ws)) return;
    if (running) {
      again = true;
      return;
    }
    running = true;
    const root = ws.root;
    const request = generation;
    try {
      const now = new Date();
      const prepared = await prepare(root, now);
      if (closed) return;
      if (ws.root !== root || request !== generation) {
        again = true;
        return;
      }
      if (prepared)
        await write(async () => {
          if (closed) return;
          if (
            ws.root !== root ||
            request !== generation ||
            (prepared.before && !projectionUnchanged(prepared.input, prepared.before))
          ) {
            again = true;
            return;
          }
          publishPhoneSnapshots(ws, prepared, now);
        });
    } catch (error) {
      if (!closed) report(error);
    } finally {
      running = false;
      if (again) {
        again = false;
        schedule();
      }
    }
  };
  const schedule = () => {
    if (closed) return;
    generation++;
    clearTimeout(timer);
    timer = setTimeout(() => void run(), 2000);
    timer.unref();
  };
  let watchers: ReturnType<typeof watch>[] = [];
  let watchedRoot = "";
  function observe() {
    for (const watcher of watchers) watcher.close();
    watchers = [];
    watchedRoot = ws.root;
    const state = dirname(ws.resolve(".kaitu/cache", { internal: true }));
    for (const root of new Set([ws.root, state])) {
      try {
        const watcher = watch(root, { recursive: true }, (_event, file) => {
          const path = String(file ?? "").replaceAll("\\", "/");
          if (!path || !ignoredWorkspaceChange(root === ws.root ? path : `.kaitu/${path}`)) schedule();
        });
        watcher.unref();
        watcher.on("error", () => {
          watcher.close();
          schedule();
        });
        watchers.push(watcher);
      } catch {
        /* Periodic refresh covers systems without recursive watches. */
      }
    }
  }
  observe();
  const off = subscribeWorkspaceBackup(ws, schedule);
  const interval = setInterval(schedule, 60000);
  interval.unref();
  schedule();
  return async () => {
    closed = true;
    clearTimeout(timer);
    clearInterval(interval);
    for (const watcher of watchers) watcher.close();
    off();
    if (worker) retire(worker);
    await retiring;
  };
}
