import { createHash, randomUUID } from "node:crypto";
import { lstatSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { agentCanRead } from "./exposure.js";
import { parseFrontmatter, stringifyFrontmatter } from "./frontmatter.js";
import { redact, userProfileSections } from "./handover.js";
import { type Locale, pick } from "./locale.js";
import { findRecordType, listModules, recordFilePattern } from "./modules.js";
import { placeholderOriginal, syncInventory } from "./sync-files.js";
import type { Workspace } from "./workspace.js";

const setting = ".kaitu/user-profile.json";
const file = "USER.md";
const unavailable = (locale: Locale) =>
  pick(
    locale,
    "画像暂不可用，请读 me/ 和 memory/ 正本；来源下载齐全后会重新生成。",
    "Profile unavailable. Read the originals in me/ and memory/; regeneration waits for all sources.",
  );

/** Shared, disposable discovery view. No memory titles, finance, summaries or record rows. */
export function userNavigation(ws: Workspace) {
  const reader = { id: "handover", finance: false } as const;
  const modules = listModules(ws)
    .filter((module) => agentCanRead(ws, `${module.dir}/module.json`, reader))
    .map((module) => ({ path: `${module.dir}/module.json`, title: redact(module.def.name, "zh-CN") }));
  const paths = new Set(["NOW.md", "me/profile.md", "me/rules.md", "me/goals.json", "me/STATUS.md"]);
  let available = true;
  // Match the established project/topic layout; attachments, JSONL and private memories stay out.
  for (const directory of ["projects", "learning", "decisions"]) {
    if (!agentCanRead(ws, directory, reader)) continue;
    const inventory = syncInventory(ws.root, directory, true);
    const supported = (path: string) =>
      /^(projects|learning|decisions)\/[^/.][^/]*\/(STATUS|log|notes)\.md$/.test(path);
    if (inventory.unavailable.some((path) => supported(path) || !path.split("/").at(-1)?.includes(".")))
      available = false;
    for (const path of inventory.files) if (supported(path)) paths.add(path);
  }
  const files: { path: string; title: string; updated_at: string }[] = [];
  for (const path of [...paths].sort()) {
    if (!agentCanRead(ws, path, reader)) continue;
    if (ws.isUnavailable(path)) {
      available = false;
      continue;
    }
    if (!ws.exists(path)) continue;
    const title = ws.scanParsed(path, "agent-navigation-title", (text) => {
      // A missing/invalid summary never makes an original undiscoverable.
      try {
        const { data, body } = parseFrontmatter(text);
        return redact(
          typeof data.title === "string" ? data.title : (body.match(/^# +(.+)$/m)?.[1] ?? path),
          "zh-CN",
        ).slice(0, 120);
      } catch {
        return path;
      }
    });
    if (title === undefined) {
      available = false;
      continue;
    }
    files.push({ path, title, updated_at: lstatSync(ws.resolve(path)).mtime.toISOString() });
  }
  return { version: 1, status: available ? "available" : "unavailable", modules, files };
}

/** Explicit designation only: other computers keep writing originals, never elect themselves. */
export function configureProfilePublisher(ws: Workspace, enabled: boolean) {
  const publisher = ws.exists(setting) ? ws.readJson<{ publisher: string | null }>(setting).publisher : null;
  ws.writeJson(setting, { publisher: enabled ? (publisher ?? randomUUID()) : null }, { internal: true });
  if (
    !enabled &&
    publisher &&
    !ws.isUnavailable(file) &&
    ws.exists(file) &&
    parseFrontmatter(ws.readText(file)).data.publisher === publisher
  )
    rmSync(ws.resolve(file));
  const result = refreshUserProfile(ws);
  if (enabled && ["other-publisher", "unmanaged"].includes(result.status))
    ws.writeJson(setting, { publisher: null }, { internal: true });
  return result;
}

function sourceFingerprint(ws: Workspace, navigation: ReturnType<typeof userNavigation>): string {
  const files = new Set([".kaitu/config.json", "me/goals.json", "me/rules.md"]);
  const collect = (dir: string, accept: (file: string) => boolean) => {
    const inventory = syncInventory(ws.root, dir, true);
    const needed = (path: string) => accept(path) || !path.split("/").at(-1)?.includes(".");
    if (inventory.unavailable.some(needed) || inventory.conflicts.some(needed))
      throw new Error("Source unavailable");
    for (const file of inventory.files) if (accept(file)) files.add(file);
  };
  for (const entry of readdirSync(ws.resolve("memory"))) {
    const path = `memory/${entry}`;
    const original = (placeholderOriginal(path) ?? path).replaceAll("\\", "/");
    if (original.endsWith(".md") && original !== "memory/MEMORY.md") collect(original, () => true);
  }
  // Only project metadata is a source; do not traverse attachments or architecture exports.
  for (const entry of readdirSync(ws.resolve("projects"), { withFileTypes: true })) {
    const path = `projects/${entry.name}`;
    if (placeholderOriginal(path) || ws.conflictCopy(path)) throw new Error("Source unavailable");
    if (entry.isDirectory())
      for (const name of ["STATUS.md", "log.md"]) collect(`${path}/${name}`, () => true);
  }
  for (const type of ["task", "direction", "exploration_experiment", "phase", "project_metric"]) {
    const ref = findRecordType(ws, type);
    files.add(`${ref.module.dir}/module.json`);
    const { dir, match } = recordFilePattern(ref);
    collect(dir, (path) => match.test(path.slice(dir.length + 1)));
  }
  const hash = createHash("sha256").update(JSON.stringify(navigation));
  for (const file of [...files].sort()) {
    if (!lstatSync(ws.resolve(file, { internal: true })).isFile()) throw new Error("Source unavailable");
    hash.update(file).update("\0").update(ws.readBytes(file)).update("\0");
  }
  return hash.digest("hex");
}

/** Disposable output, deliberately bypassing original-file download/history write guards. */
export function refreshUserProfile(ws: Workspace, now = new Date(), locale: Locale = "zh-CN") {
  const publisher = ws.exists(setting) ? ws.readJson<{ publisher: string | null }>(setting).publisher : null;
  if (!publisher) return { status: "disabled" };
  const path = ws.resolve(file);
  // Never hydrate an old output, or overwrite a file owned by another publisher/user.
  const evicted = ws.isUnavailable(file);
  let previous = "";
  if (!evicted && ws.exists(file)) {
    if (!lstatSync(path).isFile()) return { status: "unmanaged" };
    previous = readFileSync(path, "utf8");
    if (parseFrontmatter(previous).data.publisher !== publisher) return { status: "other-publisher" };
  }
  let based_on = "unavailable";
  let body = unavailable(locale);
  try {
    const navigation = userNavigation(ws);
    if (navigation.status !== "available") throw new Error("Navigation unavailable");
    based_on = sourceFingerprint(ws, navigation);
    const sections = userProfileSections(ws, locale, now).filter((section) => section.defaultOn);
    const lines = [pick(locale, "# 用户近况", "# User profile")];
    // Reserve space for identity and each active section; a long task list cannot crowd them out.
    for (const section of sections) {
      const selected = [`## ${section.title}`];
      for (const line of section.lines.slice(0, 10)) {
        if (Buffer.byteLength([...selected, line].join("\n")) > 340) break;
        selected.push(line);
      }
      if (selected.length > 1) lines.push("", ...selected);
    }
    lines.push(
      "",
      pick(locale, "## 按需查原文", "## Read originals on demand"),
      pick(
        locale,
        "NOW.md：核对计划日期；身份与重点见 me/。目录不含全文，未命中不代表没有。",
        "NOW.md: check the plan date; identity and priorities are in me/. This directory is not full-text search.",
      ),
    );
    for (const module of navigation.modules) {
      const line = `- ${module.title} (${module.path})`;
      if (Buffer.byteLength([...lines, line].join("\n")) > 3000) break;
      lines.push(line);
    }
    body = lines.join("\n");
  } catch {
    based_on = "unavailable";
  }
  const note = pick(
    locale,
    "程序生成，以正本为准。改动请提议到 inbox/agents/，不要编辑此文件。",
    "Generated from originals. Propose changes in inbox/agents/; do not edit this file.",
  );
  const render = (generated: string) => stringifyFrontmatter({ generated, publisher, based_on, note }, body);
  const oldTime = previous ? parseFrontmatter(previous).data.generated : undefined;
  if (typeof oldTime === "string" && previous === render(oldTime))
    return { status: based_on === "unavailable" ? "unavailable" : "current" };
  const text = render(now.toISOString());
  if (!evicted && !ws.exists(file)) {
    try {
      writeFileSync(path, text, { flag: "wx" });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      return { status: "other-publisher" };
    }
  } else {
    const temp = `${path}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temp, text);
      renameSync(temp, path);
    } finally {
      rmSync(temp, { force: true });
    }
  }
  if (evicted) rmSync(ws.resolve(".USER.md.icloud"), { force: true });
  return { status: based_on === "unavailable" ? "unavailable" : "current" };
}
