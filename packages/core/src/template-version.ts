import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { schemasDir, templateDir } from "./assets.js";
import { ONBOARDING } from "./onboarding.js";
import type { Workspace } from "./workspace.js";

let current: string | undefined;

export function templateVersion(): string {
  if (current) return current;
  // 生成器行为变化但模板文件未变时，递增此版本。
  const hash = createHash("sha256").update("kaitu-template-2");
  function walk(root: string, path = "") {
    for (const entry of readdirSync(join(root, path), { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const file = path ? `${path}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(root, file);
      else
        hash
          .update(file)
          .update("\0")
          .update(readFileSync(join(root, file)))
          .update("\0");
    }
  }
  hash.update(JSON.stringify(ONBOARDING));
  walk(templateDir());
  walk(schemasDir());
  current = hash.digest("hex").slice(0, 12);
  return current;
}

export function templateOutdated(ws: Workspace): boolean {
  return (
    ws.readJson<{ template_version?: string }>(".kaitu/config.json").template_version !== templateVersion()
  );
}
