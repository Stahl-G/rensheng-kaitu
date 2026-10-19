import { parentPort, workerData } from "node:worker_threads";
import { reindexChats, searchChats, updateChatIndexFiles } from "./chat-search.js";
import type { DataProgress } from "./data-worker.js";
import { writeWorkspaceArchive } from "./workspace-export.js";
import { Workspace } from "./workspace.js";

const { root, operation, args, cancelled } = workerData;
const flag = new Int32Array(cancelled);
let lastProgress = 0;
let lastPhase = "";
const controls = {
  check: () => {
    if (Atomics.load(flag, 0)) throw new DOMException("Operation cancelled", "AbortError");
  },
  progress: (progress: DataProgress) => {
    if (
      progress.phase !== lastPhase ||
      performance.now() - lastProgress >= 200 ||
      progress.completed === progress.total
    ) {
      lastProgress = performance.now();
      lastPhase = progress.phase;
      parentPort?.postMessage({ progress });
    }
  },
};
try {
  controls.check();
  const ws = new Workspace(root, { maintain: false });
  let result: unknown;
  switch (operation) {
    case "export":
      result = writeWorkspaceArchive(ws, args.output, controls);
      break;
    case "search":
      result = searchChats(ws, args.query, { ...args.options, controls });
      break;
    case "reindex":
      result = reindexChats(ws, controls);
      break;
    case "index-update":
      updateChatIndexFiles(ws, args, controls);
      result = null;
      break;
    default:
      throw new Error("Unknown background operation");
  }
  controls.check();
  parentPort?.postMessage({ result });
} catch (error) {
  parentPort?.postMessage({
    error: {
      message: (error as Error).message,
      code:
        typeof (error as { code?: unknown }).code === "string"
          ? (error as { code: string }).code
          : "BACKGROUND_OPERATION",
      name: (error as Error).name,
    },
  });
}
