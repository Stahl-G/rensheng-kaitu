import { lstatSync, readdirSync } from "node:fs";
import { agentReadFilter } from "./exposure.js";
import { parseFrontmatter } from "./frontmatter.js";
import { deepFreeze } from "./frozen.js";
import { redact } from "./handover.js";
import { listModules } from "./modules.js";
import { placeholderOriginal } from "./sync-files.js";
import type { Workspace } from "./workspace.js";

/** Shared, disposable discovery view. No memory titles, finance, summaries or record rows. */
export function userNavigation(ws: Workspace) {
  const reader = { id: "handover", finance: false } as const;
  const canRead = agentReadFilter(ws, reader);
  const modules = listModules(ws)
    .filter((module) => canRead(`${module.dir}/module.json`))
    .map((module) => ({ path: `${module.dir}/module.json`, title: redact(module.def.name, "zh-CN") }));
  const paths = new Set(["NOW.md", "me/profile.md", "me/rules.md", "me/goals.json", "me/STATUS.md"]);
  let available = true;
  // Match the established project/topic layout; attachments, JSONL and private memories stay out.
  for (const directory of ["projects", "learning", "decisions"]) {
    if (!canRead(directory)) continue;
    if (ws.isUnavailable(directory)) {
      available = false;
      continue;
    }
    if (!ws.exists(directory)) continue;
    for (const entry of readdirSync(ws.resolve(directory), { withFileTypes: true })) {
      const child = `${directory}/${entry.name}`;
      const original = placeholderOriginal(child);
      // Only immediate topic directories and the three indexed documents matter.
      if (original && !original.split("/").at(-1)?.includes(".")) {
        if (ws.isUnavailable(original)) available = false;
      } else if (entry.isDirectory() && !entry.name.startsWith(".")) {
        if (!canRead(child)) continue;
        if (ws.isUnavailable(child)) {
          available = false;
          continue;
        }
        for (const name of readdirSync(ws.resolve(child))) {
          const path = placeholderOriginal(`${child}/${name}`) ?? `${child}/${name}`;
          if (["STATUS.md", "log.md", "notes.md"].includes(path.slice(child.length + 1))) paths.add(path);
        }
      }
    }
  }
  const files: { path: string; title: string; updated_at: string }[] = [];
  for (const path of [...paths].sort()) {
    if (!canRead(path)) continue;
    if (ws.isUnavailable(path)) {
      available = false;
      continue;
    }
    if (!ws.exists(path)) continue;
    const title = ws.scanParsed(path, "agent-navigation-title", {
      read: (_text, read) => {
        // A missing/invalid summary never makes an original undiscoverable.
        try {
          const { data, body } = read("frontmatter", (text) => deepFreeze(parseFrontmatter(text)));
          return redact(
            typeof data.title === "string" ? data.title : (body.match(/^# +(.+)$/m)?.[1] ?? path),
            "zh-CN",
          ).slice(0, 120);
        } catch {
          return path;
        }
      },
    });
    if (title === undefined) {
      available = false;
      continue;
    }
    files.push({ path, title, updated_at: lstatSync(ws.resolve(path)).mtime.toISOString() });
  }
  return { version: 1, status: available ? "available" : "unavailable", modules, files };
}
