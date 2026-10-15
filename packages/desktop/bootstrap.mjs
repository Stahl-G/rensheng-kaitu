import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { app } from "electron";

// 在原主进程导入和单实例锁之前设置，包括 Electron 的 relaunch 路径。
const state = join(homedir(), ".kaitu-app");
process.env.DSH_HOME = state;
app.setName("Kaitu");
for (const name of ["userData", "sessionData", "logs", "crashDumps"]) {
  const directory = join(state, name === "sessionData" ? "userData" : name);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  app.setPath(name, directory);
}
await import("./lib/main.js");
