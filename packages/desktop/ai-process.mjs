import { spawn } from "node:child_process";

/** A single owned Electron child, with IPC focus and bounded process-group shutdown. */
export function createAiProcess(executable, env) {
  let child;
  let starting;
  let stopping;
  let closed = false;
  const send = (type) => {
    if (child?.connected) child.send({ type }, () => {});
  };
  return {
    async open({ background = false } = {}) {
      if (closed) throw new Error("开图正在退出");
      if (!child) {
        child = spawn(executable, [], {
          env: { ...env, KAITU_AI_BACKGROUND: background ? "1" : "0" },
          detached: true,
          stdio: ["ignore", "ignore", "ignore", "ipc"],
        });
        const launched = child;
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
      return { pid: child?.pid };
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
            process.kill(-owned.pid, "SIGKILL");
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
