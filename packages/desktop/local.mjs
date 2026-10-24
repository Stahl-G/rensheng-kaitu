import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createAgentConnection } from "../cli/dist/local-agents/connection.js";
import { createAskService } from "../cli/dist/ui/ask.js";
import { startUi } from "../cli/dist/ui/server.js";
import {
  Workspace,
  configureAutomation,
  initWorkspace,
  readAutomation,
  rememberWorkspace,
  schemas,
  splitImportedBlobs,
  upgradeWorkspace,
} from "../core/dist/index.js";
import { reconnectWorkspaceState } from "../core/dist/state-binding.js";
import { readWorkspaceConfig } from "../core/dist/sync-files.js";
import { createAiProcess } from "./ai-process.mjs";
import { productCopyright } from "./brand.mjs";
import { createCalendarExecutor } from "./calendar-executor.mjs";
import { assertDesktopIsolation, desktopPaths } from "./environment.mjs";
import { createPayloadUpdater } from "./payload-update.mjs";
import { createPluginService } from "./plugins.mjs";
import { createSdkRuntime } from "./sdk-runtime.mjs";

export function createLocalAsk({
  state,
  resources,
  executable,
  getWorkspace,
  workspace: ws,
  conversationState = state,
}) {
  const aiHome = existsSync(join(state, "ai", "profiles", "desktop")) ? join(state, "ai") : state;
  const makeSdk = () =>
    createSdkRuntime({
      executable: process.platform === "win32" ? executable : join(dirname(executable), "DSH"),
      archive: join(process.env.KAITU_HOST_RESOURCES || dirname(resources), "app.asar"),
      home: aiHome,
      workspace: getWorkspace(),
      plugin: join(resources, "dist/sdk-plugin.mjs"),
      hostPlugin: join(resources, "dist/sdk-host.mjs"),
      helper: join(resources, "dist/sdk-credentials.mjs"),
    });
  let sdkRoot = ws.root;
  let sdk = makeSdk();
  const currentSdk = () => {
    if (sdkRoot !== getWorkspace()) {
      void sdk.closeSupport();
      sdkRoot = getWorkspace();
      sdk = makeSdk();
    }
    return sdk;
  };
  const keyFile = ".kaitu/ask-workspace.json";
  const workspaceKeyFor = (root) => {
    const target = root === ws.root ? ws : new Workspace(root, { maintain: false });
    if (!target.exists(".kaitu/config.json")) throw new Error("不是开图工作区");
    const key = target.exists(keyFile) ? target.readJson(keyFile).key : root;
    if (!target.exists(keyFile)) target.writeJson(keyFile, { key }, { internal: true });
    return key;
  };
  const connection = createAgentConnection({
    state,
    workspace: getWorkspace,
    sdk: currentSdk,
    mcp: {
      command: executable,
      get args() {
        return [join(resources, "dist/mcp-stdio.mjs"), getWorkspace()];
      },
      env: { ELECTRON_RUN_AS_NODE: "1" },
    },
  });
  return createAskService({
    state: conversationState,
    workspace: ws.root,
    workspaceKey: workspaceKeyFor(ws.root),
    workspaceKeyFor,
    runtime: (mode, reader, textOnly) => connection.runtime(mode, reader, textOnly),
    settings: (resolveImages) => connection.settings(resolveImages),
    // 本机 Agent 的模型列表走 ACP；内置服务商仍由 connection 转给 SDK。
    models: (input) => connection.models(input),
    configure: (input) => connection.configure(input),
    support: (method, input) => connection.support(method, input),
    dispose: () => sdk.closeSupport(),
  });
}

const LOADING = `<!doctype html><meta charset="utf-8"><title>人生开图</title>
<style>
:root { color-scheme: light dark; }
body { margin: 0; height: 100vh; display: grid; place-items: center; font: 15px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; color: #6b6965; background: #fbfaf8; }
@media (prefers-color-scheme: dark) { body { color: #a19e99; background: #1f1e1d; } }
</style>
<p>正在打开资料…</p>`;

