import { readFileSync, readdirSync } from "node:fs";
import { zipSync } from "fflate";
import { readAutomation } from "./automation.js";
import { driveStatus } from "./drive.js";
import { history } from "./history.js";
import type { Workspace } from "./workspace.js";

export async function readSettings(ws: Workspace) {
  return {
    automation: readAutomation(ws),
    storage: driveStatus(ws),
    versions: await history(ws),
    version: process.env.KAITU_APP_VERSION ?? null,
    dshVersion: process.env.DSH_CLIENT_VERSION ?? null,
    timeZone: ws.timeZone(),
    ai: null as { configured: boolean; model: string } | null,
  };
}
export type SettingsData = Awaited<ReturnType<typeof readSettings>>;
export function exportWorkspace(ws: Workspace) {
  const entries: Record<string, Uint8Array> = {};
  const walk = (path: string, prefix: string) => {
    for (const entry of readdirSync(ws.resolve(path, { internal: true }), { withFileTypes: true })) {
      if (entry.isSymbolicLink() || entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const file = `${path ? `${path}/` : ""}${entry.name}`;
      const name = `${prefix ? `${prefix}/` : ""}${entry.name}`;
      if (entry.isDirectory()) walk(file, name);
      else if (entry.isFile()) entries[name] = readFileSync(ws.resolve(file, { internal: true }));
    }
  };
  walk("", "");
  if (ws.exists(".kaitu/local-projects")) walk(".kaitu/local-projects", "local-projects");
  return {
    name: `kaitu-${new Date().toISOString().slice(0, 10)}.zip`,
    base64: Buffer.from(zipSync(entries)).toString("base64"),
  };
}
