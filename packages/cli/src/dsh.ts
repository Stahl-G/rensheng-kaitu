import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { KaituError, type Workspace } from "@kaitu/core";

const DSH_VERSION = "0.2.0-rc.2";
const START = "# kaitu:start（由 kaitu dsh --install 维护）";
const END = "# kaitu:end";

function entry(ws: Workspace): string {
  const plugin = fileURLToPath(new URL("../../dsh-plugin/dist/index.js", import.meta.url));
  if (
    !existsSync(plugin) ||
    !existsSync(fileURLToPath(new URL("../../dsh-plugin/dist/client.js", import.meta.url)))
  )
    throw new KaituError("插件尚未构建，请在仓库运行 pnpm build", "NOT_BUILT");
  return [
    "- insert:",
    "    - id: kaitu",
    `      name: ${JSON.stringify(plugin)}`,
    "      config:",
    `        workspace: ${JSON.stringify(ws.root)}`,
    "",
  ].join("\n");
}

// 写进 DeepSeek Harness 桌面应用的 profile；重复运行只替换开图这一段。
export function installDsh(ws: Workspace): string {
  const home = process.env.DSH_HOME ?? join(homedir(), ".dsh");
  const patch = join(home, "profiles", "desktop", "cordis.patch.yml");
  if (!existsSync(patch))
    throw new KaituError(`没找到 ${patch}，请先安装并打开一次 DeepSeek Harness 桌面应用`, "NO_DSH");
  const text = readFileSync(patch, "utf8");
  const block = `${START}\n${entry(ws)}${END}\n`;
  const start = text.indexOf(START);
  const end = text.indexOf(END, start);
  const next =
    start >= 0 && end > start
      ? text.slice(0, start) + block + text.slice(end + END.length).replace(/^\n/, "")
      : `${text.replace(/\n?$/, "\n")}${block}`;
  writeFileSync(patch, next);
  return `已把开图插件写入 ${patch}。重启 DeepSeek Harness 桌面应用后，侧栏点「开图」查看总览，新建会话可记录（桌面应用需为 ${DSH_VERSION}）。`;
}

export function dshCommand(ws: Workspace): string {
  const file = ".kaitu/cache/dsh/cordis.yml";
  ws.writeText(file, entry(ws), { internal: true });
  const patch = ws.resolve(file, { internal: true }).replace(/'/g, "'\\''");
  return `npx @deepseek-ai/dsh@${DSH_VERSION} web --patch '${patch}'`;
}
