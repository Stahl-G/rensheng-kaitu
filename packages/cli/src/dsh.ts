import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { KaituError, type Workspace } from "@kaitu/core";

const DSH_VERSION = "0.2.0-rc.2";
const START = "# kaitu:start（由 kaitu dsh --install 维护）";
const END = "# kaitu:end";

function schedulePackages(profile: string, outside = "") {
  const manifest = join(profile, "package.json");
  const bundles: string[] = existsSync(manifest)
    ? (JSON.parse(readFileSync(manifest, "utf8")).dsh?.profile?.bundles ?? [])
    : [];
  const bundled = bundles.includes("@deepseek-ai/dsh-experimental-schedule-bundle");
  return [
    ...(!bundled && !outside.includes("@deepseek-ai/dsh-schedule")
      ? [{ id: "kaitu-schedule", name: "@deepseek-ai/dsh-schedule" }]
      : []),
    ...(!bundled && !outside.includes("@deepseek-ai/dsh-client-ui-schedule")
      ? [{ id: "kaitu-ui-schedule", name: "@deepseek-ai/dsh-client-ui-schedule" }]
      : []),
  ];
}

const defaultPlugin = () => fileURLToPath(new URL("../../dsh-plugin/dist/index.js", import.meta.url));

function entry(
  workspace: string,
  plugin: string,
  flow: boolean,
  schedules: { id: string; name: string }[],
  standalone = false,
): string {
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
        insert: [...schedules, { id: "kaitu", name: plugin, config: { workspace } }],
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
    ...schedules.flatMap(({ id, name }) => [`    - id: ${id}`, `      name: ${JSON.stringify(name)}`]),
    "    - id: kaitu",
    `      name: ${JSON.stringify(plugin)}`,
    "      config:",
    `        workspace: ${JSON.stringify(workspace)}`,
    "",
  ].join("\n");
}

// CLI 与独立桌面应用共用受管段，包括定时任务包的去重逻辑。
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
  const outside = start >= 0 ? text.slice(0, start) + text.slice(end + END.length) : text;
  const schedules = schedulePackages(join(options.home, "profiles", "desktop"), outside);
  const block = `${START}\n${entry(options.workspace, options.plugin ?? defaultPlugin(), flow, schedules, options.standalone).trimEnd()}\n${END}`;
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
  const profile = join(process.env.DSH_HOME ?? join(homedir(), ".dsh"), "profiles", "web");
  const profilePatch = join(profile, "cordis.patch.yml");
  const outside = existsSync(profilePatch) ? readFileSync(profilePatch, "utf8") : "";
  ws.writeText(file, entry(ws.root, defaultPlugin(), false, schedulePackages(profile, outside)), {
    internal: true,
  });
  const patch = ws.resolve(file, { internal: true }).replace(/'/g, "'\\''");
  return `npx @deepseek-ai/dsh@${DSH_VERSION} web --patch '${patch}'`;
}