export async function openDesktopWorkspace({
  state,
  workspace,
  createWorkspace,
  workspaceError,
  window,
  dialog,
}) {
  let root = workspace;
  let canCreate = createWorkspace;
  let failure = workspaceError;
  let selected = false;
  while (!window.isDestroyed()) {
    let relocation;
    try {
      if (failure) throw failure;
      assertDesktopIsolation(root, state);
      if (selected) {
        if (!schemas().builtin("config.schema.json")(readWorkspaceConfig(root)))
          throw new Error("请选择包含有效开图资料配置的文件夹");
        relocation = reconnectWorkspaceState(workspace, root);
      }
      // 先校验已有配置，再执行原有升级；误选普通文件夹不写资料。
      let ws = new Workspace(root, { maintain: false, deferOverview: true });
      if (!ws.exists(".kaitu/config.json")) {
        if (!canCreate)
          throw Object.assign(new Error("找不到这个位置的开图资料配置"), { code: "WORKSPACE_MISSING" });
        ws = await initWorkspace(root, { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone });
      } else {
        if (!schemas().builtin("config.schema.json")(ws.readJson(".kaitu/config.json")))
          throw new Error("这个文件夹的开图资料配置无效");
        ws = new Workspace(root, { deferOverview: true });
        // 其他资料还没下载时仍可进入现有只读/等待流程。
        await upgradeWorkspace(ws)
          .then(() => splitImportedBlobs(ws))
          .catch((error) => {
            if (error?.code !== "CLOUD_UNAVAILABLE") throw error;
          });
      }
      relocation?.commit();
      rememberWorkspace(ws.root);
      return ws;
    } catch (error) {
      relocation?.rollback();
      failure = error;
    }
    if (window.isDestroyed()) return null;
    const detail =
      failure?.code === "CLOUD_UNAVAILABLE"
        ? "云盘中的资料配置尚未下载。请让云盘完成下载后重试，或选择已下载的资料文件夹。"
        : "原位置可能已改名、移动，或所在云盘暂未连接。若刚改名或移动，请重新选择；若云盘离线，请连接后重试。文件夹可以使用任意名字。";
    const { response } = await dialog.showMessageBox(window, {
      type: "warning",
      title: "重新打开开图资料",
      message: "暂时无法打开资料文件夹",
      detail: `${detail}\n\n当前位置：${root}\n${failure?.code === "NOT_EMPTY" ? "这个位置已有其他文件，未新建工作区，也不需要清空。" : String(failure?.message ?? failure)}`,
      buttons: ["重新选择资料文件夹", "重试", "退出"],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
    });
    if (response === 2 || window.isDestroyed()) return null;
    if (response === 1) {
      failure = undefined;
      continue;
    }
    const { canceled, filePaths } = await dialog.showOpenDialog(window, {
      title: "选择已有的开图资料文件夹",
      properties: ["openDirectory"],
    });
    if (!canceled && filePaths[0]) {
      root = filePaths[0];
      canCreate = false;
      selected = true;
      failure = undefined;
    }
    // 取消选择后继续显示恢复入口，不退出，也不初始化替代工作区。
  }
  return null;
}

