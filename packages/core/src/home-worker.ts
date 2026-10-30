import { dirname } from "node:path";
import { parentPort, workerData } from "node:worker_threads";
import { historyReadInputs } from "./history.js";
import { readHome, readHomeSources } from "./home.js";
import { prepareOverview } from "./overview.js";
import {
  projectionExpiry,
  projectionManifest,
  projectionUnchanged,
  withHistoryInputs,
  writeProjection,
} from "./projection-cache.js";
import { Workspace } from "./workspace.js";
let workspace: Workspace | undefined;
type Request = { root: string; generation: number; summary?: boolean; summaryOnly?: boolean };
function summary(request: Request) {
  if (!workspace) return;
  try {
    const input = {
      root: workspace.root,
      state: dirname(workspace.resolve(".kaitu/cache", { internal: true })),
    };
    let manifest: ReturnType<typeof projectionManifest> | undefined;
    try {
      manifest = projectionManifest(input);
    } catch {
      /* Established readers still check originals. */
    }
    parentPort?.postMessage({
      summary: prepareOverview(workspace),
      input,
      manifest,
      generation: request.generation,
      summaryOnly: request.summaryOnly,
    });
  } catch (error) {
    parentPort?.postMessage({
      summaryError: error instanceof Error ? error.message : String(error),
      generation: request.generation,
      summaryOnly: request.summaryOnly,
    });
  }
}
async function build(request: Request) {
  const { root, generation } = request;
  try {
    if (!workspace || workspace.root !== root) workspace = new Workspace(root, { maintain: false });
    if (request.summaryOnly) {
      summary(request);
      return;
    }
    const input = {
      root: workspace.root,
      state: dirname(workspace.resolve(".kaitu/cache", { internal: true })),
    };
    let manifest: ReturnType<typeof projectionManifest> | undefined;
    try {
      manifest = projectionManifest(input);
    } catch {
      // Cache discovery must not hide originals the established reader can still read.
    }
    const now = new Date();
    const sources = await readHomeSources(workspace, now);
    const data = readHome(sources);
    const { today, timeZone, cutoff, metrics, proposedTasks, warnings } = sources.overview;
    const presentation = { today, timeZone, cutoff, metrics, proposedTasks, warnings };
    if (manifest) manifest = withHistoryInputs(manifest, historyReadInputs(workspace));
    if (manifest && !projectionUnchanged(input, manifest))
      parentPort?.postMessage({ changed: true, generation });
    else {
      const metadata = {
        timeZone: sources.overview.timeZone,
        day: data.today,
        expires: projectionExpiry(sources, now),
      };
      try {
        if (manifest)
          writeProjection(input, "home", {
            ...metadata,
            manifest,
            value: { data, presentation },
          });
      } catch {
        /* A cache write failure must not hide readable originals. */
      }
      parentPort?.postMessage({ data, presentation, ...metadata, generation });
      if (request.summary) summary(request);
    }
  } catch {
    parentPort?.postMessage({ error: "首页读取失败", generation });
  }
}
parentPort?.on("message", (request: Request) => {
  void build(request);
});
await build(workerData);
