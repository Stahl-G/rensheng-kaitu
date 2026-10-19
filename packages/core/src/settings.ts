import { readdirSync } from "node:fs";
import { zipSync } from "fflate";
import kaituPackage from "../../cli/package.json" with { type: "json" };
import { assertAgentPath } from "./agent-file-policy.js";
import { readAutomation } from "./automation.js";
import type { IndexControls } from "./chat-search.js";
import { type DataProgress, type DataRunOptions, runDataWorker } from "./data-worker.js";
import { driveStatus } from "./drive.js";
import { KaituError } from "./errors.js";
import { history } from "./history.js";
import { organizerStatus } from "./organizer.js";
import { workspaceBackupStatus } from "./workspace-backup.js";
import type { Workspace } from "./workspace.js";

export interface NetworkSearchSettings {
  provider: string | null;
  name: string | null;
  configured: boolean;
  preferred: string;
  native?: {
    provider: string | null;
    name: string;
    supported: boolean;
    configured: boolean;
    reason?: string;
  };
  providers: { id: string; name: string; configured: boolean; keyUrl: string }[];
}

export async function readSettings(ws: Workspace) {
  return {
    automation: readAutomation(ws),
    organizer: organizerStatus(ws),
    backup: workspaceBackupStatus(ws),
    storage: driveStatus(ws),
    versions: await history(ws),
    version: kaituPackage.version,
    dshVersion: process.env.DSH_CLIENT_VERSION ?? null,
    timeZone: ws.timeZone(),
    ai: null as {
      configured: boolean;
      model: string;
      providerName?: string;
      search?: NetworkSearchSettings;
    } | null,
  };
}
export type SettingsData = Awaited<ReturnType<typeof readSettings>>;
export function exportWorkspace(ws: Workspace, controls: IndexControls = {}) {
  let completed = 0;
  controls.progress?.({ phase: "read", completed });
  const entries: Record<string, Uint8Array> = {};
  const walk = (path: string, prefix: string) => {
    controls.check?.();
    for (const entry of readdirSync(ws.resolve(path, { internal: true }), { withFileTypes: true })) {
      controls.check?.();
      if (entry.isSymbolicLink() || entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const file = `${path ? `${path}/` : ""}${entry.name}`;
      try {
        assertAgentPath(ws.root, file);
      } catch {
        continue;
      }
      const name = `${prefix ? `${prefix}/` : ""}${entry.name}`;
      if (entry.isDirectory()) walk(file, name);
      else if (entry.isFile()) {
        entries[name] = ws.readBytes(file);
        controls.progress?.({ phase: "read", completed: ++completed });
      }
    }
  };
  walk("", "");

  controls.check?.();
  controls.progress?.({ phase: "compress", completed, total: completed });
  return {
    name: `kaitu-${new Date().toISOString().slice(0, 10)}.zip`,
    base64: Buffer.from(zipSync(entries)).toString("base64"),
  };
}

export interface WorkspaceExportState {
  status: "idle" | "running" | "ready" | "failed" | "cancelled";
  progress?: DataProgress;
  error?: string;
  file?: { name: string; base64: string };
}
type ExportJob = {
  root: string;
  controller: AbortController;
  state: WorkspaceExportState;
  file?: { name: string; base64: string };
};
const exports = new WeakMap<Workspace, ExportJob>();
export function workspaceExportRequest(
  ws: Workspace,
  action: "start" | "status" | "cancel" | "result",
): WorkspaceExportState {
  let job = exports.get(ws);
  if (job && job.root !== ws.root) {
    job.controller.abort();
    exports.delete(ws);
    job = undefined;
  }
  if (action === "cancel") {
    job?.controller.abort();
    exports.delete(ws);
    return { status: "cancelled" };
  }
  if (action === "result") {
    if (!job?.file || job.state.status !== "ready")
      throw new KaituError("导出尚未完成，请稍后重试", "NOT_READY");
    const file = job.file;
    exports.delete(ws);
    return { status: "ready", file };
  }
  if (action === "start" && job?.state.status !== "running") {
    const next: ExportJob = {
      root: ws.root,
      controller: new AbortController(),
      state: { status: "running", progress: { phase: "read", completed: 0 } },
    };
    exports.set(ws, next);
    void runDataWorker<{ name: string; base64: string }>(ws, "export", undefined, {
      signal: next.controller.signal,
      progress: (progress) => {
        next.state.progress = progress;
      },
    }).then(
      (file) => {
        next.file = file;
        next.state.status = "ready";
      },
      () => {
        next.state = {
          status: "failed",
          error: "导出未完成，请检查资料可用性后重试 / Export incomplete; check file availability and retry",
        };
      },
    );
    job = next;
  }
  return job?.state ?? { status: "idle" };
}

export function exportWorkspaceAsync(ws: Workspace, options: DataRunOptions = {}) {
  return runDataWorker<{ name: string; base64: string }>(ws, "export", undefined, options);
}
