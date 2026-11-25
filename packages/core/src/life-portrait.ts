import { lstatSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { assertAgentPath } from "./agent-file-policy.js";

const directory = "reviews/portrait/";
function generation(name: string) {
  if (name.length > 255) return null;
  const match = /^(\d{4}-\d{2}-\d{2})(?:-([2-9]|[1-9]\d+))?\.html$/.exec(name);
  if (!match?.[1] || match[0] !== name) return null;
  const time = Date.parse(match[1]);
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== match[1]) return null;
  return { date: match[1], number: BigInt(match[2] ?? "1") };
}

function portraitDirectory(root: string) {
  const reviews = join(root, "reviews");
  const folder = join(reviews, "portrait");
  if (
    !lstatSync(reviews, { throwIfNoEntry: false })?.isDirectory() ||
    !lstatSync(folder, { throwIfNoEntry: false })?.isDirectory()
  )
    return null;
  assertAgentPath(root, folder);
  return folder;
}

/** The home worker needs filenames only; generation order is independent of sync timestamps. */
export function latestPortrait(root: string): { root: string; file: string | null } {
  let file: string | null = null;
  let latest: ReturnType<typeof generation> = null;
  try {
    const folder = portraitDirectory(root);
    if (!folder) return { root, file: null };
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const item = generation(entry.name);
      if (
        item &&
        (!latest || item.date > latest.date || (item.date === latest.date && item.number > latest.number))
      ) {
        latest = item;
        file = directory + entry.name;
      }
    }
  } catch {
    // Removable or unavailable storage must not prevent Today from loading.
  }
  return { root, file };
}

/** Validate the exact saved link again before handing a local path to the native opener. */
export function portraitTarget(root: string, file: string): string | null {
  if (!file.startsWith(directory) || !generation(file.slice(directory.length))) return null;
  const folder = portraitDirectory(root);
  if (!folder) return null;
  const target = join(root, file);
  if (!lstatSync(target, { throwIfNoEntry: false })?.isFile()) return null;
  assertAgentPath(root, target);
  return target;
}
