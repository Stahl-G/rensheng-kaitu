import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { BrowserWindow, Menu, app, dialog, shell } from "electron";
import { desktopPaths } from "./kaitu-environment.mjs";

// 在原主进程导入和单实例锁之前设置，包括 Electron 的 relaunch 路径。
const { state } = desktopPaths();
const embedded = process.env.KAITU_EMBEDDED_AI === "1";
process.env.DSH_HOME = state;
app.setName("人生开图");
for (const name of ["userData", "sessionData", "logs", "crashDumps"]) {
  const directory = join(
    state,
    !embedded && ["userData", "sessionData"].includes(name)
      ? "workbench-userData"
      : name === "sessionData"
        ? "userData"
        : name,
  );
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  app.setPath(name, directory);
}
if (embedded) {
  let visible = process.env.KAITU_AI_BACKGROUND !== "1";
  void app.whenReady().then(() => app.dock?.hide());
  app.on("browser-window-created", (_event, window) => {
    window.on("show", () => {
      if (!visible) window.hide();
    });
  });
  process.on("message", (message) => {
    if (message?.type === "kaitu:focus") {
      visible = true;
      const windows = BrowserWindow.getAllWindows().filter((window) => !window.isDestroyed());
      const window = windows.find((window) => window.isVisible()) ?? windows.at(-1);
      if (window) {
        if (window.isMinimized()) window.restore();
        window.show();
        window.focus();
      }
    }
    if (message?.type === "kaitu:quit") app.emit("kaitu:quit");
  });
  process.once("disconnect", () => app.emit("kaitu:quit"));
  await import("./lib/main.js");
} else {
  const { startDesktop } = await import("../kaitu/dist/local.mjs");
  void startDesktop({ app, BrowserWindow, Menu, shell, dialog }).catch((error) => {
    console.error(error);
    app.exit(1);
  });
}
