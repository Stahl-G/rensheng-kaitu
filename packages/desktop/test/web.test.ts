import { createServer } from "node:http";
import { fetchPublicResource } from "@kaitu/core";
import { expect, test } from "vitest";
// @ts-expect-error Desktop adapters are native ESM.
import { createPublicFetch, createSearchRouter, searchNative } from "../sdk-web-providers.mjs";

test("web reading pins public destinations and rejects local addresses at every redirect", async () => {
  const calls: { host: string; address: string }[] = [];
  let redirect: string | undefined;
  let answers = [{ address: "93.184.216.34", family: 4 }];
  const transport = {
    lookup: async (host: string) => (host === "localhost" ? [{ address: "127.0.0.1", family: 4 }] : answers),
    request: async (url: URL, address: { address: string }) => {
      calls.push({ host: url.hostname, address: address.address });
      const location = redirect;
      redirect = undefined;
      return {
        status: location ? 302 : 200,
        location,
        contentType: "text/html; charset=utf-8",
        body: (async function* () {
          yield Buffer.from("<p>synthetic public page</p>");
        })(),
        close() {},
      };
    },
  };
  const provider = createPublicFetch((url: string, options: Parameters<typeof fetchPublicResource>[1]) =>
    fetchPublicResource(url, options, transport),
  );
  for (const url of [
    "file:///etc/passwd",
    "ftp://public.example/a",
    "http://localhost/a",
    "http://127.0.0.1/a",
    "http://2130706433/a",
    "http://10.1.2.3/a",
    "http://192.168.1.2/a",
    "http://169.254.169.254/a",
    "http://[::1]/a",
    "http://[::ffff:127.0.0.1]/a",
  ])
    await expect(provider.fetch({ url })).rejects.toThrow();
  expect(calls).toHaveLength(0);
  const result = await provider.fetch({ url: "https://public.example/a" });
  expect(result.body).toEqual({ kind: "html", content: "<p>synthetic public page</p>" });
  expect(calls).toEqual([{ host: "public.example", address: answers[0].address }]);
  redirect = "http://localhost/private";
  await expect(provider.fetch({ url: "https://public.example/redirect" })).rejects.toThrow();
  expect(calls).toHaveLength(2);
  answers = [...answers, { address: "10.0.0.2", family: 4 }];
  await expect(provider.fetch({ url: "https://public.example/mixed-dns" })).rejects.toThrow();
  expect(calls).toHaveLength(2);
});

