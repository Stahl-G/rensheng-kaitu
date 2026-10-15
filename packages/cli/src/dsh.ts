import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { KaituError, type Workspace } from "@kaitu/core";

const DSH_VERSION = "0.2.0-rc.2";
const START = "# kaitu:start（由 kaitu dsh --install 维护）";
const END = "# kaitu:end";

function entry(ws: Workspace, flow = false): string {
  const plugin = fileURLToPath(new URL("../../dsh-plugin/dist/index.js", import.meta.url));
  if (
    !existsSync(plugin) ||
    !existsSync(fileURLToPath(new URL("../../dsh-plugin/dist/client.js", import.meta.url)))
  )
    throw new KaituError("插件尚未构建，请在仓库运行 pnpm build", "NOT_BUILT");
  const disabled = [
    "ui-brand-official",
    "ui-plugin-manager",
    "ui-cordis",
    "ui-settings-plugins",
    "ui-settings-plugin-inventory",
    "ui-settings-account",
    "account-controller",
    "deepseek-account",
    "llm-deepseek-account",
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
      { insert: [{ id: "kaitu", name: plugin, config: { workspace: ws.root } }] },
    ]
      .map((row) => JSON.stringify(row))
      .join(",\n");
  }
  return [
    ...disabled.flatMap((id) => [`- id: ${id}`, "  disabled: true"]),
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
  const start = text.indexOf(START);
  const end = text.indexOf(END);
  if (start >= 0 !== end >= 0 || (start >= 0 && end <= start))
    throw new KaituError("开图配置段标记不完整，请先修复 kaitu:start / kaitu:end", "INVALID_DSH_PATCH");
  // The default DSH profile is an empty flow sequence. Insert *inside* its
  // brackets so every original byte outside the managed block is preserved.
  const emptyFlow = /^\[[ \t]*\](?=[ \t]*(?:#.*)?$)/m.exec(text);
  const flow = start >= 0 ? text.slice(0, start).trimEnd().endsWith("[") : emptyFlow !== null;
  const block = `${START}\n${entry(ws, flow).trimEnd()}\n${END}`;
  let next: string;
  if (start >= 0) {
    next = text.slice(0, start) + block + text.slice(end + END.length);
  } else if (emptyFlow) {
    const at = emptyFlow.index + 1;
    next = `${text.slice(0, at)}\n${block}\n${text.slice(at)}`;
  } else {
    next = `${text}${text.endsWith("\n") ? "" : "\n"}${block}\n`;
  }
  writeFileSync(patch, next);
  return `已把开图插件写入 ${patch}。重启 DeepSeek Harness 桌面应用后，侧栏点「开图」查看总览，新建会话可记录（桌面应用需为 ${DSH_VERSION}）。`;
}

export function dshCommand(ws: Workspace): string {
  const file = ".kaitu/cache/dsh/cordis.yml";
  ws.writeText(file, entry(ws), { internal: true });
  const patch = ws.resolve(file, { internal: true }).replace(/'/g, "'\\''");
  return `npx @deepseek-ai/dsh@${DSH_VERSION} web --patch '${patch}'`;
}
