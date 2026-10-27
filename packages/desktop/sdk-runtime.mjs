import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

import { KaituError } from "../core/dist/index.js";
import { assertDesktopIsolation } from "./environment.mjs";
import {
  connectionInfo,
  credentialRef,
  extendProviders,
  providerPatch,
  providers,
  selection,
} from "./sdk-providers.mjs";
import {
  nativeSearchInfo,
  searchProviders,
  searchSettings,
  webRuntimePatch,
} from "./sdk-search-settings.mjs";

export function sdkRuntimePatch({
  workspace,
  plugin,
  hostPlugin,
  mode,
  connection = "local-ask",
  textOnly = false,
}) {
  // SDK bundle 不挂产品埋点；关闭其余额外诊断信息与会话遥测。
  const siwc = { insert: [{ id: "chatgpt-siwc", name: join(dirname(hostPlugin), "chatgpt-siwc.mjs") }] };
  const privacy = ["session-telemetry-otel", "session-log-deepseek", "plugin-package-inventory-deepseek"].map(
    (id) => ({ id, disabled: true }),
  );
  // 只收发文字：不开网页和技能工具；万一还有工具被调用，宿主插件在执行前拒绝（KAITU_AGENT_TOOLS=none）。
  const web = textOnly
    ? [
        { id: "tool-web", disabled: true },
        { id: "tool-skill", disabled: true },
      ]
    : [
        ...webRuntimePatch(hostPlugin),
        {
          insert: [
            { id: "kaitu-session-reference", name: "@deepseek-ai/dsh-session-reference" },
            { id: "kaitu-file-reference", name: "@deepseek-ai/dsh-file-reference-local" },
          ],
        },
      ];
  if (mode === "full" && !textOnly)
    return [
      ...privacy,
      siwc,
      ...web,
      { id: "sdk-jsonrpc-server", disabled: true },
      { id: "sandbox-policy", config: { mode: "danger-full-access", workspaceRoot: workspace } },
      { id: "approval", config: { policy: "never" } },
      {
        insert: [
          { id: "kaitu-sdk-rpc", name: join(dirname(hostPlugin), "sdk-rpc.mjs") },
          { id: "kaitu", name: plugin, config: { workspace, connection } },
        ],
      },
    ];
  return [
    ...privacy,
    siwc,
    ...web,
    { id: "sdk-jsonrpc-server", disabled: true },
    { id: "sandbox", disabled: true },
    { id: "fs-sandbox", disabled: true },
    ...[
      "tool-bash",
      "tool-pwsh",
      "tool-jobs",
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
      config: { maxBytes: 65536, projectRootMarkers: ["AGENTS.md"] },
    },
    // 只收发文字时不读工作区的 AGENTS.md 和技能，模型只看到这次给的材料。
    ...(textOnly
      ? [
          { id: "skill-filesystem", disabled: true },
          { id: "agent-instructions", disabled: true },
        ]
      : []),
    { id: "sandbox-policy", config: { mode: "workspace-write", workspaceRoot: workspace } },
    { id: "approval", config: { policy: "never" } },
    { id: "permission", disabled: true },
    { id: "tool-skill", disabled: textOnly },
    {
      insert: [
        { id: "kaitu-sdk-host", name: hostPlugin },
        { id: "kaitu-sdk-rpc", name: join(dirname(hostPlugin), "sdk-rpc.mjs") },
        { id: "kaitu", name: plugin, config: { workspace, connection } },
      ],
    },
  ];
}

