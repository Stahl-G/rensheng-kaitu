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
const version = 3;
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

function canonicalDestination(path: string): string {
  let parent = path;
  for (;;) {
    try {
      return resolve(realpathSync(parent), relative(parent, path));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT" || dirname(parent) === parent) throw error;
      parent = dirname(parent);
    }
  }
}

export function projectionDirectory(input: ProjectionInputs): string | undefined {
  const base = resolve(localStateRoot(), "cache", "projections");
  // An explicitly configured local-state path may be inside a workspace; never cache there.
  if (inside(realpathSync(input.root), canonicalDestination(base))) return;
  return join(base, digest(`${realpathSync(input.root)}\0${realpathSync(input.state)}`));
}

export function projectionFingerprint(path: string): string {
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

function children(input: ProjectionInputs, path: string) {
  return readdirSync(path, { withFileTypes: true }).filter((entry) => {
    if ([".git", "node_modules", ".DS_Store"].includes(entry.name) || entry.name.endsWith(".tmp"))
      return false;
    if (path === input.root && [".kaitu", "phone", "OVERVIEW.md", "USER.md"].includes(entry.name))
      return false;
    return (
      path !== input.state ||
      (!["cache", "secrets.json", "organizer.json"].includes(entry.name) &&
        !entry.name.startsWith("index.sqlite"))
    );
  });
}
function directoryFingerprint(input: ProjectionInputs, path: string): string {
  const item = lstatSync(path, { bigint: true });
  if (!item.isDirectory()) return projectionFingerprint(path);
  return `directory:${item.ino}:${item.mode}:${JSON.stringify(
    children(input, path)
      .map((entry) => entry.name)
      .sort(),
  )}`;
}
function accessFingerprint(path: string): string {
  try {
    const item = lstatSync(path, { bigint: true });
    return item.isDirectory() ? `access:${item.ino}:${item.mode}` : projectionFingerprint(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "missing";
    throw error;
  }
}

/** Log views need the refs/commit objects actually read, not every historical source blob. */
export function retainHistoryInputs(
  input: ProjectionInputs,
  manifest: ProjectionManifest,
  paths?: readonly string[],
): ProjectionManifest {
  if (!paths) return manifest;
  const root = join(input.state, "history.git");
  const required = new Set(paths.filter((path) => inside(root, path)));
  const parents = new Set([root]);
  for (const path of required) {
    for (let parent = dirname(path); inside(root, parent); parent = dirname(parent)) {
      parents.add(parent);
      if (parent === root) break;
    }
  }
  const previous = new Map(manifest);
  return [
    ...manifest.filter(([path]) => !inside(root, path)),
    ...[...parents]
      .filter((path) => !required.has(path))
      .map((path): [string, string] => [path, accessFingerprint(path)]),
    ...[...required].map((path): [string, string] => [
      path,
      previous.get(path) ?? projectionFingerprint(path),
    ]),
  ];
}

/** Directory fingerprints detect additions/deletions; file fingerprints detect in-place edits. */
export function projectionManifest(input: ProjectionInputs): ProjectionManifest {
  const entries = new Map<string, string>();
  const walk = (path: string) => {
    entries.set(path, projectionFingerprint(path));
    if (entries.get(path) === "missing" || !lstatSync(path).isDirectory()) return;
    if (path === input.root || path === input.state) entries.set(path, directoryFingerprint(input, path));
    for (const entry of children(input, path)) walk(join(path, entry.name));
  };
  walk(resolve(input.root));
  walk(resolve(input.state));
  const config = join(input.root, ".kaitu/config.json");
  entries.set(config, projectionFingerprint(config));
  const preferences = join(localStateRoot(), "preferences.json");
  entries.set(preferences, projectionFingerprint(preferences));
  return [...entries];
}

export function projectionUnchanged(input: ProjectionInputs, manifest: ProjectionManifest): boolean {
  const preferences = join(localStateRoot(), "preferences.json");
  const root = `${input.root}${sep}`;
  const state = `${input.state}${sep}`;
  return manifest.every(
    ([path, before]) =>
      (path === input.root ||
        path === input.state ||
        path.startsWith(root) ||
        path.startsWith(state) ||
        path === preferences) &&
      resolve(path) === path &&
      (before.startsWith("directory:")
        ? directoryFingerprint(input, path)
        : before.startsWith("access:")
          ? accessFingerprint(path)
          : projectionFingerprint(path)) === before,
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
