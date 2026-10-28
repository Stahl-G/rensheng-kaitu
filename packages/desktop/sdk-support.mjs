import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const resolveModule = createRequire(join(process.env.KAITU_DSH_MODULES, "package.json")).resolve;
const load = (name) => import(pathToFileURL(resolveModule(name)).href);
const { JsonRpcLineTransport } = await load("@deepseek-ai/dsh-sdk-protocol");
export const name = "kaitu-sdk-support";
export const inject = ["sdkAppStartup", "llm", "authorization", "configEditor"];

// 问问的服务商按 DSH 自己的格式存在 sdk profile 的 cordis.patch.yml：DeepSeek 在 llm-deepseek，其余在 llm-pi-ai。
const LLM_ENTRIES = ["llm-deepseek", "llm-pi-ai"];
const modelIds = (models) => (Array.isArray(models) ? models.map((model) => model?.id).filter(Boolean) : []);
const mergeModels = (old = [], next = []) => [
  ...old.filter((model) => !next.some((item) => item.id === model?.id)),
  ...next,
];
function savedProviders(ctx) {
  const rows = [];
  for (const { entry, override } of ctx.configEditor.configuration()) {
    if (entry.options.id === "llm-deepseek" && modelIds(override.models).length)
      rows.push({ provider: "deepseek-official", models: modelIds(override.models) });
    if (entry.options.id === "llm-pi-ai")
      for (const [provider, config] of Object.entries(override.providers ?? {}))
        if (modelIds(config?.models).length)
          rows.push({
            provider,
            api: config.api,
            baseURL: config.baseURL,
            auth: config.apiKeyEnv ? "key" : "dsh",
            models: modelIds(config.models),
          });
  }
  return rows;
}
async function saveProvider(ctx, patch) {
  for (const row of patch) {
    const entry = ctx.configEditor.entries().find((item) => item.options.id === row.id);
    if (!entry || !LLM_ENTRIES.includes(row.id)) continue;
    if (row.id === "llm-deepseek")
      await ctx.configEditor.edit(entry, (current) => ({
        ...current,
        ...row.config,
        models: mergeModels(current.models, row.config.models),
      }));
    else
      for (const [provider, config] of Object.entries(row.config.providers ?? {}))
        await ctx.configEditor.edit(entry, (current) => ({
          ...current,
          providers: {
            ...current.providers,
            [provider]: {
              ...current.providers?.[provider],
              ...config,
              models: mergeModels(current.providers?.[provider]?.models, config.models),
            },
          },
        }));
  }
  return savedProviders(ctx);
}
export function apply(ctx) {
  const transport = new JsonRpcLineTransport(process.stdin, process.stdout);
  const attempts = new Map();
  // 只等 ChatGPT 自己的服务；不等待工作区插件或整个插件加载器。
  const siwcReady = new Promise((resolve) => {
    ctx.inject(["chatgptSiwc"], (services) => resolve(services.chatgptSiwc));
  });
  transport.onRequest(async (method, params) => {
    if (method === "initialize") return { serverInfo: { name: "kaitu-dsh-capabilities", version: "1" } };
    if (method.startsWith("kaitu/siwc/")) {
      const action = method.slice("kaitu/siwc/".length);
      if (!["status", "models", "beginSignIn", "cancelSignIn", "signOut", "refreshModels"].includes(action))
        throw new Error("未知 ChatGPT 请求");
      let timer;
      const service = await Promise.race([
        siwcReady,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error("ChatGPT 连接不可用")), 15000);
        }),
      ]).finally(() => clearTimeout(timer));
      if (action === "models") {
        const status = await service.refreshModels();
        if (status.error) throw new Error(status.error);
        return (await ctx.llm.listModels("chatgpt-siwc")).map((model) => ({
          id: model.id,
          name: model.name ?? model.id,
          ...(model.reasoning?.efforts?.length ? { reasoning: model.reasoning } : {}),
          ...(model.inputModalities
            ? { image: model.inputModalities.includes("image") }
            : typeof model.imageInput === "boolean"
              ? { image: model.imageInput }
              : {}),
        }));
      }
      return service[action]();
    }
    if (method === "kaitu/directory") {
      return { providers: ctx.llm.listConfigurableProviders(), authorization: ctx.authorization.list() };
    }
    if (method === "kaitu/providers") return savedProviders(ctx);
    if (method === "kaitu/saveProvider") return saveProvider(ctx, params.patch);
    if (method === "kaitu/models") {
      return ctx.llm.discoverModels("llm-pi-ai", { provider: params.provider }, AbortSignal.timeout(20000));
    }
    if (method === "kaitu/sessionMention") {
      const { formatSessionReferenceMention } = await load("@deepseek-ai/dsh-session-reference");
      return formatSessionReferenceMention({ sessionId: params.sessionId, label: params.label });
    }
    if (method === "kaitu/authStart") {
      const key = params.key;
      const entry = ctx.authorization.describe(key);
      if (!entry?.methods.some((item) => item.id === params.method)) throw new Error("此服务没有该登录方式");
      if (attempts.get(key)?.status === "running") throw new Error("登录正在进行");
      const attempt = { status: "running", notices: [], prompt: null };
      attempts.set(key, attempt);
      void ctx.authorization
        .begin({
          key,
          method: params.method,
          interaction: {
            notify: (notice) => {
              attempt.notices.push(notice);
            },
            prompt: (prompt) =>
              new Promise((resolve, reject) => {
                const { signal, ...display } = prompt;
                attempt.prompt = display;
                attempt.answer = (value) => {
                  attempt.prompt = null;
                  resolve(value);
                };
                const abort = () => {
                  attempt.prompt = null;
                  reject(new Error("登录已取消"));
                };
                if (signal?.aborted) abort();
                else signal?.addEventListener("abort", abort, { once: true });
                attempt.reject = abort;
              }),
          },
        })
        .then((result) => {
          attempt.status = result.status;
        })
        .catch(() => {
          attempt.status = "failed";
          attempt.error = "登录未完成，请重试";
        })
        .finally(() => {
          attempt.prompt = null;
          attempt.answer = undefined;
          attempt.reject = undefined;
        });
      return { status: attempt.status };
    }
    if (method === "kaitu/authPoll") {
      const attempt = attempts.get(params.key);
      if (!attempt) return { status: "idle", notices: [] };
      return {
        status: attempt.status,
        notices: attempt.notices,
        prompt: attempt.prompt,
        error: attempt.error,
      };
    }
    if (method === "kaitu/authAnswer") {
      const attempt = attempts.get(params.key);
      if (!attempt?.prompt || typeof params.value !== "string") throw new Error("登录问题已结束");
      attempt.answer(params.value);
      return { accepted: true };
    }
    if (method === "kaitu/authCancel") {
      ctx.authorization.cancel(params.key);
      attempts.get(params.key)?.reject?.();
      return { cancelled: true };
    }
    if (method === "shutdown") {
      setImmediate(() => {
        void transport
          .flush()
          .then(() => ctx.root.fiber.dispose())
          .finally(() => process.exit(0));
      });
      return {};
    }
    throw new Error("未知账号请求");
  });
  ctx.effect(() => {
    transport.start();
    return () => transport.close();
  });
}
