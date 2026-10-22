import { ExaSearchProvider } from "@deepseek-ai/dsh-web-search-exa";
import { PerplexitySearchProvider } from "@deepseek-ai/dsh-web-search-perplexity";
import { KaituError, fetchPublicResource } from "../core/dist/index.js";
import { connectionFailure, credentialRef, messagesPath, providers } from "./sdk-providers.mjs";
import { nativeSearchInfo, searchProviders, searchSettings } from "./sdk-search-settings.mjs";

export async function searchNative(settings, apiKey, request, signal) {
  const entry = providers.find((item) => item.id === settings.provider);
  const api = settings.api ?? entry.api;
  const root = settings.baseURL ?? entry.baseURL;
  const headers = { "Content-Type": "application/json" };
  const prompt = `Search the web for: ${request.query}`;
  let endpoint;
  let body;
  if (api === "anthropic-messages") {
    endpoint = `${root}${messagesPath(root)}`;
    headers["x-api-key"] = apiKey;
    headers["anthropic-version"] = "2023-06-01";
    body = {
      model: settings.model,
      messages: [{ role: "user", content: prompt }],
      max_tokens: 1024,
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 1 }],
    };
  } else if (api === "openai-responses") {
    endpoint = `${root}/responses`;
    body = {
      model: settings.model,
      input: prompt,
      tools: [{ type: "web_search" }],
      tool_choice: "required",
      include: ["web_search_call.action.sources"],
      max_output_tokens: 1024,
    };
  } else {
    endpoint = `${root}/models/${encodeURIComponent(settings.model)}:generateContent`;
    headers["x-goog-api-key"] = apiKey;
    body = { contents: [{ parts: [{ text: prompt }] }], tools: [{ google_search: {} }] };
  }
  if (api !== "google-generative-ai") headers.Authorization = `Bearer ${apiKey}`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    redirect: "error",
    signal,
  });
  if (!response.ok) {
    const failure = connectionFailure(response.status, await response.text());
    throw new KaituError(failure.message.replace("验证", "搜索"), failure.code);
  }
  const payload = await response.json();
  let items;
  if (payload.error || payload.code)
    throw new KaituError("服务商未完成搜索，请检查账号权限和模型支持。", "AI_SEARCH");
  if (api === "anthropic-messages") {
    const blocks = payload.content?.filter((item) => item.type === "web_search_tool_result");
    if (blocks?.some((block) => !Array.isArray(block.content)))
      throw new KaituError("服务商的搜索工具未完成，请稍后重试或检查搜索权限。", "AI_SEARCH");
    const citations =
      payload.content?.flatMap((block) => (block.type === "text" ? (block.citations ?? []) : [])) ?? [];
    items = blocks
      ?.flatMap((block) => block.content.filter((item) => item.type === "web_search_result"))
      .map((item) => ({
        ...item,
        snippet: citations.find((cite) => cite.url === item.url)?.cited_text,
        publishedAt: item.page_age,
      }));
  } else if (api === "openai-responses") {
    items = payload.output?.flatMap((item) =>
      item.type === "web_search_call"
        ? (item.action?.sources ?? [])
        : item.type === "message"
          ? (item.content ?? []).flatMap((part) =>
              (part.annotations ?? []).filter((a) => a.type === "url_citation"),
            )
          : [],
    );
  } else {
    items = payload.candidates
      ?.flatMap((item) => item.groundingMetadata?.groundingChunks ?? [])
      .filter((chunk) => chunk.web)
      .map((chunk) => ({ url: chunk.web.uri, title: chunk.web.title }));
  }
  if (!Array.isArray(items) || items.length === 0)
    throw new KaituError(
      "这个服务或模型没有返回结构化搜索来源。请检查服务端搜索支持，或到「AI 与连接 → 网络搜索」配置 Perplexity 或 Exa。",
      "AI_SEARCH_UNSUPPORTED",
    );
  const sources = [];
  const seen = new Set();
  for (const item of items) {
    if (typeof item?.url !== "string" || !/^https?:\/\//i.test(item.url) || seen.has(item.url)) continue;
    seen.add(item.url);
    sources.push({
      url: item.url,
      ...Object.fromEntries(
        ["title", "snippet", "publishedAt"]
          .filter((key) => typeof item[key] === "string")
          .map((key) => [key, item[key]]),
      ),
    });
  }
  if (!sources.length) throw new KaituError("服务商没有返回可用的搜索来源，请换一个查询词。", "AI_SEARCH");
  const limit = request.maxResults ?? 8;
  return { sources: sources.slice(0, limit), truncated: sources.length > limit };
}
export function createSearchRouter({ resolve, preferred, current, endpoints = {} }) {
  return {
    id: "kaitu-search",
    available: () => true,
    async search(request, signal) {
      try {
        const settings = await current();
        const native = nativeSearchInfo(settings);
        const key =
          native.supported && settings.choice === "builtin"
            ? await resolve(credentialRef(settings.provider))
            : undefined;
        const bounded = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(30000)]);
        let nativeError;
        if (key) {
          try {
            return await searchNative(settings, key, request, bounded);
          } catch (error) {
            if (signal?.aborted) throw error;
            nativeError = error;
          }
        }
        const keys = Object.fromEntries(
          await Promise.all(searchProviders.map(async ({ id, ref }) => [id, await resolve(ref)])),
        );
        const selected = searchSettings(
          Object.fromEntries(Object.entries(keys).map(([id, value]) => [id, !!value])),
          preferred,
        ).provider;
        if (!selected && nativeError) throw nativeError;
        if (!selected)
          throw new KaituError(
            "请先到「问问 → 连接 AI」连接支持搜索的服务，或在「AI 与连接 → 网络搜索」添加 Perplexity 或 Exa 的 Key。",
            "AI_SEARCH_KEY",
          );
        const backend =
          selected === "exa"
            ? new ExaSearchProvider({
                apiKey: keys[selected],
                baseURL: endpoints.exa ?? "https://api.exa.ai",
                searchType: "auto",
                highlightsPerResult: 1,
              })
            : new PerplexitySearchProvider({
                apiKey: keys[selected],
                baseURL: endpoints.perplexity ?? "https://api.perplexity.ai",
                model: "sonar",
                maxTokens: 1024,
              });
        const result = await backend.search(request, bounded);
        return { sources: result.sources, truncated: result.truncated };
      } catch (error) {
        if (error instanceof KaituError) throw error;
        if (signal?.aborted) throw new KaituError("搜索已取消", "WEB_ABORTED");
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
