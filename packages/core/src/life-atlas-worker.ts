import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parentPort, workerData } from "node:worker_threads";
import { atlasSource } from "./life-atlas-source.js";
import { Workspace } from "./workspace.js";
try {
  if (workerData.kind === "source")
    parentPort?.postMessage({
      result: atlasSource(new Workspace(workerData.root, { maintain: false }), new Date(workerData.now)),
    });
  else {
    const { generateAtlas } = await import("@kaitu/cartographer");
    const resource = generateAtlas(
      join(workerData.directory, "cache"),
      workerData.seed,
      workerData.variant,
      workerData.settings,
      (stage, fraction) => parentPort?.postMessage({ progress: { stage, fraction } }),
    );
    mkdirSync(join(workerData.directory, "maps"), { recursive: true, mode: 0o700 });
    const file = join(workerData.directory, "maps", `${workerData.id}.json`);
    writeFileSync(`${file}.tmp`, JSON.stringify(resource), { mode: 0o600 });
    renameSync(`${file}.tmp`, file);
    parentPort?.postMessage({ result: { key: resource.key, terrainCacheHit: resource.terrainCacheHit } });
  }
} catch (error) {
  parentPort?.postMessage({ error: (error as Error).message });
}
