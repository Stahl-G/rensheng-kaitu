import { readdirSync } from "node:fs";
import { parseFrontmatter } from "./frontmatter.js";
import { projectStatus } from "./projects.js";
import type { Workspace } from "./workspace.js";

export interface Investment {
  ref: string;
  title: string;
  domain: "work" | "learning" | "personal";
  form: "project" | "ongoing";
  status: string;
}
export interface OngoingInvestment {
  id: string;
  title: string;
  domain: Investment["domain"];
  status: "active" | "paused" | "ended";
  note?: string;
  since?: string;
}
export function investmentOf(record: { investment?: unknown; project?: unknown; [key: string]: unknown }):
  | string
  | undefined {
  if (typeof record.investment === "string") return record.investment;
  if (typeof record.project === "string" && record.project) return `project:${record.project}`;
  return undefined;
}

/** 只读投入的状态文件，不汇总项目指标或扫描记录与原文。 */
export function listInvestments(ws: Workspace): Investment[] {
  const out: Investment[] = [];
  for (const directory of ["projects", "learning"] as const) {
    if (!ws.exists(directory)) continue;
    for (const entry of readdirSync(ws.resolve(directory), { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      const file = `${directory}/${entry.name}/STATUS.md`;
      if (!ws.exists(file)) continue;
      const data = ws.scanParsed(file, "investment", (text) => {
        const raw = parseFrontmatter(text).data;
        return (
          directory === "projects"
            ? projectStatus(raw as unknown as import("./projects.js").ProjectStatus, entry.name)
            : raw
        ) as Record<string, unknown>;
      });
      if (!data) continue;
      out.push({
        ref: `${directory === "projects" ? "project" : "learning"}:${entry.name}`,
        title: String(data.title || entry.name),
        domain: directory === "learning" ? "learning" : (data.kind as Investment["domain"]),
        form: directory === "projects" ? "project" : "ongoing",
        status: String(data.stage ?? data.status ?? "active"),
      });
    }
  }
  const ongoing = ws.exists("me/ongoing.json")
    ? (ws.scanParsed("me/ongoing.json", "ongoing", (text) => JSON.parse(text) as OngoingInvestment[]) ?? [])
    : [];
  for (const item of ongoing)
    out.push({
      ref: `ongoing:${item.id}`,
      title: item.title,
      domain: item.domain,
      form: "ongoing",
      status: item.status,
    });
  return out;
}
