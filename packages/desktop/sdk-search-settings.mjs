import { dirname, join } from "node:path";
export const searchProviders = [
  {
    id: "deepseek",
    name: "DeepSeek",
    ref: "DEEPSEEK_API_KEY",
    keyUrl: "https://platform.deepseek.com/api_keys",
  },
  {
    id: "perplexity",
    name: "Perplexity",
    ref: "KAITU_SEARCH_PERPLEXITY_API_KEY",
    keyUrl: "https://www.perplexity.ai/settings/api",
  },
  { id: "exa", name: "Exa", ref: "KAITU_SEARCH_EXA_API_KEY", keyUrl: "https://dashboard.exa.ai/api-keys" },
];
export function searchSettings(statuses, preferred) {
  const available = (id) => statuses[id] === true;
  const provider = available("deepseek")
    ? "deepseek"
    : available(preferred)
      ? preferred
      : (searchProviders.find((item) => available(item.id))?.id ?? null);
  return {
    provider,
    configured: provider !== null,
    name: searchProviders.find((item) => item.id === provider)?.name ?? null,
    preferred: preferred ?? "perplexity",
    providers: searchProviders.map(({ ref: _ref, ...item }) => ({ ...item, configured: available(item.id) })),
  };
}
export function webRuntimePatch(hostPlugin) {
  const webPlugin = join(dirname(hostPlugin), "sdk-web.mjs");
  return [
    { id: "web", config: { searchProvider: "kaitu-search", fetchProvider: "kaitu-public-http" } },
    { id: "tool-web", disabled: false },
    { id: "web-fetch-http", disabled: false },
    { id: "web-search-deepseek", disabled: false, config: { apiKeyEnv: "DEEPSEEK_API_KEY" } },
    { insert: [{ id: "kaitu-sdk-web", name: webPlugin }] },
  ];
}
