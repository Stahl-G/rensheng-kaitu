export const providers = [
  {
    id: "deepseek-official",
    name: "DeepSeek",
    recommended: true,
    api: "anthropic-messages",
    baseURL: "https://api.deepseek.com/anthropic",
    keyUrl: "https://platform.deepseek.com/api_keys",
    modelsURL: "https://api.deepseek.com/models",
    modelsApi: "openai-completions",
  },
  {
    id: "chatgpt-siwc",
    name: "ChatGPT 计划",
    authMethods: [{ id: "oauth", label: "Continue with ChatGPT" }],
  },
  {
    id: "openai",
    name: "OpenAI",
    api: "openai-responses",
    baseURL: "https://api.openai.com/v1",
    keyUrl: "https://platform.openai.com/api-keys",
  },
  {
    id: "anthropic",
    name: "Anthropic Claude",
    api: "anthropic-messages",
    baseURL: "https://api.anthropic.com",
    keyUrl: "https://console.anthropic.com/settings/keys",
  },
  {
    id: "google",
    name: "Google Gemini",
    api: "google-generative-ai",
    baseURL: "https://generativelanguage.googleapis.com/v1beta",
    keyUrl: "https://aistudio.google.com/apikey",
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    api: "openai-completions",
    baseURL: "https://openrouter.ai/api/v1",
    keyUrl: "https://openrouter.ai/keys",
  },
  {
    id: "moonshotai-cn",
    name: "Kimi",
    api: "openai-completions",
    baseURL: "https://api.moonshot.cn/v1",
    keyUrl: "https://platform.kimi.com/console/api-keys",
  },
  {
    id: "kaitu-zhipu",
    name: "智谱",
    api: "openai-completions",
    baseURL: "https://open.bigmodel.cn/api/paas/v4",
    keyUrl: "https://bigmodel.cn/usercenter/proj-mgmt/apikeys",
  },
  {
    id: "kaitu-qwen",
    name: "通义千问",
    api: "openai-completions",
    baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    keyUrl: "https://bailian.console.aliyun.com/",
  },
  {
    id: "kaitu-custom",
    name: "自定义服务",
    api: "openai-completions",
  },
];
export function extendProviders(entries) {
  for (const entry of entries) {
    const old = providers.find((item) => item.id === entry.id);
    if (old) Object.assign(old, { authKey: entry.authKey, authMethods: entry.authMethods });
    else providers.splice(providers.length - 1, 0, entry);
  }
}
export const protocols = [
  { id: "openai-completions", name: "Chat Completions" },
  { id: "openai-responses", name: "Responses" },
  { id: "anthropic-messages", name: "Anthropic Messages" },
  { id: "google-generative-ai", name: "Gemini" },
];
export function messagesPath(root) {
  return root.endsWith("/v1") ? "/messages" : "/v1/messages";
}
export async function fetchModels(settings, apiKey) {
  const entry = providers.find((item) => item.id === settings.provider);
  if (
    !(settings.baseURL ?? entry.baseURL) ||
    !protocols.some((item) => item.id === (entry.modelsApi ?? settings.api ?? entry.api))
  )
    return {
      code: "AI_MODELS_UNSUPPORTED",
      message: "此通道请先用账号连接，再获取引擎支持的型号；也可以手填模型 ID。",
    };
  const root = (settings.baseURL ?? entry.baseURL).replace(/\/$/, "");
  const api = entry.modelsApi ?? settings.api ?? entry.api;
  const headers = { accept: "application/json" };
  let address = entry.modelsURL ?? `${root}/models`;
  if (api === "anthropic-messages") {
    address = `${root.replace(/\/v1$/, "")}/v1/models?limit=1000`;
    headers["anthropic-version"] = "2023-06-01";
    if (apiKey) headers["x-api-key"] = apiKey;
  } else if (api === "google-generative-ai") {
    address = `${root}/models?pageSize=1000`;
    if (apiKey) headers["x-goog-api-key"] = apiKey;
  } else if (apiKey) headers.authorization = `Bearer ${apiKey}`;
  const models = [];
  try {
    let page = address;
    while (page) {
      const response = await fetch(page, { headers, redirect: "error", signal: AbortSignal.timeout(20000) });
      if (!response.ok) return connectionFailure(response.status);
      const result = await response.json();
      const rows = result.data ?? result.models;
      const entries = Array.isArray(rows)
        ? rows
        : Object.entries(rows ?? {}).map(([id, value]) => ({ ...value, id }));
      for (const item of entries) {
        if (api === "google-generative-ai" && !item.supportedGenerationMethods?.includes("generateContent"))
          continue;
        const id = item.id ?? item.name?.replace(/^models\//, "");
        if (!id) continue;
        const modalities =
          item.inputModalities ?? item.input_modalities ?? item.architecture?.input_modalities;
        models.push({
          id,
          name: item.display_name ?? item.displayName ?? id,
          ...(Array.isArray(modalities) ? { image: modalities.includes("image") } : {}),
        });
      }
      const next = new URL(address);
      if (result.nextPageToken) next.searchParams.set("pageToken", result.nextPageToken);
      else if (result.has_more && result.last_id) next.searchParams.set("after_id", result.last_id);
      else break;
      page = next.href;
    }
    return { models: [...new Map(models.map((model) => [model.id, model])).values()] };
  } catch {
    return connectionFailure(0);
  }
}
export function credentialRef(provider) {
  return provider === "deepseek-official"
    ? "DEEPSEEK_API_KEY"
    : `KAITU_${provider.replace(/[^a-zA-Z0-9_]/g, "_").toUpperCase()}_API_KEY`;
}
export function selection(input, previous = {}) {
  const provider = input.provider ?? previous.provider ?? providers[0].id;
  const entry = providers.find((item) => item.id === provider);
  if (!entry) throw new Error("请选择支持的 AI 服务");
  const model = input.model ?? (previous.provider === provider ? previous.model : undefined) ?? "";
  if (typeof model !== "string" || (model && !/^[\w./:@+-]{1,180}$/.test(model)))
    throw new Error("请输入有效的模型 ID");
  let baseURL = entry.baseURL;
  if (provider === "kaitu-custom") {
    try {
      const url = new URL(input.baseURL ?? previous.baseURL);
      if (
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        !(
          url.protocol === "https:" ||
          (url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))
        )
      )
        throw new Error();
      baseURL = url.href.replace(/\/$/, "");
    } catch {
      throw new Error("Base URL 请填写 HTTPS 地址，本机服务可用 HTTP；不要包含 Key 或登录信息");
    }
  }
  const api =
    provider === "kaitu-custom"
      ? (input.api ?? (previous.provider === provider ? previous.api : undefined) ?? entry.api)
      : entry.api;
  if (provider === "kaitu-custom" && !protocols.some((item) => item.id === api))
    throw new Error("请选择支持的 API 协议");
  return {
    provider,
    model,
    auth: input.auth ?? (previous.provider === provider ? previous.auth : undefined),
    ...(entry.catalog ? { catalog: true, baseURL, api } : {}),
    supportsImages:
      input.supportsImages ??
      (previous.provider === provider && previous.model === model ? previous.supportsImages : undefined),
    ...(provider === "kaitu-custom" ? { baseURL, api } : {}),
  };
}
export function connectionInfo(settings) {
  const entry = providers.find((item) => item.id === settings.provider) ?? providers[0];
  return {
    ...settings,
    providerName: entry.name,
    supportsImages: settings.supportsImages ?? false,
    providers,
    protocols,
  };
}
export function providerPatch(settings) {
  const entry = providers.find((item) => item.id === settings.provider) ?? providers[0];
  const apiKeyEnv = credentialRef(entry.id);
  if (entry.id === "chatgpt-siwc") return [];
  if (entry.id === "deepseek-official")
    return [
      {
        id: "llm-deepseek",
        config: {
          apiKeyEnv,
          models: [
            { id: settings.model, inputModalities: settings.supportsImages ? ["text", "image"] : ["text"] },
          ],
        },
      },
      { id: "llm-pi-ai", config: { providers: {} } },
    ];
  const config = {
    ...(settings.auth === "dsh" ? {} : { apiKeyEnv }),
    ...(protocols.some((item) => item.id === (settings.api ?? entry.api))
      ? { api: settings.api ?? entry.api, baseURL: settings.baseURL ?? entry.baseURL }
      : {}),
    models: [
      {
        id: settings.model,
        ...(settings.supportsImages === undefined
          ? {}
          : { input: settings.supportsImages ? ["text", "image"] : ["text"] }),
      },
    ],
  };
  return [{ id: "llm-pi-ai", config: { providers: { [entry.id]: config } } }];
}
export function connectionFailure(status, body = "") {
  if (status === 402 || /quota|balance|credit|余额|额度|insufficient/i.test(body))
    return { code: "AI_QUOTA", message: "余额或额度不足，请到所选 AI 服务充值或检查用量限额。" };
  if (
    status === 401 ||
    status === 403 ||
    /invalid.api.key|authentication|INVALID_CREDENTIAL|MISSING_CREDENTIAL/i.test(body)
  )
    return { code: "AI_KEY", message: "Key 无效或没有访问权限，请在所选 AI 服务重新创建 API Key。" };
  if (status === 429)
    return { code: "AI_RATE_LIMIT", message: "请求过于频繁，请稍后重试或检查服务用量限制。" };
  if (status === 404 || /model.*(not.found|not.exist|unavailable|not.support)|UNKNOWN_MODEL/i.test(body))
    return { code: "AI_MODEL", message: "模型不可用，请换一个模型，并确认账号有权使用它。" };
  if (status === 0)
    return { code: "AI_NETWORK", message: "网络连不上 AI 服务，请检查网络、代理和 Base URL 后重试。" };
  return {
    code: "AI_CONNECTION",
    message: `AI 服务未完成验证（HTTP ${status}），请检查服务状态和连接参数后重试。`,
  };
}
export async function validateConnection(settings, apiKey) {
  const entry = providers.find((item) => item.id === settings.provider);
  if (!protocols.some((item) => item.id === (settings.api ?? entry.api)))
    return { code: "AI_AUTH", message: "请使用此服务的账号连接入口完成授权。" };
  const root = settings.baseURL ?? entry.baseURL;
  const api = settings.api ?? entry.api;
  const headers = { "Content-Type": "application/json" };
  let path = "/chat/completions";
  let body = { model: settings.model, messages: [{ role: "user", content: "Reply OK" }], max_tokens: 16 };
  if (api === "anthropic-messages") {
    path = messagesPath(root);
    headers["x-api-key"] = apiKey;
    headers["anthropic-version"] = "2023-06-01";
  } else if (api === "google-generative-ai") {
    path = `/models/${encodeURIComponent(settings.model)}:generateContent`;
    headers["x-goog-api-key"] = apiKey;
    body = { contents: [{ parts: [{ text: "Reply OK" }] }], generationConfig: { maxOutputTokens: 16 } };
  } else {
    headers.Authorization = `Bearer ${apiKey}`;
    if (api === "openai-responses") {
      path = "/responses";
      body = { model: settings.model, input: "Reply OK", max_output_tokens: 16 };
    }
  }
  try {
    const response = await fetch(`${root}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      redirect: "error",
      signal: AbortSignal.timeout(20000),
    });
    const raw = await response.text();
    if (!response.ok) return connectionFailure(response.status, raw);
    let result;
    try {
      result = JSON.parse(raw);
    } catch {
      return connectionFailure(502);
    }
    if (result.error) return connectionFailure(400, JSON.stringify(result.error));
    if (
      !result.choices?.length &&
      !result.output?.length &&
      !result.content?.length &&
      !result.candidates?.length
    )
      return connectionFailure(502);
    return { configured: true };
  } catch {
    return connectionFailure(0);
  }
}
