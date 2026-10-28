import { parentPort, workerData } from "node:worker_threads";
import { readHome, readHomeSources } from "./home.js";
import { Workspace } from "./workspace.js";
try {
  const workspace = new Workspace(workerData.root, { maintain: false });
  parentPort?.postMessage({ data: readHome(await readHomeSources(workspace)) });
} catch {
  parentPort?.postMessage({ error: "首页读取失败" });
}
