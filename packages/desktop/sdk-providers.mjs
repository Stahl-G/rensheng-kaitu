export const providers = [
  {
    id: "deepseek-official",
    name: "DeepSeek",
    recommended: true,
    api: "anthropic-messages",
    baseURL: "https://api.deepseek.com/anthropic",
    keyUrl: "https://platform.deepseek.com/api_keys",
    models: [
      { id: "deepseek-flash", image: true },
      { id: "deepseek-v4-pro", image: false },
    ],
  },
  {
    id: "openai",
    name: "OpenAI",
    api: "openai-responses",
    baseURL: "https://api.openai.com/v1",
    keyUrl: "https://platform.openai.com/api-keys",
    models: [
      { id: "gpt-4.1-mini", image: true },
      { id: "gpt-4.1", image: true },
    ],
  },
  {
    id: "anthropic",
    name: "Anthropic Claude",
    api: "anthropic-messages",
    baseURL: "https://api.anthropic.com",
    keyUrl: "https://console.anthropic.com/settings/keys",
    models: [
      { id: "claude-sonnet-4-5", image: true },
      { id: "claude-haiku-4-5", image: true },
    ],
  },
  {
    id: "google",
    name: "Google Gemini",
    api: "google-generative-ai",
    baseURL: "https://generativelanguage.googleapis.com/v1beta",
    keyUrl: "https://aistudio.google.com/apikey",
    models: [
      { id: "gemini-2.5-flash", image: true },
      { id: "gemini-2.5-pro", image: true },
    ],
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    api: "openai-completions",
    baseURL: "https://openrouter.ai/api/v1",
    keyUrl: "https://openrouter.ai/keys",
    models: [
      { id: "openai/gpt-4.1-mini", image: true },
      { id: "moonshotai/kimi-k2", image: false },
    ],
  },
  {
    id: "moonshotai-cn",
    name: "Kimi",
    api: "openai-completions",
    baseURL: "https://api.moonshot.cn/v1",
    keyUrl: "https://platform.kimi.com/console/api-keys",
    models: [
      { id: "kimi-k2.6", image: true },
      { id: "kimi-k2.7-code", image: true },
    ],
  },
  {
    id: "kaitu-zhipu",
    name: "智谱",
    api: "openai-completions",
    baseURL: "https://open.bigmodel.cn/api/paas/v4",
    keyUrl: "https://bigmodel.cn/usercenter/proj-mgmt/apikeys",
    models: [
      { id: "glm-4.7", image: false },
      { id: "glm-4.6v", image: true },
    ],
  },
  {
    id: "kaitu-qwen",
    name: "通义千问",
    api: "openai-completions",
    baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    keyUrl: "https://bailian.console.aliyun.com/",
    models: [
      { id: "qwen-plus", image: false },
      { id: "qwen-vl-plus", image: true },
    ],
  },
  { id: "kaitu-custom", name: "自定义（OpenAI 兼容）", api: "openai-completions", models: [] },
];
export function credentialRef(provider) {
  return provider === "deepseek-official"
    ? "DEEPSEEK_API_KEY"
    : `KAITU_${provider.replaceAll("-", "_").toUpperCase()}_API_KEY`;
}
export function selection(input, previous = {}) {
  const provider = input.provider ?? previous.provider ?? providers[0].id;
  const entry = providers.find((item) => item.id === provider);
  if (!entry) throw new Error("请选择支持的 AI 服务");
  const model =
    input.model ?? (previous.provider === provider ? previous.model : undefined) ?? entry.models[0]?.id;
  if (typeof model !== "string" || !/^[\w./:@+-]{1,180}$/.test(model)) throw new Error("请输入有效的模型 ID");
  if (provider !== "kaitu-custom" && !entry.models.some((item) => item.id === model))
    throw new Error("请选择列表中的模型");
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
  return { provider, model, ...(provider === "kaitu-custom" ? { baseURL } : {}) };
}
export function connectionInfo(settings) {
  const entry = providers.find((item) => item.id === settings.provider) ?? providers[0];
  return {
    ...settings,
    providerName: entry.name,
    supportsImages: entry.models.find((item) => item.id === settings.model)?.image ?? false,
    providers,
  };
}
export function providerPatch(settings) {
  const entry = providers.find((item) => item.id === settings.provider) ?? providers[0];
  const apiKeyEnv = credentialRef(entry.id);
  if (entry.id === "deepseek-official")
    return [
      { id: "llm-deepseek", config: { apiKeyEnv } },
      { id: "llm-pi-ai", config: { providers: {} } },
    ];
  const declared = entry.id.startsWith("kaitu-");
  const config = {
    apiKeyEnv,
    ...(declared
      ? {
          api: entry.api,
          baseURL: settings.baseURL ?? entry.baseURL,
          models: [
            {
              id: settings.model,
              input: connectionInfo(settings).supportsImages ? ["text", "image"] : ["text"],
            },
          ],
        }
      : { models: [{ id: settings.model }] }),
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
  const root = settings.baseURL ?? entry.baseURL;
  const headers = { "Content-Type": "application/json" };
  let path = "/chat/completions";
  let body = { model: settings.model, messages: [{ role: "user", content: "Reply OK" }], max_tokens: 16 };
  if (entry.api === "anthropic-messages") {
    path = "/v1/messages";
    headers["x-api-key"] = apiKey;
    headers["anthropic-version"] = "2023-06-01";
  } else if (entry.api === "google-generative-ai") {
    path = `/models/${encodeURIComponent(settings.model)}:generateContent`;
    headers["x-goog-api-key"] = apiKey;
    body = { contents: [{ parts: [{ text: "Reply OK" }] }], generationConfig: { maxOutputTokens: 16 } };
  } else {
    headers.Authorization = `Bearer ${apiKey}`;
    if (entry.api === "openai-responses") {
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
