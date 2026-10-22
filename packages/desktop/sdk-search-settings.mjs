import { dirname, join } from "node:path";
import { providers } from "./sdk-providers.mjs";
export const searchProviders = [
  {
    id: "perplexity",
    name: "Perplexity",
    ref: "KAITU_SEARCH_PERPLEXITY_API_KEY",
    keyUrl: "https://www.perplexity.ai/settings/api",
  },
  { id: "exa", name: "Exa", ref: "KAITU_SEARCH_EXA_API_KEY", keyUrl: "https://dashboard.exa.ai/api-keys" },
];
/** 这几种协议有服务商自带、返回结构化来源的搜索；其他服务改用上面的搜索服务。 */
const NATIVE = ["anthropic-messages", "openai-responses", "google-generative-ai"];
export function nativeSearchInfo(settings = {}, configured = false) {
  const entry = providers.find((item) => item.id === settings.provider);
  const api = settings.api ?? entry?.api;
  const reason =
    settings.auth === "dsh"
      ? "此账号登录通道未提供独立搜索接口，可添加搜索服务。"
      : entry && !NATIVE.includes(api)
        ? `${entry.name} 没有可用的自带搜索，可添加搜索服务。`
        : undefined;
  const supported = !!entry && !reason;
  return {
    provider: entry?.id ?? null,
    name: entry?.name ?? "当前 AI 服务",
    api,
    supported,
    ...(reason ? { reason } : {}),
    configured: settings.choice === "builtin" && configured && supported,
  };
}
export function searchSettings(statuses, preferred, native = nativeSearchInfo()) {
  const available = (id) => statuses[id] === true;
  const fallback = available(preferred)
    ? preferred
    : (searchProviders.find((item) => available(item.id))?.id ?? null);
  const provider = native.configured ? native.provider : fallback;
  return {
    provider,
    configured: provider !== null,
    name: native.configured
      ? native.name
      : (searchProviders.find((item) => item.id === provider)?.name ?? null),
    native,
    preferred: searchProviders.some((item) => item.id === preferred) ? preferred : "perplexity",
    providers: searchProviders.map(({ ref: _ref, ...item }) => ({ ...item, configured: available(item.id) })),
  };
}
export function webRuntimePatch(hostPlugin) {
  const webPlugin = join(dirname(hostPlugin), "sdk-web.mjs");
  return [
    { id: "web", config: { searchProvider: "kaitu-search", fetchProvider: "kaitu-public-http" } },
    { id: "tool-web", disabled: false },
    { id: "web-fetch-http", disabled: false },
    { id: "web-search-deepseek", disabled: true },
    { insert: [{ id: "kaitu-sdk-web", name: webPlugin }] },
  ];
}
