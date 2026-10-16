import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { KaituError } from "../core/dist/index.js";
import { assertDesktopIsolation } from "./environment.mjs";
import { connectionInfo, credentialRef, providerPatch, selection } from "./sdk-providers.mjs";

export function sdkRuntimePatch({ workspace, plugin, hostPlugin, mode }) {
  if (mode === "full")
    return [
      { id: "sdk-jsonrpc-server", disabled: true },
      { id: "sandbox-policy", config: { mode: "danger-full-access", workspaceRoot: workspace } },
      { id: "approval", config: { policy: "never" } },
      {
        insert: [
          { id: "kaitu-sdk-rpc", name: join(dirname(hostPlugin), "sdk-rpc.mjs") },
          { id: "kaitu", name: plugin, config: { workspace } },
        ],
      },
    ];
  return [
    { id: "sdk-jsonrpc-server", disabled: true },
    { id: "sandbox", disabled: true },
    { id: "fs-sandbox", disabled: true },
    ...[
      "tool-bash",
      "tool-pwsh",
      "tool-jobs",
      "tool-web",
      "web-fetch-http",
      "web-search-deepseek",
      "tool-subagent",
      "tool-subagent-fork",
      "tool-subagent-control",
      "tool-subagent-list-agents",
      "tool-workflow",
      "tool-plugin-manager",
      "bash-sandbox",
      "pwsh-sandbox",
      "shell-env",
      "ptc-runtime",
      "workflow-ptc",
    ].map((id) => ({ id, disabled: true })),
    {
      id: "skill-filesystem",
      config: {
        includeDefaultRoots: false,
        customSkillDirs: [join(workspace, ".agents/skills")],
        watch: false,
      },
    },
    {
      id: "agent-instructions",
      config: { maxBytes: 65536, dshHome: join(workspace, ".dsh"), projectRootMarkers: [".kaitu"] },
    },
    { id: "sandbox-policy", config: { mode: "workspace-write", workspaceRoot: workspace } },
    { id: "approval", config: { policy: "never" } },
    { id: "permission", disabled: true },
    { id: "tool-skill", disabled: false },
    {
      insert: [
        { id: "kaitu-sdk-host", name: hostPlugin },
        { id: "kaitu-sdk-rpc", name: join(dirname(hostPlugin), "sdk-rpc.mjs") },
        { id: "kaitu", name: plugin, config: { workspace } },
      ],
    },
  ];
}

export function createSdkRuntime({ executable, archive, home, workspace, plugin, hostPlugin, helper }) {
  assertDesktopIsolation(workspace, home);
  const modules = join(archive, "dsh/node_modules");
  const settingsFile = join(home, "kaitu-ai.json");
  const env = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: "1",
    DSH_HOME: home,
    KAITU_DSH_MODULES: modules,

    DSH_PRIMARY_RUNTIME: "",
    DSH_PERMISSION_MODE: "workspace-write",
  };
  // A desktop launch must not inherit a developer shell's model credential.
  for (const key of Object.keys(env)) if (/(?:API_KEY|AUTH_TOKEN)$/.test(key)) delete env[key];
  const readSettings = () =>
    existsSync(settingsFile)
      ? JSON.parse(readFileSync(settingsFile, "utf8"))
      : { choice: undefined, provider: "deepseek-official", model: "deepseek-flash" };
  const loadSettings = () => {
    const stored = readSettings();
    return { choice: stored.choice, ...selection(stored) };
  };
  const credential = (operation, input) =>
    new Promise((resolve, reject) => {
      const child = spawn(executable, [helper, operation], { env, stdio: ["pipe", "pipe", "ignore"] });
      let output = "";
      child.stdout.on("data", (chunk) => {
        output += chunk;
      });
      child.once("error", () => reject(new KaituError("无法访问 AI 凭据存储", "AI_CREDENTIALS")));
      child.once("exit", (code) => {
        if (code !== 0) reject(new KaituError("无法访问 AI 凭据存储", "AI_CREDENTIALS"));
        else {
          try {
            resolve(JSON.parse(output));
          } catch {
            reject(new KaituError("无法访问 AI 凭据存储", "AI_CREDENTIALS"));
          }
        }
      });
      child.stdin.on("error", () => {});
      child.stdin.end(input ? JSON.stringify(input) : "");
    });
  return {
    async settings() {
      const settings = loadSettings();
      const info = await credential("status", { ref: credentialRef(settings.provider) });
      return connectionInfo({ ...settings, configured: settings.choice !== "external" && info.configured });
    },
    async configure(input) {
      if (input.choice !== "builtin" && input.choice !== "external")
        throw new KaituError("请选择 AI 连接方式", "AI_CONFIG");
      let settings;
      try {
        settings = { choice: input.choice, ...selection(input, loadSettings()) };
      } catch (error) {
        throw new KaituError(error.message, "AI_CONFIG");
      }
      if (input.choice === "builtin") {
        if (
          input.apiKey !== undefined &&
          (typeof input.apiKey !== "string" || !input.apiKey.trim() || input.apiKey.length > 4096)
        )
          throw new KaituError("请输入有效 API Key", "AI_KEY");
        if (
          settings.provider === "kaitu-custom" &&
          settings.baseURL !== loadSettings().baseURL &&
          !input.apiKey
        )
          throw new KaituError("更换 Base URL 后请填入该服务的 API Key", "AI_KEY");
        const ref = credentialRef(settings.provider);
        const result = await credential("validate", { settings, ref, apiKey: input.apiKey?.trim() });
        if (!result.configured) throw new KaituError(result.message, result.code);
        if (input.apiKey) await credential("save", { ref, apiKey: input.apiKey.trim() });
      }
      mkdirSync(home, { recursive: true, mode: 0o700 });
      writeFileSync(settingsFile, JSON.stringify(settings), { mode: 0o600 });
      return connectionInfo({ ...settings, configured: settings.choice === "builtin" });
    },
    async runtime(mode = "scoped") {
      if (!["scoped", "full"].includes(mode)) throw new Error("无效模式");
      const settings = loadSettings();
      if (
        settings.choice === "external" ||
        !(await credential("status", { ref: credentialRef(settings.provider) })).configured
      )
        throw new KaituError("请先连接内置 AI", "AI_CONNECTION");
      const profile = join(home, `kaitu-sdk-${mode}.patch.json`);
      mkdirSync(home, { recursive: true, mode: 0o700 });
      writeFileSync(
        profile,
        JSON.stringify([
          ...sdkRuntimePatch({ workspace, plugin, hostPlugin, mode }),
          ...providerPatch(settings),
        ]),
        {
          mode: 0o600,
        },
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
          env: {
            ...env,
            DSH_PERMISSION_MODE: mode === "full" ? "danger-full-access" : "workspace-write",
            KAITU_AGENT_MODE: mode,
            KAITU_DIR: workspace,
          },
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
        throw new KaituError("内置 AI 未能初始化，请检查连接设置后重试", "AI_CONNECTION");
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
