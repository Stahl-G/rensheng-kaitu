import { parentPort } from "node:worker_threads";
import { phoneSnapshotsCurrent, preparePhoneSnapshots } from "./phone-snapshots.js";
import { Workspace } from "./workspace.js";

let workspace: Workspace | undefined;
parentPort?.on("message", async ({ root, at }: { root: string; at: string }) => {
  try {
    if (!workspace || workspace.root !== root) workspace = new Workspace(root, { maintain: false });
    const now = new Date(at);
    const prepared = phoneSnapshotsCurrent(workspace, now)
      ? undefined
      : await preparePhoneSnapshots(workspace, now);
    parentPort?.postMessage({ prepared });
  } catch (error) {
    parentPort?.postMessage({ error: error instanceof Error ? error.message : String(error) });
  }
});
