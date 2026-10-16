import { lstatSync, readdirSync } from "node:fs";
import { zipSync } from "fflate";
import kaituPackage from "../../cli/package.json" with { type: "json" };
import { assertAgentPath } from "./agent-file-policy.js";
import { readAutomation } from "./automation.js";
import { driveStatus } from "./drive.js";
import { KaituError } from "./errors.js";
import { history } from "./history.js";
import { localRecordIds } from "./private-records.js";
import { publicProject } from "./projects.js";
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
export function exportWorkspace(ws: Workspace, options: { includePrivate?: boolean } = {}) {
  const entries: Record<string, Uint8Array> = {};
  const privateIds = options.includePrivate ? new Set<string>() : localRecordIds(ws);
  const walk = (path: string, prefix: string) => {
    for (const entry of readdirSync(ws.resolve(path, { internal: true }), { withFileTypes: true })) {
      if (entry.isSymbolicLink() || entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const file = `${path ? `${path}/` : ""}${entry.name}`;
      if (!path.startsWith(".kaitu/local-projects")) {
        try {
          assertAgentPath(ws.root, file);
        } catch {
          continue;
        }
      }
      const slug = /^projects\/([^/]+)/.exec(file)?.[1];
      if (
        !options.includePrivate &&
        slug &&
        slug !== "data" &&
        entry.isDirectory() &&
        !publicProject(ws, slug)
      )
        continue;
      const name = `${prefix ? `${prefix}/` : ""}${entry.name}`;
      if (entry.isDirectory()) walk(file, name);
      else if (entry.isFile()) {
        let bytes = ws.readBytes(file);
        if (!options.includePrivate && file.endsWith(".jsonl")) {
          const lines = bytes
            .toString("utf8")
            .split("\n")
            .filter((line) => {
              if (!line.trim()) return false;
              const row = JSON.parse(line);
              return !privateIds.has(row.id);
            });
          bytes = Buffer.from(lines.length ? `${lines.join("\n")}\n` : "");
        }
        entries[name] = bytes;
      }
    }
  };
  walk("", "");
  if (options.includePrivate && ws.exists(".kaitu/local-projects")) {
    const privateRoot = ws.resolve(".kaitu/local-projects", { internal: true });
    if (lstatSync(privateRoot).isSymbolicLink()) throw new KaituError("私有资料目录不能是符号链接", "SCOPE");
    walk(".kaitu/local-projects", "local-projects");
  }

  return {
    name: `kaitu-${new Date().toISOString().slice(0, 10)}.zip`,
    base64: Buffer.from(zipSync(entries)).toString("base64"),
  };
}
