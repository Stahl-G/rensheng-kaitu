import { mkdirSync, readdirSync, realpathSync, statSync, symlinkSync } from "node:fs";
import { resolve } from "node:path";

// Link each dependency to its real directory: Windows resolves pnpm's relative workspace links
// against the link path, so a single junction to node_modules would point them outside the repo.
export function linkNodeModules(from, to) {
  mkdirSync(to, { recursive: true });
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    const source = resolve(from, entry.name);
    if (entry.name.startsWith("@")) linkNodeModules(source, resolve(to, entry.name));
    else if (statSync(source).isDirectory())
      symlinkSync(realpathSync(source), resolve(to, entry.name), "junction");
  }
}
