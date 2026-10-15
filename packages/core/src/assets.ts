import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

let cached: string | undefined;

/** 仓库根目录（含 schemas/ 与 templates/）。从本文件向上查找，源码与 dist 都适用。 */
export function assetsRoot(): string {
  if (cached) return cached;
  let dir = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    if (
      existsSync(join(dir, "schemas", "module.schema.json")) &&
      existsSync(join(dir, "templates", "kaitu"))
    ) {
      cached = dir;
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) throw new Error("找不到 schemas/ 与 templates/ 目录");
    dir = parent;
  }
}

export const schemasDir = () => join(assetsRoot(), "schemas");
export const templateDir = () => join(assetsRoot(), "templates", "kaitu");
