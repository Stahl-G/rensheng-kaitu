import { spawn } from "node:child_process";

/** A single owned Electron child, with IPC focus and bounded process-group shutdown. */
export function createAiProcess(executable, env) {
  let child;
  let starting;
  let stopping;
  let closed = false;
  let ready;
  const send = (type) => {
    if (child?.connected) child.send({ type }, () => {});
  };
  return {
    async open({ background = false, waitForUrl = false } = {}) {
      if (closed) throw new Error("开图正在退出");
      if (!child) {
        child = spawn(executable, [], {
          env: { ...env, KAITU_AI_BACKGROUND: background ? "1" : "0" },
          detached: process.platform !== "win32",
          stdio: ["ignore", "ignore", "ignore", "ipc"],
        });
        const launched = child;
        ready = new Promise((resolve, reject) => {
          launched.on("message", (message) => {
            if (message?.type !== "kaitu:web") return;
            const url = URL.parse(message.url);
            if (url?.protocol === "http:" && url.hostname === "127.0.0.1") resolve(url.href);
          });
          launched.once("exit", () => reject(new Error("插件页面服务已退出")));
          launched.once("error", reject);
        });
        void ready.catch(() => {});
        starting = new Promise((resolve, reject) => {
          launched.once("spawn", resolve);
          launched.once("error", reject);
        });
        launched.once("exit", () => {
          if (child === launched) child = undefined;
        });
        launched.once("error", () => {
          if (child === launched) child = undefined;
        });
      }
      await starting;
      if (!background) send("kaitu:focus");
      if (!waitForUrl) return { pid: child?.pid };
      let timeout;
      try {
        const url = await Promise.race([
          ready,
          new Promise((_, reject) => {
            timeout = setTimeout(() => reject(new Error("插件页面仍未就绪，请重试")), 20000);
          }),
        ]);
        return { pid: child?.pid, url };
      } finally {
        clearTimeout(timeout);
      }
    },
    close() {
      if (stopping) return stopping;
      closed = true;
      stopping = (async () => {
        if (!child) return;
        const owned = child;
        const exited = new Promise((resolve) => owned.once("exit", resolve));
        send("kaitu:quit");
        let timeout;
        await Promise.race([
          exited,
          new Promise((resolve) => {
            timeout = setTimeout(resolve, 5000);
          }),
        ]);
        clearTimeout(timeout);
        if (owned.exitCode === null && owned.signalCode === null) {
          try {
            if (process.platform === "win32") owned.kill("SIGKILL");
            else process.kill(-owned.pid, "SIGKILL");
          } catch (error) {
            if (error.code !== "ESRCH") throw error;
          }
          await exited;
        }
      })();
      return stopping;
    },
  };
}
