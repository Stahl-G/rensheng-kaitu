import { existsSync, readdirSync } from "node:fs";
import { KaituError } from "./errors.js";
import { type phoneHistoryMetadata, previewSnapshots } from "./history.js";
import { externalHealthPaths, processInbox } from "./inbox.js";
import { phoneReceipts } from "./phone-receipts.js";
import { type PhoneGenerator, writePhoneSnapshots } from "./phone-snapshots.js";
import { Workspace } from "./workspace.js";

export async function runPhone(
  root: string,
  generator: PhoneGenerator,
  baseline?: Awaited<ReturnType<typeof phoneHistoryMetadata>>,
) {
  const ws = new Workspace(root, { maintain: false });
  if (!ws.exists(".kaitu/config.json")) throw new KaituError("先运行 kaitu init", "NOT_INITIALIZED");
  const pending =
    ["inbox/agents", "inbox/health", "inbox/rejected"].some(
      (dir) =>
        ws.exists(dir) &&
        readdirSync(ws.resolve(dir), { withFileTypes: true }).some(
          (e) => e.isFile() && !e.name.endsWith(".tmp") && e.name !== ".DS_Store",
        ),
    ) ||
    externalHealthPaths(ws).some(
      (dir) => existsSync(dir) && readdirSync(dir).some((f) => f.endsWith(".health.json")),
    );
  const versions = baseline ? await previewSnapshots(ws, baseline, pending) : undefined;
  const inbox = pending ? await processInbox(ws) : { processed: [], notes: [], pending: [] };
  const snapshots = await writePhoneSnapshots(ws, new Date(), { force: true, generator });
  return {
    inbox,
    snapshots,
    receipts: phoneReceipts(ws),
    ...(versions ? { historyChanged: versions.length !== baseline?.versions.length } : {}),
  };
}

export { KaituError } from "./errors.js";
export { defaultRoot, stateDirectory } from "./workspace.js";
export { phoneHistoryMetadata } from "./history.js";
export type { PhoneGenerator } from "./phone-snapshots.js";
