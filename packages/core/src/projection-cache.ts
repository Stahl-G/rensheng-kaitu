import { createHash, randomUUID } from "node:crypto";
import {
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { localStateRoot } from "./local-state.js";

// Disposable implementation data, never part of a workspace or its synchronization format.
const version = 2;
export type ProjectionInputs = { root: string; state: string };
export type ProjectionManifest = [path: string, stamp: string][];
type Projection<T> = {
  version: number;
  root: string;
  state: string;
  timeZone: string;
  day: string;
  expires: number | null;
  manifest: ProjectionManifest;
  value: T;
};
const inside = (root: string, path: string) => {
  const rel = relative(root, path);
  return !isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`);
};
const digest = (text: string) => createHash("sha256").update(text).digest("hex");

export function projectionDirectory(input: ProjectionInputs): string | undefined {
  const base = resolve(localStateRoot(), "cache", "projections");
  // An explicitly configured local-state path may be inside a workspace; never cache there.
  if (inside(realpathSync(input.root), base)) return;
  return join(base, digest(`${realpathSync(input.root)}\0${realpathSync(input.state)}`));
}

function stamp(path: string): string {
  try {
    const item = lstatSync(path, { bigint: true });
    const fields = [item.ino, item.mode, item.size, item.mtimeNs, item.ctimeNs].join(":");
    if (!item.isSymbolicLink()) return fields;
    const target = statSync(path, { bigint: true });
    return `${fields}:${readlinkSync(path)}:${target.ino}:${target.mode}:${target.size}:${target.mtimeNs}:${target.ctimeNs}`;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "missing";
    throw error;
  }
}

/** Directory fingerprints detect additions/deletions; file fingerprints detect in-place edits. */
export function projectionManifest(input: ProjectionInputs): ProjectionManifest {
  const entries = new Map<string, string>();
  const walk = (path: string, state: boolean, relativePath = "") => {
    entries.set(path, stamp(path));
    if (entries.get(path) === "missing" || !lstatSync(path).isDirectory()) return;
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      if ([".git", "node_modules", ".DS_Store"].includes(entry.name) || entry.name.endsWith(".tmp")) continue;
      const child = relativePath ? `${relativePath}/${entry.name}` : entry.name;
      if (!state && [".kaitu", "phone", "OVERVIEW.md", "USER.md"].includes(child)) continue;
      if (state && (child === "cache" || child.startsWith("index.sqlite") || child === "secrets.json"))
        continue;
      walk(join(path, entry.name), state, child);
    }
  };
  walk(resolve(input.root), false);
  walk(resolve(input.state), true);
  const config = join(input.root, ".kaitu/config.json");
  entries.set(config, stamp(config));
  const preferences = join(localStateRoot(), "preferences.json");
  entries.set(preferences, stamp(preferences));
  return [...entries];
}

export function projectionUnchanged(input: ProjectionInputs, manifest: ProjectionManifest): boolean {
  const preferences = join(localStateRoot(), "preferences.json");
  return manifest.every(
    ([path, before]) =>
      (inside(input.root, path) || inside(input.state, path) || path === preferences) &&
      stamp(path) === before,
  );
}

const dayFormats = new Map<string, Intl.DateTimeFormat>();
export function projectionDay(now: Date, timeZone: string): string {
  let format = dayFormats.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    dayFormats.set(timeZone, format);
  }
  return format.format(now);
}

/** A future source timestamp may enter a time-filtered view before the next local midnight. */
export function projectionExpiry(value: unknown, now: Date): number | null {
  let expires = Number.POSITIVE_INFINITY;
  const visit = (item: unknown) => {
    if (typeof item === "string" && /^\d{4}-\d{2}-\d{2}T/.test(item)) {
      const time = Date.parse(item);
      if (time > now.getTime()) expires = Math.min(expires, time);
    } else if (item && typeof item === "object") for (const child of Object.values(item)) visit(child);
  };
  visit(value);
  return Number.isFinite(expires) ? expires : null;
}

export function readProjection<T>(
  input: ProjectionInputs,
  name: string,
  now = new Date(),
): Projection<T> | undefined {
  try {
    const directory = projectionDirectory(input);
    if (!directory) return;
    const actual = realpathSync(directory);
    if (inside(realpathSync(input.root), actual) || !inside(realpathSync(localStateRoot()), actual)) return;
    const path = join(directory, `${name}.json`);
    if (!lstatSync(path).isFile()) return;
    const { checksum, content } = JSON.parse(readFileSync(path, "utf8")) as {
      checksum: string;
      content: string;
    };
    if (typeof content !== "string" || checksum !== digest(content)) return;
    const item = JSON.parse(content) as Projection<T>;
    if (
      item.version !== version ||
      item.root !== input.root ||
      item.state !== input.state ||
      item.day !== projectionDay(now, item.timeZone) ||
      (item.expires !== null && item.expires <= now.getTime()) ||
      !Array.isArray(item.manifest) ||
      !item.manifest.length ||
      !projectionUnchanged(input, item.manifest)
    )
      return;
    return item;
  } catch {
    // Missing, obsolete, corrupt or inaccessible caches never replace original-file checks.
  }
}

export function writeProjection<T>(
  input: ProjectionInputs,
  name: string,
  data: Pick<Projection<T>, "value" | "timeZone" | "day" | "expires" | "manifest">,
): void {
  const directory = projectionDirectory(input);
  if (!directory) return;
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const actual = realpathSync(directory);
  if (inside(realpathSync(input.root), actual) || !inside(realpathSync(localStateRoot()), actual)) return;
  const content = JSON.stringify({ version, ...input, ...data });
  const path = join(directory, `${name}.json`);
  const temp = join(dirname(path), `.${name}.${randomUUID()}.tmp`);
  try {
    writeFileSync(temp, JSON.stringify({ checksum: digest(content), content }), { mode: 0o600, flag: "wx" });
    renameSync(temp, path);
  } finally {
    rmSync(temp, { force: true });
  }
}
