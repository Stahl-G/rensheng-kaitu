import kaituPackage from "../../cli/package.json" with { type: "json" };
import { readAutomation } from "./automation.js";
import { driveStatus } from "./drive.js";
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
export * from "./workspace-export.js";
