import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { KaituError, type Workspace } from "@kaitu/core";

const DSH_VERSION = "0.2.1-rc.1";
const START = "# kaitu:start（由 kaitu dsh --install 维护）";
const END = "# kaitu:end";

const defaultPlugin = () => fileURLToPath(new URL("../../dsh-plugin/dist/index.js", import.meta.url));

function entry(workspace: string, plugin: string, flow: boolean, standalone = false): string {
  if (!existsSync(plugin) || !existsSync(join(dirname(plugin), "client.js")))
    throw new KaituError("插件尚未构建，请在仓库运行 pnpm build", "NOT_BUILT");
  const disabled = [
    "ui-brand-official",
    "ui-settings-account",
    "desktop-product-telemetry",
    "product-analytics",
    "session-telemetry-otel",
    "ui-settings-session-log",
    "ui-open-in-app",
    "ui-subagent",
    "ui-agent-preset",
    "ui-sidebar-terminal",
    "ui-sidebar-browser",
    "ui-sidebar-files",
  ];
  if (flow) {
    return [
      ...disabled.map((id) => ({ id, disabled: true })),
      { id: "tool-skill", disabled: false },
      { id: "ui-settings-models", config: { credentialOnboarding: !standalone } },
      {
        insert: [{ id: "kaitu", name: plugin, config: { workspace } }],
      },
    ]
      .map((row) => JSON.stringify(row))
      .join(",\n");
  }
  return [
    ...disabled.flatMap((id) => [`- id: ${id}`, "  disabled: true"]),
    "- id: tool-skill",
    "  disabled: false",
    "- id: ui-settings-models",
    "  config:",
    `    credentialOnboarding: ${!standalone}`,
    "- insert:",
    "    - id: kaitu",
    `      name: ${JSON.stringify(plugin)}`,
    "      config:",
    `        workspace: ${JSON.stringify(workspace)}`,
    "",
  ].join("\n");
}

// CLI 与独立桌面应用共用受管段；定时任务由固定版本的 DSH 宿主提供。
export function renderDshPatch(
  text: string,
  options: { home: string; workspace: string; plugin?: string; standalone?: boolean },
): string {
  const start = text.indexOf(START);
  const end = text.indexOf(END);
  if (start >= 0 !== end >= 0 || (start >= 0 && end <= start))
    throw new KaituError("开图配置段标记不完整，请先修复 kaitu:start / kaitu:end", "INVALID_DSH_PATCH");
  // The default DSH profile is an empty flow sequence. Insert *inside* its
  // brackets so every original byte outside the managed block is preserved.
  const emptyFlow = /^\[[ \t]*\](?=[ \t]*(?:#.*)?$)/m.exec(text);
  // 受管段前面也可能有别的条目（如 Kaitu.app 的 webserver 行，以逗号结尾），仍属 flow 序列。
  const flow = start >= 0 ? /[[,]$/.test(text.slice(0, start).trimEnd()) : emptyFlow !== null;
  const block = `${START}\n${entry(options.workspace, options.plugin ?? defaultPlugin(), flow, options.standalone).trimEnd()}\n${END}`;
  let next: string;
  if (start >= 0) {
    next = text.slice(0, start) + block + text.slice(end + END.length);
  } else if (emptyFlow) {
    const at = emptyFlow.index + 1;
    next = `${text.slice(0, at)}\n${block}\n${text.slice(at)}`;
  } else {
    next = `${text}${text.endsWith("\n") ? "" : "\n"}${block}\n`;
  }
  return next;
}

// 写进 DeepSeek Harness 桌面应用的 profile；重复运行只替换开图这一段。
export function installDsh(ws: Workspace): string {
  const home = process.env.DSH_HOME ?? join(homedir(), ".dsh");
  const patch = join(home, "profiles", "desktop", "cordis.patch.yml");
  if (!existsSync(patch))
    throw new KaituError(`没找到 ${patch}，请先安装并打开一次 DeepSeek Harness 桌面应用`, "NO_DSH");
  writeFileSync(patch, renderDshPatch(readFileSync(patch, "utf8"), { home, workspace: ws.root }));
  return `已把开图插件写入 ${patch}。重启 DeepSeek Harness 桌面应用后，侧栏点「开图」查看总览，新建会话可记录（桌面应用需为 ${DSH_VERSION}）。`;
}

export function dshCommand(ws: Workspace): string {
  const file = ".kaitu/cache/dsh/cordis.yml";
  ws.writeText(file, entry(ws.root, defaultPlugin(), false), {
    internal: true,
  });
  const patch = ws.resolve(file, { internal: true }).replace(/'/g, "'\\''");
  return `npx @deepseek-ai/dsh@${DSH_VERSION} web --patch '${patch}'`;
}