export async function startDesktop({ app, BrowserWindow, Menu, shell, dialog }) {
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }
  const paths = desktopPaths();
  const { state } = paths;
  const resources = dirname(dirname(fileURLToPath(import.meta.url)));
  const hostResources = process.env.KAITU_HOST_RESOURCES || dirname(resources);
  const launcher =
    process.platform === "win32" ? app.getPath("exe") : join(dirname(app.getPath("exe")), "Kaitu");
  // 每一步的时间记下来：启动慢时看是哪一步。
  const log = join(state, "logs", "startup.log");
  writeFileSync(log, "");
  const step = (name) => appendFileSync(log, `${new Date().toISOString()} ${name}\n`);
  await app.whenReady();
  // 先开窗口再打开资料：资料在云盘里时读写可能要等云盘，窗口不能等它。
  const window = new BrowserWindow({
    title: "人生开图",
    width: 1180,
    height: 820,
    minWidth: 360,
    minHeight: 580,
    show: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
  });
  app.on("second-instance", () => {
    if (window.isDestroyed()) return;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  });
  app.on("activate", () => {
    if (window.isDestroyed()) return;
    window.show();
    window.focus();
  });
  app.on("window-all-closed", () => app.quit());
  const painted = new Promise((resolve) => window.once("ready-to-show", resolve));
  await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(LOADING)}`);
  await painted;
  window.show();
  // 让 macOS 先把窗口放上屏幕，再开始可能卡住的读写。
  await new Promise((resolve) => setTimeout(resolve, 0));
  step("window");
  const ws = await openDesktopWorkspace({ ...paths, window, dialog });
  if (!ws) {
    app.quit();
    return;
  }
  step("workspace");
  // Retain the AI home already used by this installation, including its login and sessions.
  const aiHome = existsSync(join(state, "ai", "profiles", "desktop")) ? join(state, "ai") : state;
  const makeBackgroundAi = () =>
    createAiProcess(launcher, {
      ...process.env,
      KAITU_EMBEDDED_AI: "1",
      KAITU_PARENT_PAYLOAD: resources,
      KAITU_APP_HOME: aiHome,
      KAITU_DIR: ws.root,
      KAITU_APP_PORT: "0",
    });
  let ai = makeBackgroundAi();
  process.env.DSH_CLIENT_VERSION = JSON.parse(
    readFileSync(join(hostResources, "app.asar/package.json"), "utf8"),
  ).version;
  const updater = createPayloadUpdater({
    state,
    resources: hostResources,
    payload: resources,
    restart: () =>
      setTimeout(() => {
        app.relaunch({ execPath: launcher });
        app.quit();
      }, 200),
  });
  const featureVersion = (await updater.request()).version;
  app.setAboutPanelOptions({
    applicationName: "人生开图",
    applicationVersion: featureVersion,
    copyright: productCopyright,
    version: `Powered by DeepSeek Harness ${process.env.DSH_CLIENT_VERSION}`,
  });
  const ask = createLocalAsk({
    state,
    resources,
    executable: app.getPath("exe"),
    getWorkspace: () => ws.root,
    workspace: ws,
  });
  const startAutomation = async () => {
    const settings = readAutomation(ws);
    if (settings.asked && Object.values(settings.tasks).some(Boolean)) await ai.open({ background: true });
  };
  const plugins = createPluginService({
    fetchIndex: (url, options) => window.webContents.session.fetch(url, options),
    archive: join(hostResources, "app.asar"),
    runtime: join(hostResources, "runtime/primary-runtime/dependencies"),
    home: aiHome,
    // desktop profile 只能在 DSH 进程不用它时改：先停后台 AI 和问问的引擎，装好再重新加载。
    beforeChange: async () => {
      await ai.close();
      await ask.prepareRelocation();
    },
    onChanged: async () => {
      ai = makeBackgroundAi();
      ask.relocate(ws.root);
      await startAutomation();
    },
  });
  const server = await startUi(ws, {
    port: 0,
    open: false,
    webRoot: join(resources, "web"),
    ask,
    systemLocale: app.getPreferredSystemLanguages()[0] || "en",
    desktopUpdate: (action) => updater.request(action),
    plugins: async (action, input) => {
      if (action === "explore") return plugins.explore();
      if (action === "page")
        return plugins.page(input, server.url, () => ai.open({ background: true, waitForUrl: true }));
      return action === "install"
        ? plugins.install(input)
        : action === "remove"
          ? plugins.remove(input)
          : action === "open"
            ? ai.open()
            : plugins.list(input === "refresh");
    },
    pickDirectory: async () => {
      const { canceled, filePaths } = await dialog.showOpenDialog(window, {
        title: "选择开图资料的存放文件夹",
        properties: ["openDirectory", "createDirectory"],
      });
      return canceled ? null : (filePaths[0] ?? null);
    },
    calendarExecutor: process.platform === "darwin" ? createCalendarExecutor() : undefined,
    onWorkspaceChanging: () => ai.close(),
    onWorkspaceChanged: async () => {
      ai = makeBackgroundAi();
      await startAutomation();
    },
    onAutomationChanged: async () => {
      updateMenu();
      await startAutomation();
    },
    openAi: async () => {
      throw new Error("请在问问页面连接内置 AI");
    },
  });
  step("server");
  // 打开资料时用户关了窗口：应用已经在退出，不再接着装窗口。
  if (window.isDestroyed()) return;
  window.webContents.session.setPermissionRequestHandler((_webContents, permission, callback) =>
    callback(permission === "clipboard-sanitized-write"),
  );
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (new URL(url).origin !== server.url) event.preventDefault();
  });
  const updateMenu = () =>
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        {
          label: "开图",
          submenu: [
            { role: "about", label: "关于开图" },
            {
              label: "设置…",
              accelerator: "CmdOrCtrl+,",
              click: () =>
                void window.webContents.executeJavaScript(
                  'window.dispatchEvent(new Event("kaitu:settings"))',
                ),
            },
            {
              label: "自动任务",
              submenu: [
                ["morning", "早间计划"],
                ["organizer", "每日整理"],
                ["news", "资讯搜索"],
              ].map(([key, label]) => ({
                label,
                type: "checkbox",
                checked: readAutomation(ws).tasks[key],
                click: async (item) => {
                  configureAutomation(ws, { [key]: item.checked });
                  updateMenu();
                  await startAutomation().catch((error) => dialog.showErrorBox("自动任务", String(error)));
                },
              })),
            },
            { type: "separator" },
            { role: "hide", label: "隐藏开图" },
            { role: "quit", label: "退出开图" },
          ],
        },
        { role: "editMenu", label: "编辑" },
        {
          label: "视图",
          submenu: [
            { role: "reload", label: "刷新" },
            { role: "togglefullscreen", label: "全屏" },
          ],
        },
        { role: "windowMenu", label: "窗口" },
      ]),
    );
  updateMenu();
  await window.loadURL(server.url);
  step("loaded");
  // Network checks never gate the first screen; downloading and restarting stay explicit.
  const firstUpdateCheck = setTimeout(() => void updater.checkAutomatically(), 15000);
  const updateChecks = setInterval(() => void updater.checkAutomatically(), 24 * 60 * 60 * 1000);
  let closing = false;
  app.on("before-quit", (event) => {
    if (closing) return;
    event.preventDefault();
    closing = true;
    clearTimeout(firstUpdateCheck);
    clearInterval(updateChecks);
    void Promise.allSettled([server.close(), ai.close()]).finally(() => app.quit());
  });
  await startAutomation().catch((error) => dialog.showErrorBox("自动任务", String(error)));
}
