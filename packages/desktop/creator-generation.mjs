import { Script } from "node:vm";
import { askText } from "../cli/dist/ui/project-ai.js";
import { KaituError } from "../core/dist/index.js";

const fail = (message) => {
  throw new KaituError(message, "CREATOR");
};
const summary = ({ id, revision, title, name }) => ({ id, revision, title, name });

/** Build an ordinary DSH bundle; model output never supplies Host code or installation paths. */
export function pageBundle(name, answer) {
  let value;
  try {
    value = JSON.parse(answer.replace(/^\s*```(?:json)?\s*/, "").replace(/\s*```\s*$/, ""));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
  } catch {
    fail("AI 返回的页面格式无效，请重新生成 / Invalid page JSON. Generate again.");
  }
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
let Page;
try { Page = (${value.code}); if (typeof Page !== 'function') throw new Error('Invalid page component'); }
catch (error) { Page = () => h('p', { role: 'alert' }, '页面无法打开，请在问问重新生成 / Page could not open. Regenerate in Ask.'); }
class PageBoundary extends React.Component {
constructor(props) { super(props); this.state = { failed: false }; }
static getDerivedStateFromError() { return { failed: true }; }
render() { return this.state.failed ? h('p', { role: 'alert' }, '页面无法打开，请在问问重新生成 / Page could not open. Regenerate in Ask.') : h(Page); }
}
return { inject: ['slots'], apply(ctx) {
ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: ${JSON.stringify(name)} }, PageBoundary));
} }; } });\n`;
  // Parse without evaluation. Neither Host nor Client candidate code executes during generation/review.
  try {
    new Script(client, { filename: "client.js" });
  } catch {
    fail("AI 返回的页面代码语法有误，请重新生成 / Invalid page code syntax. Generate again.");
  }
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
code is one plain JavaScript React function expression, no JSX, imports, eval, extra installed dependencies, parent-window access or Host code.
React, h=React.createElement and require(id) are in scope. require uses DSH's browser module loader: use its provided frontend modules, not Node.js modules, disk paths or uninstalled npm packages. Handle unavailable modules or APIs visibly. Runtime network requests and available Kaitu frontend APIs are allowed as requested.
Use React hooks for interaction. Inherit font and light/dark theme; use CSS variables with fallbacks. Keep controls and content accessible and responsive.
During generation, use only the user's request and previous page supplied below; do not read files, credentials, health or finance records or call tools. Do not invent personal records. Sample values must be visibly labelled. No installation. Do not claim success before user confirmation.
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
