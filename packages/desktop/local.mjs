import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createAskService } from "../cli/dist/ui/ask.js";
import { startUi } from "../cli/dist/ui/server.js";
import {
  Workspace,
  configureAutomation,
  initWorkspace,
  readAutomation,
  upgradeWorkspace,
} from "../core/dist/index.js";
import { createAiProcess } from "./ai-process.mjs";
import { createCalendarExecutor } from "./calendar-executor.mjs";
import { desktopPaths } from "./environment.mjs";
import { createPayloadUpdater } from "./payload-update.mjs";
import { createPluginService } from "./plugins.mjs";
import { createSdkRuntime } from "./sdk-runtime.mjs";

export function createLocalAsk({ state, resources, executable, getWorkspace, conversationState = state }) {
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
  const ws = new Workspace(getWorkspace());
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
  const workspaceKey = ws.exists(keyFile) ? ws.readJson(keyFile).key : ws.root;
  if (!ws.exists(keyFile)) ws.writeJson(keyFile, { key: workspaceKey }, { internal: true });
  return createAskService({
    state: conversationState,
    workspace: ws.root,
    workspaceKey,
    runtime: (mode) => currentSdk().runtime(mode),
    settings: () => currentSdk().settings(),
    models: (input) => currentSdk().models(input),
    configure: (input) => currentSdk().configure(input),
    support: (method, input) => currentSdk().support(method, input),
    dispose: () => sdk.closeSupport(),
  });
}

export async function startDesktop({ app, BrowserWindow, Menu, shell, dialog }) {
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }
  const { state, workspace } = desktopPaths();
  const resources = dirname(dirname(fileURLToPath(import.meta.url)));
  const hostResources = process.env.KAITU_HOST_RESOURCES || dirname(resources);
  const launcher =
    process.platform === "win32" ? app.getPath("exe") : join(dirname(app.getPath("exe")), "Kaitu");
  let ws = new Workspace(workspace);
  if (!ws.exists(".kaitu/config.json"))
    ws = await initWorkspace(workspace, { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone });
  else await upgradeWorkspace(ws);
  await app.whenReady();
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
    version: `Powered by DeepSeek Harness ${process.env.DSH_CLIENT_VERSION}`,
  });
  const ask = createLocalAsk({
    state,
    resources,
    executable: app.getPath("exe"),
    getWorkspace: () => ws.root,
  });
  const startAutomation = async () => {
    const settings = readAutomation(ws);
    if (settings.asked && Object.values(settings.tasks).some(Boolean)) await ai.open({ background: true });
  };
  const plugins = createPluginService({
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
    plugins: async (action, input) =>
      action === "install"
        ? plugins.install(input)
        : action === "remove"
          ? plugins.remove(input)
          : action === "open"
            ? ai.open()
            : plugins.list(),
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
  const window = new BrowserWindow({
    title: "人生开图",
    width: 1180,
    height: 820,
    minWidth: 360,
    minHeight: 580,
    show: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
  });
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
  window.once("ready-to-show", () => window.show());
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
  const updateMenu = () =>
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        {
          label: "人生开图",
          submenu: [
            { role: "about", label: "关于人生开图" },
            {
              label: "设置",
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
            { role: "hide", label: "隐藏人生开图" },
            { role: "quit", label: "退出人生开图" },
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
  app.on("window-all-closed", () => app.quit());
  let closing = false;
  app.on("before-quit", (event) => {
    if (closing) return;
    event.preventDefault();
    closing = true;
    void Promise.allSettled([server.close(), ai.close()]).finally(() => app.quit());
  });
  await startAutomation().catch((error) => dialog.showErrorBox("自动任务", String(error)));
}
