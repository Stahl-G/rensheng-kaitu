import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { startUi } from "../cli/dist/ui/server.js";
import { Workspace, initWorkspace, upgradeWorkspace } from "../core/dist/index.js";
import { desktopPaths } from "./environment.mjs";

export async function startDesktop({ app, BrowserWindow, Menu, shell }) {
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
  const server = await startUi(ws, {
    port: 0,
    open: false,
    webRoot: join(resources, "web"),
    openAi: async () => {
      const child = spawn(join(dirname(app.getPath("exe")), "Kaitu"), [], {
        env: {
          ...process.env,
          KAITU_EMBEDDED_AI: "1",
          KAITU_APP_HOME: join(state, "ai"),
          KAITU_DIR: ws.root,
          KAITU_APP_PORT: "0",
        },
        detached: true,
        stdio: "ignore",
      });
      await new Promise((resolve, reject) => {
        child.once("spawn", resolve);
        child.once("error", reject);
      });
      child.unref();
      return {};
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
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  });
  app.on("activate", () => {
    window.show();
    window.focus();
  });
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: "开图",
        submenu: [
          { role: "about", label: "关于开图" },
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
  await window.loadURL(server.url);
  app.on("window-all-closed", () => app.quit());
  let closing = false;
  app.on("before-quit", (event) => {
    if (closing) return;
    event.preventDefault();
    closing = true;
    void server.close().finally(() => app.quit());
  });
}
