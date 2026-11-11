import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

/** A single owned Electron child, with IPC focus and bounded process-group shutdown. */
export function createAiProcess(executable, env) {
  let child;
  let starting;
  let stopping;
  let closed = false;
  let ready;
  let latestUrl;
  let automation;
  let automationReady;
  const send = (type) => {
    if (child?.connected) child.send({ type }, () => {});
  };
  return {
    async open({ background = false, waitForUrl = false, waitForAutomation = false } = {}) {
      if (closed) throw new Error("开图正在退出");
      if (!child) {
        child = spawn(executable, [], {
          env: { ...env, KAITU_AI_BACKGROUND: background ? "1" : "0" },
          detached: process.platform !== "win32",
          stdio: ["ignore", "pipe", "ignore", "ipc"],
        });
        const launched = child;
        latestUrl = undefined;
        automation = undefined;
        let resolveAutomation;
        let rejectAutomation;
        automationReady = new Promise((resolve, reject) => {
          resolveAutomation = resolve;
          rejectAutomation = reject;
        });
        void automationReady.catch(() => {});
        ready = new Promise((resolve, reject) => {
          const lines = createInterface({ input: launched.stdout });
          lines.on("line", (line) => {
            try {
              const message = JSON.parse(line);
              if (message?.type === "kaitu:automation" && typeof message.ready === "boolean") {
                automation = message.ready;
                resolveAutomation();
                return;
              }
              if (message?.type !== "kaitu:web") return;
              const url = URL.parse(message.url);
              if (
                url?.protocol === "http:" &&
                url.hostname === "127.0.0.1" &&
                url.searchParams.has("token")
              ) {
                latestUrl = url.href;
                resolve();
              }
            } catch {
              // CLI diagnostics are not routed to the workbench or its logs.
            }
          });
          launched.once("exit", () => {
            lines.close();
            rejectAutomation(new Error("自动任务服务已退出 / Automation service exited"));
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
      if (!waitForUrl && !waitForAutomation) return { pid: child?.pid };
      let timeout;
      try {
        await Promise.race([
          waitForAutomation ? automationReady : ready,
          new Promise((_, reject) => {
            timeout = setTimeout(
              () =>
                reject(
                  Object.assign(
                    new Error(
                      waitForAutomation
                        ? "自动任务服务未就绪，请检查日程状态后重试 / Automation service is not ready. Check schedule storage and retry."
                        : "插件页面仍未就绪，请重试",
                    ),
                    { name: "KaituError", code: "DSH_STATE_UNSAFE" },
                  ),
                ),
              20000,
            );
          }),
        ]);
        if (waitForAutomation && automation !== true)
          throw Object.assign(
            new Error(
              "自动任务初始化失败，请检查日程状态后重试 / Automation could not initialize. Check schedule storage and retry.",
            ),
            { name: "KaituError", code: "DSH_STATE_UNSAFE" },
          );
        return { pid: child?.pid, url: latestUrl };
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
