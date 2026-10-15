import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { KaituError, type Workspace } from "@kaitu/core";

export function dshCommand(ws: Workspace): string {
  const plugin = fileURLToPath(new URL("../../dsh-plugin/dist/index.js", import.meta.url));
  if (!existsSync(plugin)) throw new KaituError("插件尚未构建，请在仓库运行 pnpm build", "NOT_BUILT");
  const file = ".kaitu/cache/dsh/cordis.yml";
  ws.writeText(
    file,
    [
      "- insert:",
      "    - id: kaitu",
      `      name: ${JSON.stringify(plugin)}`,
      "      config:",
      `        workspace: ${JSON.stringify(ws.root)}`,
      "",
    ].join("\n"),
    { internal: true },
  );
  const patch = ws.resolve(file, { internal: true }).replace(/'/g, "'\\''");
  return `npx @deepseek-ai/dsh@0.2.0-rc.2 web --patch '${patch}'`;
}
