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
try {
  const workspace = new Workspace(workerData.root, { maintain: false });
  const input = {
    root: workspace.root,
    state: dirname(workspace.resolve(".kaitu/cache", { internal: true })),
  };
  const manifest = projectionManifest(input);
  const now = new Date();
  const sources = await readHomeSources(workspace, now);
  const data = readHome(sources);
  const { today, timeZone, cutoff, metrics, proposedTasks, warnings } = sources.overview;
  const presentation = { today, timeZone, cutoff, metrics, proposedTasks, warnings };
  if (!projectionUnchanged(input, manifest)) parentPort?.postMessage({ changed: true });
  else {
    const metadata = {
      timeZone: sources.overview.timeZone,
      day: data.today,
      expires: projectionExpiry(sources, now),
    };
    try {
      writeProjection(input, "home", { ...metadata, manifest, value: { data, presentation } });
    } catch {
      /* A cache write failure must not hide readable originals. */
    }
    parentPort?.postMessage({ data, presentation, ...metadata });
  }
} catch {
  parentPort?.postMessage({ error: "首页读取失败" });
}
