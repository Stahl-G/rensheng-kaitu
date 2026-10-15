import { chmodSync, cpSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parseDocument } from "yaml";
import { writeAgentsMd } from "./agents-md.js";
import { templateDir } from "./assets.js";
import { KaituError } from "./errors.js";
import { ensureHistory, snapshot } from "./history.js";
import { listModules } from "./modules.js";
import { populateSample } from "./sample.js";
import { templateVersion } from "./template-version.js";
import { assertTimeZone, isoInZone } from "./time.js";
import { Workspace } from "./workspace.js";

export const CONFIG_VERSION = 1;

/** 模板之外还要建的空目录（git 不保存空目录，所以不放进模板）。 */
const EMPTY_DIRS = [
  "me/reports",
  "me/data/tasks",
  "health/data/labs",
  "health/files",
  "feed/digests",
  "reviews/daily",
  "reviews/weekly",
  "reviews/monthly",
  "chats",
  "inbox/agents",
  "handoffs/daily",
  "handoffs/archive",
  "inbox/health",
  ".kaitu/cache",
];

export interface InitOptions {
  sample?: boolean;
  timeZone?: string;
  now?: Date;
}

export async function initWorkspace(root: string, opts: InitOptions = {}): Promise<Workspace> {
  if (existsSync(join(root, ".kaitu", "config.json"))) {
    throw new KaituError(`${root} 已经是开图工作区`, "ALREADY_INITIALIZED");
  }
  if (existsSync(root) && readdirSync(root).some((n) => n !== ".DS_Store")) {
    throw new KaituError(`${root} 不是空目录，换一个位置或先清空`, "NOT_EMPTY");
  }
  const tz = opts.timeZone ?? "Asia/Shanghai";
  assertTimeZone(tz);
  const now = opts.now ?? new Date();

  mkdirSync(root, { recursive: true });
  cpSync(templateDir(), root, { recursive: true });
  const ws = new Workspace(root);
  for (const d of EMPTY_DIRS) mkdirSync(join(ws.root, d), { recursive: true });

  if (tz !== "Asia/Shanghai") {
    const text = ws.readText("me/rules.md");
    const end = text.indexOf("\n---", 4);
    const doc = parseDocument(text.slice(4, end));
    doc.set("timezone", tz);
    ws.writeText("me/rules.md", `---\n${doc.toString().trimEnd()}${text.slice(end)}`);
  }

  ws.writeJson(
    ".kaitu/config.json",
    {
      version: CONFIG_VERSION,
      template_version: templateVersion(),
      created: isoInZone(now, tz),
      modules: listModules(ws).map((m) => m.dir),
      sources: {},
    },
    { internal: true },
  );
  ws.writeJson(".kaitu/secrets.json", {}, { internal: true, mode: 0o600 });
  chmodSync(join(ws.root, ".kaitu", "secrets.json"), 0o600);
  writeAgentsMd(ws);

  await ensureHistory(ws);
  await snapshot(ws, "初始化开图工作区", now);
  if (opts.sample) await populateSample(ws, now);
  return ws;
}