export function createSdkRuntime({
  executable,
  archive,
  home,
  workspace,
  plugin,
  hostPlugin,
  helper,
  modules = join(archive, "dsh/node_modules"),
  entry = join(modules, "@deepseek-ai/dsh-desktop-host/lib/cli.js"),
}) {
  assertDesktopIsolation(workspace, home);
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
      : { choice: undefined, provider: "deepseek-official", model: "" };
  let directory;
  const loadDirectory = async () => {
    directory ??= credential("catalog")
      .then((entries) => {
        extendProviders(entries);
        return entries;
      })
      .catch((error) => {
        directory = undefined;
        throw error;
      });
    return directory;
  };
  const loadSettings = async () => {
    await loadDirectory();
    const stored = readSettings();
    if (stored.provider && !providers.some((item) => item.id === stored.provider)) await savedProviders();
    return { choice: stored.choice, ...selection(stored) };
  };
  const credential = (operation, input) =>
    new Promise((resolve, reject) => {
      const child = spawn(executable, [helper, operation], { env, stdio: ["pipe", "pipe", "ignore"] });
      const timer = setTimeout(() => {
        child.kill("SIGTERM");
        reject(new KaituError("AI 凭据读取超时，请重试", "AI_CREDENTIALS"));
      }, 20000);
      child.once("error", () => clearTimeout(timer));
      child.once("exit", () => clearTimeout(timer));
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
  const searchFile = join(home, "kaitu-search.json");
  const preferredSearch = () =>
    existsSync(searchFile) ? JSON.parse(readFileSync(searchFile, "utf8")).provider : undefined;
  const describeSearch = async () => {
    const settings = await loadSettings();
    const info = await credential("search-status", { ref: credentialRef(settings.provider) });
    return searchSettings(info.search, preferredSearch(), nativeSearchInfo(settings, info.configured));
  };
  const configureSearch = async (input) => {
    const entry = searchProviders.find((item) => item.id === input?.provider);
    if (!entry) throw new KaituError("请选择网络搜索服务", "AI_CONFIG");
    if (input.remove === true) await credential("unset", { ref: entry.ref });
    else if (input.apiKey !== undefined) {
      if (typeof input.apiKey !== "string" || !input.apiKey.trim() || input.apiKey.length > 4096)
        throw new KaituError("请输入有效的搜索 API Key", "AI_KEY");
      await credential("save", { ref: entry.ref, apiKey: input.apiKey.trim() });
    } else if (!(await credential("status", { ref: entry.ref })).configured)
      throw new KaituError("请先添加这个搜索服务的 API Key", "AI_SEARCH_KEY");
    mkdirSync(home, { recursive: true, mode: 0o700 });
    writeFileSync(searchFile, JSON.stringify({ provider: entry.id }), { mode: 0o600 });
    return describeSearch();
  };
  // 已添加的服务商存在 DSH 的 profile 里（可以有多个）；自定义服务各自一个 id，按地址区分。
  const savedProviders = async () => {
    const rows = await api.support("providers");
    extendProviders(
      rows
        .filter((row) => row.baseURL && !providers.some((item) => item.id === row.provider))
        .map((row) => ({
          id: row.provider,
          name: new URL(row.baseURL).hostname,
          api: row.api,
          baseURL: row.baseURL,
        })),
    );
    const status = await api.support("siwc/status");
    if (status.authenticated && status.planEnabled) {
      const refreshed = await api.support("siwc/refreshModels");
      if (refreshed.models.length)
        rows.push({ provider: "chatgpt-siwc", models: refreshed.models.map((m) => m.id) });
    }
    return rows.map((row) => ({
      ...row,
      name: providers.find((item) => item.id === row.provider)?.name ?? row.provider,
    }));
  };
  const saveProvider = (settings) => api.support("saveProvider", { patch: providerPatch(settings) });
  let capabilityRuntime;
  let capabilityAbort;
  let connectionStatus;
  const activeSiwcRuntimes = new Set();
  const api = {
    async support(method, input = {}) {
      if (method === "siwc/signOut") await Promise.all([...activeSiwcRuntimes].map((close) => close()));
      if (!capabilityRuntime) {
        const controller = new AbortController();
        capabilityAbort = controller;
        capabilityRuntime = api
          .runtime("scoped", true, "local-ask", false, controller.signal)
          .catch((error) => {
            if (capabilityAbort === controller) {
              capabilityAbort = undefined;
              capabilityRuntime = undefined;
            }
            throw error;
          });
      }
      const result = await (await capabilityRuntime).request(`kaitu/${method}`, input);
      if (method.startsWith("siwc/")) connectionStatus = undefined;
      if (method === "saveProvider" || (method === "authPoll" && result.status !== "running"))
        connectionStatus = undefined;
      return result;
    },
    async closeSupport() {
      const running = capabilityRuntime;
      capabilityAbort?.abort();
      capabilityAbort = undefined;
      capabilityRuntime = undefined;
      connectionStatus = undefined;
      if (running)
        await running.then(
          (runtime) => runtime.close(),
          () => {},
        );
    },
    async models(input) {
      const previous = await loadSettings();
      const settings = selection(input, previous);
      if (settings.provider === "chatgpt-siwc") {
        return api.support("siwc/models");
      }
      if (settings.auth === "dsh") {
        const models = await api.support("models", { provider: settings.provider });
        return models.map((item) => ({
          id: item.id,
          name: item.name,
          image: item.inputModalities?.includes("image"),
        }));
      }
      const result = await credential("models", {
        settings,
        ref: credentialRef(settings.provider),
        apiKey: input.apiKey,
        useStoredKey: settings.provider !== "kaitu-custom" || settings.baseURL === previous.baseURL,
      });
      if (result.code) throw new KaituError(result.message, result.code);
      return result.models;
    },
    async settings(resolveImages = false) {
      // 连接判定不启动 SDK，也不读取模型目录；真实发送仍在 runtime 里验证。
      connectionStatus ??= (async () => {
        const settings = readSettings();
        const info =
          settings.provider === "chatgpt-siwc" && settings.choice === "builtin"
            ? await api
                .support("siwc/status")
                .then((status) => ({ configured: status.authenticated && status.planEnabled }))
            : settings.choice === "builtin"
              ? await credential("status", { ref: credentialRef(settings.provider), settings })
              : { configured: false };
        return {
          ...connectionInfo({
            ...settings,
            configured: settings.choice === "builtin" && info.configured,
          }),
          supportsImages: settings.supportsImages,
          providerName: providers.find((entry) => entry.id === settings.provider)?.name ?? settings.provider,
        };
      })().catch((error) => {
        connectionStatus = undefined;
        throw error;
      });
      const current = await connectionStatus;
      if (
        resolveImages &&
        current.configured &&
        current.supportsImages === undefined &&
        current.provider !== "chatgpt-siwc"
      ) {
        const info = await credential("model-status", { settings: readSettings() });
        current.supportsImages = info.supportsImages ?? false;
      }
      return current;
    },
    async catalogSettings(includeSaved = false) {
      // 仅 AI 设置和模型选择器显式读取完整目录；失败不能假装没有已保存服务商。
      await loadDirectory();
      const settings = await api.settings();
      const saved =
        includeSaved || !providers.some((entry) => entry.id === settings.provider)
          ? await savedProviders()
          : undefined;
      return { ...settings, providers, ...(saved ? { saved } : {}), search: await describeSearch() };
    },
    async configure(input) {
      connectionStatus = undefined;
      await loadDirectory();
      if (input.search !== undefined) return configureSearch(input.search);
      if (input.choice !== "builtin" && input.choice !== "external")
        throw new KaituError("请选择 AI 连接方式", "AI_CONFIG");
      let settings;
      try {
        settings = { choice: input.choice, ...selection(input, await loadSettings()) };
      } catch (error) {
        throw new KaituError(error.message, "AI_CONFIG");
      }
      if (input.choice === "builtin") {
        if (!settings.model) throw new KaituError("请选择或填写模型 ID", "AI_MODEL");
        if (settings.provider === "kaitu-custom") {
          const host = new URL(settings.baseURL).hostname;
          const id = `custom-${host.replace(/[^a-zA-Z0-9]+/g, "-").toLowerCase()}`;
          extendProviders([{ id, name: host, api: settings.api, baseURL: settings.baseURL }]);
          settings = { ...settings, provider: id };
        }
        if (
          input.apiKey !== undefined &&
          (typeof input.apiKey !== "string" || !input.apiKey.trim() || input.apiKey.length > 4096)
        )
          throw new KaituError("请输入有效 API Key", "AI_KEY");
        if (
          settings.provider === "kaitu-custom" &&
          settings.baseURL !== (await loadSettings()).baseURL &&
          !input.apiKey
        )
          throw new KaituError("更换 Base URL 后请填入该服务的 API Key", "AI_KEY");
        if (settings.provider === "chatgpt-siwc") {
          const status = await api.support("siwc/status");
          if (!status.authenticated || !status.planEnabled)
            throw new KaituError(status.error ?? "请先登录 ChatGPT", "AI_AUTH");
          const models = await api.support("siwc/models");
          const model = models.find((item) => item.id === settings.model);
          if (!model) throw new KaituError("模型不在当前账号目录中，请刷新模型列表", "AI_MODEL");
          settings.supportsImages = model.image;
          settings.auth = "dsh";
        } else {
          const ref = credentialRef(settings.provider);
          // 切回已添加过的服务商和模型时只确认 Key 还在，不再发验证请求。
          const known =
            !input.apiKey &&
            (await savedProviders()).some(
              (row) => row.provider === settings.provider && row.models.includes(settings.model),
            );
          const result =
            settings.auth === "dsh" || (known && !input.apiKey)
              ? await credential("status", { settings, ref })
              : await credential("validate", { settings, ref, apiKey: input.apiKey?.trim() });
          if (!result.configured)
            throw new KaituError(result.message ?? "请先完成此服务的登录", result.code ?? "AI_AUTH");
          if (input.apiKey) await credential("save", { ref, apiKey: input.apiKey.trim() });
          await saveProvider(settings);
        }
      }
      mkdirSync(home, { recursive: true, mode: 0o700 });
      writeFileSync(settingsFile, JSON.stringify(settings), { mode: 0o600 });
      return api.settings();
    },
    async runtime(
      mode = "scoped",
      capabilities = false,
      connection = "local-ask",
      textOnly = false,
      signal = undefined,
    ) {
      if (!["scoped", "full"].includes(mode)) throw new Error("无效模式");
      // 能力进程只用来读写服务商和登录，不需要当前选中的模型。
      const settings = capabilities ? {} : await loadSettings();
      if (!capabilities) {
        const info =
          settings.provider === "chatgpt-siwc"
            ? await api
                .support("siwc/status")
                .then((status) => ({ configured: status.authenticated && status.planEnabled }))
            : await credential("model-status", { ref: credentialRef(settings.provider), settings });
        settings.supportsImages ??= info.supportsImages;
        if (settings.choice !== "builtin" || !info.configured)
          throw new KaituError("请先连接内置 AI", "AI_CONNECTION");
      }
      const profile = join(
        home,
        `kaitu-sdk-${capabilities ? "capabilities" : `${mode}-${connection}${textOnly ? "-text" : ""}`}.patch.json`,
      );
      mkdirSync(home, { recursive: true, mode: 0o700 });
      writeFileSync(
        profile,
        JSON.stringify([
          ...(capabilities ? [] : providerPatch(settings)),
          ...sdkRuntimePatch({ workspace, plugin, hostPlugin, mode, connection, textOnly }),
        ]),
        {
          mode: 0o600,
        },
      );
      const { JsonRpcLineTransport } = await import(
        pathToFileURL(createRequire(join(modules, "package.json")).resolve("@deepseek-ai/dsh-sdk-protocol"))
          .href
      );
      signal?.throwIfAborted();
      const child = spawn(executable, ["--expose-internals", entry, "--profile", "sdk", "--patch", profile], {
        cwd: workspace,
        env: {
          ...env,
          DSH_PERMISSION_MODE: mode === "full" && !textOnly ? "danger-full-access" : "workspace-write",
          KAITU_AGENT_MODE: textOnly ? "scoped" : mode,
          KAITU_AGENT_CONNECTION: connection,
          KAITU_AGENT_TOOLS: textOnly ? "none" : "",
          KAITU_DIR: workspace,
        },
        detached: process.platform !== "win32",
        stdio: ["pipe", "pipe", "ignore"],
      });
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
          if (dead) {
            activeSiwcRuntimes.delete(close);
            return;
          }
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
            if (process.platform === "win32") child.kill("SIGTERM");
            else process.kill(-child.pid, "SIGTERM");
            await wait(2000);
          }
          if (!dead) {
            if (process.platform === "win32") child.kill("SIGKILL");
            else process.kill(-child.pid, "SIGKILL");
            await wait(2000);
          }
          rpc.close();
          activeSiwcRuntimes.delete(close);
        })();
        return closing;
      };
      if (!capabilities && settings.provider === "chatgpt-siwc") activeSiwcRuntimes.add(close);
      try {
        await rpc.request(
          "initialize",
          { cwd: workspace, provider: settings.provider, model: settings.model, capabilities },
          signal ? AbortSignal.any([signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000),
        );
      } catch {
        await close();
        throw new KaituError("内置 AI 未能初始化，请检查连接设置后重试", "AI_CONNECTION");
      }
      return {
        request(method, params) {
          if (dead) throw new Error("内置 AI 已退出");
          if (method === "session/prompt") active.add(params.sessionId);
          return rpc.request(
            method,
            params,
            method === "session/wait" ? undefined : AbortSignal.timeout(20000),
          );
        },
        onNotification(listener) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        close,
      };
    },
  };
  return api;
}
