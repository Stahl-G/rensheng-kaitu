import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { BrowserWindow, Menu, app, shell } from "electron";
import { desktopPaths } from "./kaitu-environment.mjs";

// 在原主进程导入和单实例锁之前设置，包括 Electron 的 relaunch 路径。
const { state } = desktopPaths();
process.env.DSH_HOME = state;
app.setName("Kaitu");
for (const name of ["userData", "sessionData", "logs", "crashDumps"]) {
  const directory = join(state, name === "sessionData" ? "userData" : name);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  app.setPath(name, directory);
}
if (process.env.KAITU_EMBEDDED_AI === "1") await import("./lib/main.js");
else {
  const { startDesktop } = await import("../kaitu/dist/local.mjs");
  void startDesktop({ app, BrowserWindow, Menu, shell }).catch((error) => {
    console.error(error);
    app.exit(1);
  });
}
