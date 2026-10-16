import { readdirSync } from "node:fs";
import { zipSync } from "fflate";
import kaituPackage from "../../cli/package.json" with { type: "json" };
import { assertAgentPath } from "./agent-file-policy.js";
import { readAutomation } from "./automation.js";
import { driveStatus } from "./drive.js";
import { history } from "./history.js";
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
export function exportWorkspace(ws: Workspace) {
  const entries: Record<string, Uint8Array> = {};
  const walk = (path: string, prefix: string) => {
    for (const entry of readdirSync(ws.resolve(path, { internal: true }), { withFileTypes: true })) {
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
      }
    }
  };
  walk("", "");

  return {
    name: `kaitu-${new Date().toISOString().slice(0, 10)}.zip`,
    base64: Buffer.from(zipSync(entries)).toString("base64"),
  };
}
