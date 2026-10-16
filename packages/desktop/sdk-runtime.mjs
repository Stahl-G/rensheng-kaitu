import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export function createSdkRuntime({ executable, archive, home, workspace, plugin, hostPlugin, helper }) {
  const modules = join(archive, "dsh/node_modules");
  const settingsFile = join(home, "kaitu-ai.json");
  const env = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: "1",
    DSH_HOME: home,
    KAITU_DSH_MODULES: modules,
    KAITU_DIR: workspace,
    DSH_PRIMARY_RUNTIME: "",
    DSH_PERMISSION_MODE: "workspace-write",
  };
  // A desktop launch must not inherit a developer shell's model credential.
  for (const key of Object.keys(env)) if (/(?:API_KEY|AUTH_TOKEN)$/.test(key)) delete env[key];
  const loadSettings = () =>
    existsSync(settingsFile)
      ? JSON.parse(readFileSync(settingsFile, "utf8"))
      : { choice: undefined, provider: "deepseek-official", model: "deepseek-flash" };
  const credential = (operation, input) =>
    new Promise((resolve, reject) => {
      const child = spawn(executable, [helper, operation], { env, stdio: ["pipe", "pipe", "ignore"] });
      let output = "";
      child.stdout.on("data", (chunk) => {
        output += chunk;
      });
      child.once("error", () => reject(new Error("无法访问 AI 凭据存储")));
      child.once("exit", (code) => {
        if (code !== 0) reject(new Error("无法访问 AI 凭据存储"));
        else {
          try {
            resolve(JSON.parse(output));
          } catch {
            reject(new Error("无法访问 AI 凭据存储"));
          }
        }
      });
      child.stdin.on("error", () => {});
      child.stdin.end(input ? JSON.stringify(input) : "");
    });
  return {
    async settings() {
      const settings = loadSettings();
      const info = await credential("status");
      return { ...settings, configured: settings.choice !== "external" && info.configured };
    },
    async configure(input) {
      if (input.choice !== "builtin" && input.choice !== "external") throw new Error("请选择 AI 连接方式");
      if (input.choice === "builtin" && input.apiKey !== undefined) {
        if (typeof input.apiKey !== "string" || !input.apiKey.trim() || input.apiKey.length > 4096)
          throw new Error("请输入有效 API Key");
        await credential("save", { apiKey: input.apiKey.trim() });
      }
      const settings = { choice: input.choice, provider: "deepseek-official", model: "deepseek-flash" };
      if (settings.choice === "builtin" && !(await credential("status")).configured)
        throw new Error("请先填入 API Key");
      mkdirSync(home, { recursive: true, mode: 0o700 });
      writeFileSync(settingsFile, JSON.stringify(settings), { mode: 0o600 });
      return { ...settings, configured: settings.choice === "builtin" };
    },
    async runtime() {
      const settings = loadSettings();
      if (settings.choice === "external" || !(await credential("status")).configured)
        throw new Error("请先连接内置 AI");
      const profile = join(home, "kaitu-sdk.patch.json");
      mkdirSync(home, { recursive: true, mode: 0o700 });
      writeFileSync(
        profile,
        JSON.stringify([
          { id: "sdk-jsonrpc-server", disabled: true },
          { id: "sandbox", disabled: true },
          { id: "fs-sandbox", disabled: true },
          { id: "sandbox-policy", config: { mode: "workspace-write", workspaceRoot: workspace } },
          { id: "approval", config: { policy: "never" } },
          {
            id: "permission",
            config: {
              defaultPreset: "kaitu",
              presets: {
                kaitu: {
                  sandbox: "workspace-write",
                  approval: "never",
                  name: "只读写开图资料",
                },
              },
            },
          },
          { id: "tool-skill", disabled: false },
          {
            insert: [
              { id: "kaitu-sdk-host", name: hostPlugin },
              { id: "kaitu-sdk-rpc", name: join(dirname(hostPlugin), "sdk-rpc.mjs") },
              { id: "kaitu", name: plugin, config: { workspace } },
            ],
          },
        ]),
        { mode: 0o600 },
      );
      const { JsonRpcLineTransport } = await import(
        pathToFileURL(join(modules, "@deepseek-ai/dsh-sdk-protocol/lib/index.js")).href
      );
      const child = spawn(
        executable,
        [
          "--expose-internals",
          join(modules, "@deepseek-ai/dsh-desktop-host/lib/cli.js"),
          "--profile",
          "sdk",
          "--patch",
          profile,
        ],
        {
          cwd: workspace,
          env,
          detached: true,
          stdio: ["pipe", "pipe", "ignore"],
        },
      );
      const listeners = new Set();
      const active = new Set();
      const rpc = new JsonRpcLineTransport(child.stdout, child.stdin);
      let dead = false;
      let closing;
      child.stdin.on("error", () => {});
      const failed = () => {
        dead = true;
        rpc.close();
        for (const sessionId of active)
          for (const listener of listeners)
            listener("session.status", {
              sessionId,
              status: "idle",
              error: "内置 AI 已退出，请重新连接后继续",
            });
        active.clear();
      };
      child.once("error", failed);
      child.once("exit", failed);
      rpc.onNotification((method, params) => {
        if (method === "session.status" && params.status === "idle") active.delete(params.sessionId);
        for (const listener of listeners) listener(method, params);
      });
      rpc.start();
      const close = () => {
        closing ??= (async () => {
          if (dead) return;
          try {
            await rpc.request("shutdown", {}, AbortSignal.timeout(1500));
          } catch {
            /* EOF continues shutdown. */
          }
          child.stdin.end();
          const wait = (ms) =>
            new Promise((resolve) => {
              if (dead) return resolve();
              const done = () => {
                clearTimeout(timer);
                child.off("exit", done);
                resolve();
              };
              const timer = setTimeout(done, ms);
              child.once("exit", done);
            });
          await wait(4000);
          if (!dead) {
            process.kill(-child.pid, "SIGTERM");
            await wait(2000);
          }
          if (!dead) {
            process.kill(-child.pid, "SIGKILL");
            await wait(2000);
          }
          rpc.close();
        })();
        return closing;
      };
      try {
        await rpc.request(
          "initialize",
          { cwd: workspace, provider: settings.provider, model: settings.model },
          AbortSignal.timeout(20000),
        );
      } catch {
        await close();
        throw new Error("内置 AI 未能初始化");
      }
      return {
        request(method, params) {
          if (dead) throw new Error("内置 AI 已退出");
          if (method === "session/prompt") active.add(params.sessionId);
          return rpc.request(method, params, AbortSignal.timeout(20000));
        },
        onNotification(listener) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        close,
      };
    },
  };
}

export const sdkSupportFiles = dirname(fileURLToPath(import.meta.url));
