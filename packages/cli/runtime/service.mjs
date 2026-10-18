import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createSdkRuntime } from "../../desktop/sdk-runtime.mjs";
import { createAgentConnection } from "../dist/local-agents/connection.js";
import { createAskService } from "../dist/ui/ask.js";

export function createWebAsk(ws, state) {
  const directory = dirname(fileURLToPath(import.meta.url));
  const modules = resolve(directory, "../../node_modules");
  const makeSdk = () =>
    createSdkRuntime({
      executable: process.execPath,
      modules,
      entry: createRequire(import.meta.url).resolve("@deepseek-ai/dsh/lib/bin.js"),
      home: state,
      workspace: ws.root,
      plugin: join(directory, "sdk-plugin.mjs"),
      hostPlugin: join(directory, "sdk-host.mjs"),
      helper: join(directory, "sdk-credentials.mjs"),
    });
  let sdkRoot = ws.root;
  let current = makeSdk();
  const sdk = () => {
    if (sdkRoot !== ws.root) {
      void current.closeSupport();
      sdkRoot = ws.root;
      current = makeSdk();
    }
    return current;
  };
  const connection = createAgentConnection({
    state,
    workspace: () => ws.root,
    sdk,
    mcp: { command: process.execPath, args: [join(directory, "mcp-stdio.mjs"), ws.root] },
  });
  return createAskService({
    state,
    workspace: ws.root,
    runtime: (mode) => connection.runtime(mode),
    settings: () => connection.settings(),
    // 本机 Agent 的模型列表走 ACP；内置服务商仍由 connection 转给 SDK。
    models: (input) => connection.models(input),
    configure: (input) => connection.configure(input),
    support: (method, input) => connection.support(method, input),
    dispose: () => current.closeSupport(),
  });
}
