import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { selection } from "./sdk-providers.mjs";
import { createPublicFetch, createSearchRouter } from "./sdk-web-providers.mjs";
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
      current: () => {
        const file = join(process.env.DSH_HOME, "kaitu-ai.json");
        const stored = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
        return { choice: stored.choice, ...selection(stored) };
      },
    }),
  );
}
