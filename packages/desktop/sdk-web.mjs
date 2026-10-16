import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createPublicFetch, createSearchRouter } from "./sdk-web-providers.mjs";
const {
  DeepSeekSearchProvider,
  DEEPSEEK_DEFAULT_BASE_URL,
  DEEPSEEK_DEFAULT_MODEL,
  DEEPSEEK_DEFAULT_API_VERSION,
  DEEPSEEK_DEFAULT_MAX_TOKENS,
  DEEPSEEK_DEFAULT_MAX_USES,
} = await import(
  pathToFileURL(join(process.env.KAITU_DSH_MODULES, "@deepseek-ai/dsh-web-search-deepseek/lib/index.js")).href
);
export const name = "kaitu-sdk-web";
export const inject = ["web", "credentials"];
export function apply(ctx) {
  const path = join(process.env.DSH_HOME, "kaitu-search.json");
  const preferred = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")).provider : undefined;
  ctx.web.registerFetchProvider(createPublicFetch());
  ctx.web.registerSearchProvider(
    createSearchRouter({
      preferred,
      resolve: async (ref) => (await ctx.credentials.resolve(ref))?.value,
      deepseek: (apiKey) =>
        new DeepSeekSearchProvider(() => ({
          resolveApiKey: async () => apiKey,
          apiKeyEnv: "DEEPSEEK_API_KEY",
          baseURL: DEEPSEEK_DEFAULT_BASE_URL,
          model: DEEPSEEK_DEFAULT_MODEL,
          apiVersion: DEEPSEEK_DEFAULT_API_VERSION,
          maxTokens: DEEPSEEK_DEFAULT_MAX_TOKENS,
          maxUses: DEEPSEEK_DEFAULT_MAX_USES,
        })),
    }),
  );
}
