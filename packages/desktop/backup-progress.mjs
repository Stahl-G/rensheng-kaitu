import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareDshState } from "./kaitu-state-backup.mjs";

// A separate fixed-host process keeps drawing while the preflight performs synchronous durable I/O.
export async function prepareWithProgress(state, version, { launch = spawn, timeoutMs = 20000 } = {}) {
  if (!/^0\.2\.(?:[2-9]|\d{2,})(?:-|$)/.test(version)) return prepareDshState(state, version);
  const profile = mkdtempSync(join(tmpdir(), "kaitu-upgrade-progress-"));
  const env = { ...process.env, KAITU_BACKUP_PROGRESS: "1", KAITU_PROGRESS_PROFILE: profile };
  env.ELECTRON_RUN_AS_NODE = undefined;
  const child = launch(process.execPath, [], { env, stdio: ["ignore", "ignore", "ignore", "ipc"] });
  let stopped = false;
  const exited = new Promise((resolve) => {
    const finish = () => {
      stopped = true;
      resolve();
    };
    child.once("exit", finish);
    child.once("error", finish);
  });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("备份进度窗口未就绪，请重试")), timeoutMs);
      const fail = () => {
        clearTimeout(timer);
        reject(new Error("备份进度窗口已关闭，请重试"));
      };
      child.once("error", fail);
      child.once("exit", fail);
      child.once("message", (message) => {
        clearTimeout(timer);
        if (message?.ready === true) resolve();
        else reject(new Error("备份进度窗口未就绪，请重试"));
      });
    });
    return prepareDshState(state, version, {
      progressPid: child.pid,
      progress: (message) => {
        process.kill(child.pid, 0);
        if (!child.connected) throw new Error("备份进度窗口已关闭，请重试");
        child.send(message, () => {});
      },
    });
  } finally {
    if (child.connected) child.send({ done: true }, () => {});
    const timer = setTimeout(() => {
      if (!stopped) child.kill();
    }, 3000);
    await exited;
    clearTimeout(timer);
    rmSync(profile, { recursive: true, force: true });
  }
}

export async function showBackupProgress({ app, BrowserWindow }) {
  // This process never imports DSH, reads credentials or opens the normal profile.
  const profile = process.env.KAITU_PROGRESS_PROFILE;
  if (!profile || !process.send) {
    app.exit(1);
    return;
  }
  for (const name of ["userData", "sessionData", "logs", "crashDumps"]) app.setPath(name, profile);
  await app.whenReady();
  const window = new BrowserWindow({
    width: 440,
    height: 180,
    resizable: false,
    closable: false,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      partition: "kaitu-backup-progress",
    },
  });
  window.setMenu(null);
  await window.loadURL(
    `data:text/html;charset=utf-8,${encodeURIComponent(
      '<!doctype html><html lang="zh"><meta charset="utf-8"><title>开图升级备份</title><style>body{font:18px system-ui;padding:24px;background:Canvas;color:CanvasText}progress{width:100%}</style><p id="status" role="status">正在检查升级备份</p><progress></progress></html>',
    )}`,
  );
  const labels = {
    check: "正在检查升级备份",
    scan: "正在读取状态",
    copy: "正在备份",
    verify: "正在校验备份",
    publish: "正在保存备份",
  };
  process.on("message", (message) => {
    if (message?.done) {
      app.exit(0);
      return;
    }
    if (!labels[message?.phase]) return;
    const text =
      labels[message.phase] +
      (Number.isInteger(message.completed) ? ` ${message.completed} / ${message.total}` : "");
    void window.webContents
      .executeJavaScript(`document.getElementById('status').textContent=${JSON.stringify(text)}`)
      .catch(() => {});
  });
  process.once("disconnect", () => app.exit(1));
  process.send({ ready: true });
}