test("search prefers the current chat service then configured specialist services and prompts without credentials", async () => {
  const requests: { url: string; auth?: string; body: Record<string, unknown> }[] = [];
  let fail = false;
  const key = "synthetic-search-secret";
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const part of req) raw += part;
    requests.push({ url: req.url ?? "", auth: req.headers.authorization, body: JSON.parse(raw) });
    res.writeHead(fail ? 401 : 200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify(
        fail
          ? { error: { message: key } }
          : req.url === "/responses"
            ? {
                output: [
                  {
                    type: "web_search_call",
                    action: { sources: [{ url: "https://source.example/native" }] },
                  },
                ],
              }
            : req.url === "/search"
              ? { results: [{ url: "https://source.example/exa", highlights: ["synthetic source"] }] }
              : {
                  choices: [{ message: { content: "synthetic answer" } }],
                  citations: ["https://source.example/perplexity"],
                },
      ),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const keys = new Map<string, string>();
  let settings = {
    choice: "builtin",
    provider: "openrouter",
    model: "local-model",
    baseURL: url,
    api: "openai-responses",
  };
  const router = createSearchRouter({
    preferred: "exa",
    resolve: async (ref: string) => keys.get(ref),
    endpoints: { exa: url, perplexity: url },
    current: () => settings,
  });
  try {
    await expect(router.search({ query: "public topic" })).rejects.toMatchObject({ code: "AI_SEARCH_KEY" });
    expect(requests).toHaveLength(0);
    keys.set("KAITU_SEARCH_PERPLEXITY_API_KEY", key);
    const perplexity = await router.search({ query: "public topic" });
    expect(perplexity.sources[0].url).toBe("https://source.example/perplexity");
    keys.set("KAITU_SEARCH_EXA_API_KEY", key);
    const exa = await router.search({ query: "another public topic" });
    expect(exa.sources[0].url).toBe("https://source.example/exa");
    expect(requests.map((request) => request.url)).toEqual(["/chat/completions", "/search"]);
    expect(requests.every((request) => request.auth === `Bearer ${key}`)).toBe(true);
    expect(JSON.stringify({ perplexity, exa })).not.toContain(key);
    keys.set("DEEPSEEK_API_KEY", "unused-deepseek-key");
    settings = { ...settings, provider: "kaitu-custom" };
    keys.set("KAITU_KAITU_CUSTOM_API_KEY", key);
    const native = await router.search({ query: "public topic" });
    expect(native.sources[0].url).toBe("https://source.example/native");
    expect(requests.at(-1)?.url).toBe("/responses");
    expect(requests).toHaveLength(3);
    fail = true;
    await expect(router.search({ query: "public topic" })).rejects.toMatchObject({ code: "AI_KEY" });
    expect(requests).toHaveLength(4);
    keys.delete("KAITU_KAITU_CUSTOM_API_KEY");
    const error = await router.search({ query: "public topic" }).catch((value: Error) => value);
    expect(error.code).toBe("AI_KEY");
    expect(error.message).not.toContain(key);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("native search sends protocol-specific requests and returns only structured sources", async () => {
  const source = { url: "https://source.example/result", title: "Synthetic title" };
  const received: { url: string; headers: Record<string, unknown>; body: Record<string, unknown> }[] = [];
  let response: object = {};
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const part of req) raw += part;
    received.push({ url: req.url ?? "", headers: req.headers, body: JSON.parse(raw) });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(response));
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const root = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  // @ts-expect-error Desktop adapters are native ESM.
  const { validateConnection, selection, providerPatch } = await import("../sdk-providers.mjs");
  const cases = [
    {
      api: "anthropic-messages",
      path: "/v1/messages",
      payload: {
        content: [
          { type: "web_search_tool_result", content: [{ type: "web_search_result", ...source }] },
          {
            type: "text",
            text: "https://invented.example",
            citations: [{ ...source, cited_text: "Excerpt" }],
          },
        ],
      },
      check: (body: Record<string, unknown>) =>
        expect(body.tools).toMatchObject([{ type: "web_search_20250305", name: "web_search" }]),
    },
    {
      api: "openai-responses",
      path: "/responses",
      payload: {
        output: [
          { type: "web_search_call", action: { sources: [source] } },
          {
            type: "message",
            content: [
              { text: "https://invented.example", annotations: [{ type: "url_citation", ...source }] },
            ],
          },
        ],
      },
      check: (body: Record<string, unknown>) => {
        expect(body.tools).toEqual([{ type: "web_search" }]);
        expect(body.include).toEqual(["web_search_call.action.sources"]);
      },
    },
    {
      api: "google-generative-ai",
      path: "/models/local-model:generateContent",
      payload: {
        candidates: [
          {
            content: { parts: [{ text: "https://invented.example" }] },
            groundingMetadata: { groundingChunks: [{ web: { uri: source.url, title: source.title } }] },
          },
        ],
      },
      check: (body: Record<string, unknown>) => expect(body.tools).toEqual([{ google_search: {} }]),
    },
    {
      api: "openai-completions",
      path: "/chat/completions",
      payload: {
        choices: [
          {
            message: {
              content: "https://invented.example",
              annotations: [{ type: "url_citation", url_citation: source }],
            },
          },
        ],
      },
      check: (body: Record<string, unknown>) => expect(body.web_search_options).toEqual({}),
    },
  ];
  try {
    for (const item of cases) {
      response = item.payload;
      const settings = selection({
        provider: "kaitu-custom",
        model: "local-model",
        baseURL: root,
        api: item.api,
      });
      const result = await searchNative(settings, "fake-key", { query: "public query" });
      expect(result.sources).toHaveLength(1);
      expect(result.sources[0]).toMatchObject(source);
      expect(JSON.stringify(result)).not.toContain("invented.example");
      const call = received.at(-1);
      expect(call?.url).toBe(item.path);
      item.check(call?.body);
      expect(
        call?.headers[
          item.api === "google-generative-ai"
            ? "x-goog-api-key"
            : item.api === "anthropic-messages"
              ? "x-api-key"
              : "authorization"
        ],
      ).toBe(item.api.startsWith("openai") ? "Bearer fake-key" : "fake-key");
      expect(providerPatch(settings)[0].config.providers["kaitu-custom"].api).toBe(item.api);
      const validation = await validateConnection(settings, "fake-key");
      expect(validation.configured).toBe(true);
      expect(received.at(-1)?.url).toBe(item.path);
      response = { choices: [{ message: { content: source.url } }] };
      await expect(searchNative(settings, "fake-key", { query: "public query" })).rejects.toMatchObject({
        code: "AI_SEARCH_UNSUPPORTED",
      });
    }
    for (const item of [
      {
        provider: "moonshotai-cn",
        path: "/tools/search",
        payload: { search_results: [source] },
        expected: { text_query: "public query", include_content: false, limit: 8 },
      },
      {
        provider: "kaitu-zhipu",
        path: "/web_search",
        payload: { search_result: [{ link: source.url, title: source.title }] },
        expected: { search_engine: "search_std", search_query: "public query", count: 8 },
      },
      {
        provider: "kaitu-qwen",
        path: "/api/v1/services/aigc/text-generation/generation",
        payload: { output: { search_info: { search_results: [source] } } },
        expected: {
          input: { messages: [{ role: "user", content: "Search the web for: public query" }] },
          parameters: { enable_search: true, search_options: { forced_search: true, enable_source: true } },
        },
      },
    ]) {
      response = item.payload;
      const result = await searchNative(
        { provider: item.provider, model: "local-model", baseURL: root },
        "fake-key",
        { query: "public query" },
      );
      expect(result.sources).toEqual([source]);
      expect(received.at(-1)?.url).toBe(item.path);
      expect(received.at(-1)?.body).toMatchObject(item.expected);
    }
    response = {
      content: [
        {
          type: "web_search_tool_result",
          content: { type: "web_search_tool_result_error", error_code: "unavailable" },
        },
      ],
    };
    await expect(
      searchNative({ provider: "anthropic", model: "local-model", baseURL: root }, "fake-key", {
        query: "public query",
      }),
    ).rejects.toMatchObject({ code: "AI_SEARCH" });
  } finally {
    await new Promise<void>((done) => server.close(() => done()));
  }
});
