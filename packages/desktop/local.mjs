import { existsSync } from "node:fs";
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
import { createSdkRuntime } from "./sdk-runtime.mjs";

export async function startDesktop({ app, BrowserWindow, Menu, shell, dialog }) {
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }
  const { state, workspace } = desktopPaths();
  const resources = dirname(dirname(fileURLToPath(import.meta.url)));
  let ws = new Workspace(workspace);
  if (!ws.exists(".kaitu/config.json"))
    ws = await initWorkspace(workspace, { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone });
  else await upgradeWorkspace(ws);
  await app.whenReady();
  // Retain the AI home already used by this installation, including its login and sessions.
  const aiHome = existsSync(join(state, "ai", "profiles", "desktop")) ? join(state, "ai") : state;
  const makeBackgroundAi = () =>
    createAiProcess(join(dirname(app.getPath("exe")), "Kaitu"), {
      ...process.env,
      KAITU_EMBEDDED_AI: "1",
      KAITU_APP_HOME: aiHome,
      KAITU_DIR: ws.root,
      KAITU_APP_PORT: "0",
    });
  let ai = makeBackgroundAi();
  process.env.KAITU_APP_VERSION = app.getVersion();
  const makeSdk = () =>
    createSdkRuntime({
      executable: join(dirname(app.getPath("exe")), "DSH"),
      archive: join(dirname(resources), "app.asar"),
      home: aiHome,
      workspace: ws.root,
      plugin: join(resources, "dist/sdk-plugin.mjs"),
      hostPlugin: join(resources, "dist/sdk-host.mjs"),
      helper: join(resources, "dist/sdk-credentials.mjs"),
    });
  const askKeyFile = ".kaitu/ask-workspace.json";
  const workspaceKey = ws.exists(askKeyFile) ? ws.readJson(askKeyFile).key : ws.root;
  if (!ws.exists(askKeyFile)) ws.writeJson(askKeyFile, { key: workspaceKey }, { internal: true });
  const ask = createAskService({
    state,
    workspace: ws.root,
    workspaceKey,
    runtime: (mode) => makeSdk().runtime(mode),
    settings: () => makeSdk().settings(),
    configure: (input) => makeSdk().configure(input),
  });
  const startAutomation = async () => {
    const settings = readAutomation(ws);
    if (settings.asked && Object.values(settings.tasks).some(Boolean)) await ai.open({ background: true });
  };
  const server = await startUi(ws, {
    port: 0,
    open: false,
    webRoot: join(resources, "web"),
    ask,
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
    title: "开图",
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
          label: "开图",
          submenu: [
            { role: "about", label: "关于开图" },
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
