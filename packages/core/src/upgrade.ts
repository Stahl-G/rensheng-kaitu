import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { writeAgentsMd } from "./agents-md.js";
import { templateDir } from "./assets.js";
import { doctor } from "./doctor.js";
import { GITIGNORE, snapshot } from "./history.js";
import { type ModuleDef, listModules } from "./modules.js";
import { batchOverview } from "./overview.js";
import { syncMode } from "./sync-location.js";
import { templateOutdated, templateVersion } from "./template-version.js";
import { validateWorkspace } from "./validate.js";
import { type Workspace, migrateHistory } from "./workspace.js";

function templateFiles(directory: string): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  function walk(path: string) {
    for (const entry of readdirSync(join(directory, path), { withFileTypes: true })) {
      const file = path ? `${path}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(file);
      else files.set(file, readFileSync(join(directory, file)));
    }
  }
  walk("");
  return files;
}

function additions<T>(existing: T[] | undefined, defaults: T[], key: (value: T) => string): T[] {
  const have = new Set((existing ?? []).map(key));
  return [...(existing ?? []), ...defaults.filter((item) => !have.has(key(item)))];
}

export async function upgradeWorkspace(ws: Workspace, options: { dryRun?: boolean } = {}) {
  const version = templateVersion();
  if (
    !templateOutdated(ws) &&
    (syncMode(ws.root) !== "drive" || ws.exists("ORGANIZER.md")) &&
    ws.exists("handoffs/daily") &&
    ws.exists("explore/module.json")
  )
    return { templateVersion: version, changes: [], version: null };
  if (!options.dryRun) ws.assertDownloaded();
  const files = templateFiles(templateDir());
  const writes = new Map<string, string | Buffer>();
  const deletes: string[] = [];
  for (const [file, bytes] of files) {
    if (!file.endsWith("/module.json") || file.split("/").length !== 2) continue;
    const dir = file.split("/")[0];
    const defaults: ModuleDef = JSON.parse(bytes.toString());
    if (!ws.exists(file)) {
      for (const [path, content] of files) {
        if (path.startsWith(`${dir}/`) && !ws.exists(path)) writes.set(path, content);
      }
      continue;
    }
    const existing = ws.readJson<ModuleDef>(file);
    const merged = { ...existing };
    if (defaults.records) merged.records = { ...defaults.records, ...existing.records };
    if (defaults.tabs) merged.tabs = additions(existing.tabs, defaults.tabs, (tab) => tab);
    if (defaults.sources)
      merged.sources = additions(
        existing.sources,
        defaults.sources,
        (source) => `${source.type}:${source.id ?? ""}`,
      );
    if (defaults.views)
      merged.views = additions(existing.views, defaults.views, (view) =>
        String((view as { title: string }).title),
      );
    if (JSON.stringify(merged) !== JSON.stringify(existing))
      writes.set(file, `${JSON.stringify(merged, null, 2)}\n`);
  }
  const feedFile = "feed/feeds.json";
  if (ws.exists(feedFile)) {
    const feeds = ws.readJson<Record<string, unknown>>(feedFile);
    if (feeds.muted === undefined)
      writes.set(feedFile, `${JSON.stringify({ ...feeds, muted: [] }, null, 2)}\n`);
  } else {
    const defaults = files.get(feedFile);
    if (defaults) writes.set(feedFile, defaults);
  }
  const skillRoot = ".agents/skills/";
  const builtinSkills = new Set(
    [...files.keys()].filter((file) => file.startsWith(skillRoot)).map((file) => file.split("/")[2]),
  );
  for (const name of builtinSkills) {
    for (const base of [".agents", ".claude"]) {
      const directory = `${base}/skills/${name}`;
      const desired = new Set<string>();
      for (const [file, bytes] of files) {
        if (!file.startsWith(`${skillRoot}${name}/`)) continue;
        const target = file.replace(".agents/", `${base}/`);
        desired.add(target);
        if (!ws.exists(target) || !ws.readBytes(target).equals(bytes)) writes.set(target, bytes);
      }
      if (ws.exists(directory)) {
        for (const path of templateFiles(ws.resolve(directory)).keys()) {
          const file = `${directory}/${path}`;
          if (!desired.has(file)) deletes.push(file);
        }
      }
    }
  }
  const ignore = ws.exists(".gitignore") ? ws.readText(".gitignore") : "";
  const missingIgnores = GITIGNORE.split("\n").filter(
    (line) => line && !line.startsWith("#") && !ignore.split("\n").includes(line),
  );
  if (missingIgnores.length)
    writes.set(".gitignore", `${ignore}${ignore.endsWith("\n") ? "" : "\n"}${missingIgnores.join("\n")}\n`);
  const changes = [
    ...writes.keys(),
    ...deletes.map((file) => `删除 ${file}`),
    "AGENTS.md",
    ...(syncMode(ws.root) === "drive" ? ["AGENT-README.md", "ORGANIZER.md"] : []),
    "OVERVIEW.md",
    ".kaitu/config.json",
  ];
  const directories = ["inbox/health", "handoffs/daily", "handoffs/archive"];
  for (const dir of directories) if (!ws.exists(dir)) changes.push(`${dir}/`);
  if (existsSync(join(ws.root, ".git"))) changes.push(".git → 本机状态目录/history.git");
  if (options.dryRun) return { templateVersion: version, changes, version: null };
  migrateHistory(ws.root);
  await batchOverview(ws, async () => {
    for (const dir of directories) mkdirSync(ws.resolve(dir), { recursive: true });
    for (const [file, content] of writes) ws.writeText(file, content);
    for (const file of deletes) rmSync(ws.resolve(file));
    writeAgentsMd(ws);
    const config = ws.readJson<Record<string, unknown>>(".kaitu/config.json");
    ws.writeJson(
      ".kaitu/config.json",
      { ...config, template_version: version, modules: listModules(ws).map((m) => m.dir) },
      { internal: true },
    );
  });
  const saved = await snapshot(ws, `开图升级到 ${version}`);
  const validation = validateWorkspace(ws);
  const checks = await doctor(ws);
  return { templateVersion: version, changes, version: saved, validation, checks };
}
