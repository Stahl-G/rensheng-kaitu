import { Script } from "node:vm";
import { askText } from "../cli/dist/ui/project-ai.js";
import { KaituError } from "../core/dist/index.js";

const fail = (message) => {
  throw new KaituError(message, "CREATOR");
};
const summary = ({ id, revision, title, name }) => ({ id, revision, title, name });

/** Build an ordinary DSH bundle; model output never supplies Host code or installation paths. */
export function pageBundle(name, answer) {
  const value = JSON.parse(answer.replace(/^\s*```(?:json)?\s*/, "").replace(/\s*```\s*$/, ""));
  for (const [key, limit] of [
    ["title", 80],
    ["description", 400],
    ["code", 65536],
    ["icon", 2000],
  ])
    if (typeof value[key] !== "string" || !value[key].trim() || value[key].length > limit)
      fail("页面生成结果不完整，请修改需求后重试 / Incomplete page. Revise your request and retry.");
  if (!/^[MmLlHhVvCcSsQqTtAaZz0-9.,+\-\s]+$/.test(value.icon))
    fail("页面图标无效，请重新生成 / Invalid icon. Generate again.");
  const client = `window.__ModuleLoader__.load({ id: ${JSON.stringify(name)}, factory(require) {
const React = require('react'); const h = React.createElement;
const Page = (${value.code});
return { inject: ['slots'], apply(ctx) {
ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: ${JSON.stringify(name)} }, Page));
} }; } });\n`;
  // Parse without evaluation. Neither Host nor Client candidate code executes during generation/review.
  new Script(client, { filename: "client.js" });
  const meta = JSON.stringify({ meta: { title: value.title, description: value.description } });
  return {
    "package.json": JSON.stringify({
      name,
      version: "0.0.0",
      private: true,
      type: "module",
      description: value.description,
      exports: {
        ".": "./index.js",
        "./client": "./client.js",
        "./icon": "./icon.svg",
        "./locale/*.json": "./locale/*.json",
      },
      dsh: {
        bundle: { patch: "./cordis.patch.yml" },
        client: { platform: "web", immediately: true, inject: ["@deepseek-ai/dsh-client-ui-layout"] },
      },
      kaitu: {
        explore: { title: value.title, description: value.description, icon: value.icon, page: name },
      },
    }),
    "cordis.patch.yml": `- insert:\n    - id: ${name}\n      name: ${name}\n`,
    "index.js": "export function apply() {}\n",
    "client.js": client,
    "locale/en.json": meta,
    "locale/zh.json": meta,
    "icon.svg": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="currentColor" d="${value.icon}"/></svg>`,
  };
}

/** One background generation task. Its completion includes closing the text-only runtime. */
export function createPageGenerator({ creator, ask, onChanged = () => {} }) {
  let pending;
  let job = { status: "idle" };
  return {
    status: () => job,
    settled: () => pending ?? Promise.resolve(),
    start({ prompt, id, revision }) {
      if (pending) fail("页面仍在生成，请等完成 / Page generation is still running.");
      if (typeof prompt !== "string" || !prompt.trim() || prompt.length > 12000)
        fail("请输入页面需求（最多 12000 字）/ Enter a page request (up to 12000 characters).");
      const previous = id ? creator.inspect(id, revision) : undefined;
      const identity = previous ?? creator.identity();
      job = { status: "generating" };
      onChanged();
      pending = (async () => {
        try {
          const settings = await ask.settings();
          if (!settings.configured || settings.backend !== "dsh")
            fail("创建页面需要连接内置 AI / Connect built-in AI to create pages.");
          const service = ask.background(undefined, { textOnly: true });
          let answer;
          try {
            answer = await askText(
              service,
              `Create a self-contained personal React page for Kaitu. Return only JSON:
{"title":"short title","description":"what this page adds","icon":"original SVG path in a 24x24 viewBox","code":"function Page() { ... }"}.
code is one plain JavaScript React function expression, no JSX, imports, require, eval, external dependencies, network, parent-window access or Host code.
React and h=React.createElement are in scope. Use React hooks for interaction. Inherit font and light/dark theme; use CSS variables with fallbacks. Keep controls and content accessible and responsive.
Use only the user's request and previous page supplied below. Do not invent personal records or access health, finance, credentials or files. Sample values must be visibly labelled. No tools. No installation. Do not claim success before user confirmation.
<request>${JSON.stringify(prompt.trim())}</request>
<previous>${JSON.stringify(previous?.files["client.js"] ?? null)}</previous>`,
              {
                timeout: "页面生成超时，请重试 / Page generation timed out. Retry.",
                empty: "AI 未返回页面，请重试 / No page returned. Retry.",
              },
            );
          } finally {
            // Do not mark ready or permit installation while the generation process is still closing.
            await service.close();
          }
          const draft = creator.stage(pageBundle(identity.name, answer));
          job = { status: "ready", draft: summary(draft) };
        } catch (error) {
          job = { status: "failed", error: String(error.message ?? error) };
        } finally {
          pending = undefined;
          onChanged();
        }
      })();
      return job;
    },
  };
}
