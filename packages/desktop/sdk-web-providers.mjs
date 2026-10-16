import { ExaSearchProvider } from "@deepseek-ai/dsh-web-search-exa";
import { PerplexitySearchProvider } from "@deepseek-ai/dsh-web-search-perplexity";
import { KaituError, fetchPublicResource } from "../core/dist/index.js";
import { connectionFailure } from "./sdk-providers.mjs";
import { searchProviders, searchSettings } from "./sdk-search-settings.mjs";

export function createSearchRouter({ resolve, preferred, deepseek, endpoints = {} }) {
  return {
    id: "kaitu-search",
    available: () => true,
    async search(request, signal) {
      const keys = Object.fromEntries(
        await Promise.all(searchProviders.map(async ({ id, ref }) => [id, await resolve(ref)])),
      );
      const selected = searchSettings(
        Object.fromEntries(Object.entries(keys).map(([id, key]) => [id, !!key])),
        preferred,
      ).provider;
      if (!selected)
        throw new KaituError(
          "还没有网络搜索 Key，请到「AI 与连接 → 网络搜索」添加 DeepSeek、Perplexity 或 Exa 的 Key。",
          "AI_SEARCH_KEY",
        );
      const key = keys[selected];
      const backend =
        selected === "deepseek"
          ? deepseek(key)
          : selected === "exa"
            ? new ExaSearchProvider({
                apiKey: key,
                baseURL: endpoints.exa ?? "https://api.exa.ai",
                searchType: "auto",
                highlightsPerResult: 1,
              })
            : new PerplexitySearchProvider({
                apiKey: key,
                baseURL: endpoints.perplexity ?? "https://api.perplexity.ai",
                model: "sonar",
                maxTokens: 1024,
              });
      try {
        return await backend.search(
          request,
          AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(30000)]),
        );
      } catch (error) {
        const detail = `${error.code ?? ""} ${error.message ?? ""}`;
        const status = Number(
          detail.match(/\b(401|402|403|404|429|5\d\d)\b/)?.[1] ??
            (/fetch failed|network|ECONN|ENOTFOUND|timeout|aborted/i.test(detail) ? 0 : 502),
        );
        const failure = connectionFailure(status, detail);
        throw new KaituError(failure.message.replace("验证", "搜索"), failure.code);
      }
    },
  };
}
export function createPublicFetch(fetcher = fetchPublicResource) {
  return {
    id: "kaitu-public-http",
    available: () => true,
    async fetch({ url }, signal) {
      try {
        const response = await fetcher(url, { signal, maxBytes: 5 * 1024 * 1024 });
        const type = response.contentType ?? "text/plain";
        if (!/^(?:text\/|application\/(?:json|xml|xhtml\+xml|[^;]+\+json))/i.test(type))
          throw new KaituError("这个网址不是可读取的网页或文字内容", "AI_WEB");
        const charset = /charset\s*=\s*["']?([^;\s"']+)/i.exec(type)?.[1] ?? "utf-8";
        const content = new TextDecoder(charset).decode(response.data);
        return {
          url: response.url,
          statusCode: response.statusCode,
          body: { kind: /html/i.test(type) ? "html" : "text", content: content.slice(0, 100000) },
          truncated: content.length > 100000,
        };
      } catch (error) {
        if (error instanceof KaituError) throw new KaituError(error.message, "AI_WEB");
        throw new KaituError("网页连接失败，请检查网址和网络后重试", "AI_NETWORK");
      }
    },
  };
}
