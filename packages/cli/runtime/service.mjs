import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createSdkRuntime } from "../../desktop/sdk-runtime.mjs";
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
  return createAskService({
    state,
    workspace: ws.root,
    runtime: (mode) => sdk().runtime(mode),
    settings: () => sdk().settings(),
    models: (input) => sdk().models(input),
    configure: (input) => sdk().configure(input),
    support: (method, input) => sdk().support(method, input),
    dispose: () => current.closeSupport(),
  });
}
