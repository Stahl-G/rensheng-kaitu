import { createServer } from "node:http";
import { fetchPublicResource } from "@kaitu/core";
import { expect, test } from "vitest";
// @ts-expect-error Desktop adapters are native ESM.
import { createPublicFetch, createSearchRouter } from "../sdk-web-providers.mjs";

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

test("search uses available credentials independently of chat models and reports missing keys without leaking them", async () => {
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
  let deepseekCalls = 0;
  const router = createSearchRouter({
    preferred: "exa",
    resolve: async (ref: string) => keys.get(ref),
    endpoints: { exa: url, perplexity: url },
    deepseek: () => ({
      search: async () => {
        deepseekCalls++;
        return { sources: [], truncated: false };
      },
    }),
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
    keys.set("DEEPSEEK_API_KEY", "synthetic-deepseek");
    await router.search({ query: "public topic" });
    expect(deepseekCalls).toBe(1);
    expect(requests).toHaveLength(2);
    keys.delete("DEEPSEEK_API_KEY");
    fail = true;
    const error = await router.search({ query: "public topic" }).catch((value: Error) => value);
    expect(error.code).toBe("AI_KEY");
    expect(error.message).not.toContain(key);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
