import { dirname } from "node:path";
import { parentPort, workerData } from "node:worker_threads";
import { readHome, readHomeSources } from "./home.js";
import {
  projectionExpiry,
  projectionManifest,
  projectionUnchanged,
  writeProjection,
} from "./projection-cache.js";
import { Workspace } from "./workspace.js";
let workspace: Workspace | undefined;
async function build(root: string, generation: number) {
  try {
    if (!workspace || workspace.root !== root) workspace = new Workspace(root, { maintain: false });
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
          writeProjection(input, "home", { ...metadata, manifest, value: { data, presentation } });
      } catch {
        /* A cache write failure must not hide readable originals. */
      }
      parentPort?.postMessage({ data, presentation, ...metadata, generation });
    }
  } catch {
    parentPort?.postMessage({ error: "首页读取失败", generation });
  }
}
parentPort?.on("message", ({ root, generation }) => {
  void build(root, generation);
});
await build(workerData.root, workerData.generation);
