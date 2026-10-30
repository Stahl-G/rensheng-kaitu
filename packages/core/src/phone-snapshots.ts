import { watch } from "node:fs";
import { dirname, join } from "node:path";
import { readExploration } from "./exploration.js";
import { agentCanRead } from "./exposure.js";
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
  writeProjection,
} from "./projection-cache.js";
import { schemas } from "./schema.js";
import { syncMode } from "./sync-location.js";
import { ignoredWorkspaceChange, readWorkbench } from "./workbench.js";
import { subscribeWorkspaceBackup, workspaceBackupStatus } from "./workspace-backup.js";
import type { Workspace } from "./workspace.js";

export function phoneReadable(ws: Workspace) {
  return syncMode(ws.root) !== "local" || workspaceBackupStatus(ws).connection?.enabled === true;
}
export type PhoneGenerator = { kind: "computer" } | { kind: "agent"; name: string; spec: 1 };

type Published = { since: number; generator: string; outputs: ProjectionManifest };
type PublishedCache = NonNullable<ReturnType<typeof readProjection<Published>>>;
const published = new WeakMap<Workspace, PublishedCache>();

// Building snapshots writes organizer bookkeeping and can create the phone directory. Those
// writes do not feed any phone projection; every other original and directory entry must match.
function unchangedSources(
  before: ProjectionManifest,
  after: ProjectionManifest,
  root: string,
  state: string,
) {
  const normalize = (manifest: ProjectionManifest) =>
    manifest
      .filter(([path]) => path !== join(state, "organizer.json"))
      .map(([path, stamp]) => [
        path,
        path === root || path === state ? stamp.split(":").slice(0, 2).join(":") : stamp,
      ]);
  return JSON.stringify(normalize(before)) === JSON.stringify(normalize(after));
}

export async function writePhoneSnapshots(
  ws: Workspace,
  now = new Date(),
  options: { force?: boolean; generator?: PhoneGenerator } = {},
) {
  if (!options.force && !phoneReadable(ws)) return 0;
  const input = { root: ws.root, state: dirname(ws.resolve(".kaitu/cache", { internal: true })) };
  const generator = JSON.stringify(options.generator ?? { kind: "computer" });
  let before: ProjectionManifest | undefined;
  try {
    const hit = published.get(ws) ?? readProjection<Published>(input, "phone", now);
    if (
      hit &&
      hit.root === input.root &&
      hit.state === input.state &&
      hit.value.generator === generator &&
      hit.value.since <= now.getTime() &&
      hit.day === projectionDay(now, hit.timeZone) &&
      (hit.expires === null || now.getTime() < hit.expires) &&
      projectionUnchanged(input, hit.manifest) &&
      projectionUnchanged(input, hit.value.outputs)
    ) {
      published.set(ws, hit);
      return 0;
    }
    before = projectionManifest(input);
  } catch {
    // Cache/index availability must not replace the original reader's error handling.
  }
  published.delete(ws);
  const sources = readWorkbench(ws, now);
  const data = await readOverviewPage(ws, now, sources);
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
  let writes = 0;
  let cacheable = true;
  const errors: Error[] = [];
  for (const [name, build] of Object.entries(snapshots)) {
    const file = `phone/${name}.json`;
    try {
      const value = { ...build(), generator: options.generator ?? { kind: "computer" } };
      cacheable = schemas().builtin(`phone-${name}.schema.json`)(value) && cacheable;
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
      if (unchangedSources(before, manifest, input.root, input.state)) {
        const expiry = Math.min(
          projectionExpiry(sources, now) ?? Number.POSITIVE_INFINITY,
          ...phoneReceipts(ws).map((receipt) => Date.parse(receipt.at) + 14 * 86400000 + 1),
        );
        const value: Published = {
          since: now.getTime(),
          generator,
          outputs: [...Object.keys(snapshots), "receipts"].map((name) => {
            const path = ws.resolve(`phone/${name}.json`);
            return [path, projectionFingerprint(path)];
          }),
        };
        writeProjection(input, "phone", {
          manifest,
          value,
          timeZone: data.timeZone,
          day: data.today,
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
