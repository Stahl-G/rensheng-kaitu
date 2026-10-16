import { join } from "node:path";
import { pathToFileURL } from "node:url";

const load = (name) => import(pathToFileURL(join(process.env.KAITU_DSH_MODULES, name, "lib/index.js")).href);
const [{ JsonRpcLineTransport }, { HarnessSdkJsonRpcServer }, { createUserMessage }] = await Promise.all([
  load("@deepseek-ai/dsh-sdk-protocol"),
  load("@deepseek-ai/dsh-sdk-jsonrpc-server"),
  load("@deepseek-ai/dsh-llm"),
]);
export const name = "kaitu-sdk-rpc";
export const inject = ["sdkAppStartup", "loader", "agents", "sessionPersistence", "kaitu", "fs"];
export function apply(ctx) {
  const transport = new JsonRpcLineTransport(process.stdin, process.stdout);
  const sdk = new HarnessSdkJsonRpcServer(ctx, transport);
  const fresh = new Set();
  const resumed = new Map();
  let route;
  let shutdown;
  const close = () => {
    shutdown ??= (async () => {
      await Promise.all([...resumed.values()].map((handle) => handle.dispose()));
      await sdk.shutdown();
    })();
    return shutdown;
  };
  transport.onRequest(async (method, params) => {
    if (method === "initialize") {
      await ctx.loader.await();
      if (params.cwd !== process.env.KAITU_DIR) throw new Error("工作区不匹配");
      const result = await sdk.initialize(params);
      route = { provider: params.provider, model: params.model };
      return result;
    }
    if (method === "session/prompt") {
      if (!route || shutdown) throw new Error("AI 尚未就绪");
      const id = params.sessionId;
      if (typeof id !== "string" || !/^session-[\w-]+$/.test(id)) throw new Error("无效会话");
      // rc.2's SDK creates fresh agents; existing native logs resume through its public agent API.
      if (!fresh.has(id) && !resumed.has(id) && (await ctx.sessionPersistence.stat(id))) {
        const handle = await ctx.agents.resume({ resumeSessionId: id, agentOptions: route });
        if (handle.agent.session.header.cwd !== process.env.KAITU_DIR) {
          await handle.dispose();
          throw new Error("会话不属于此工作区");
        }
        resumed.set(id, handle);
      }
      const handle = resumed.get(id);
      if (!handle) {
        const receipt = await sdk.prompt(params);
        fresh.add(id);
        return receipt;
      }
      if (
        !Array.isArray(params.contentBlocks) ||
        params.contentBlocks.some((block) => block.type !== "text" || typeof block.text !== "string")
      )
        throw new Error("请输入文字消息");
      const message = createUserMessage({ content: params.contentBlocks, source: { kind: "user" } });
      handle.agent.followup(message);
      return { messageId: message.id };
    }
    if (method === "shutdown") {
      await close();
      setImmediate(() => {
        void transport
          .flush()
          .then(() => ctx.root.fiber.dispose())
          .finally(() => process.exit(0));
      });
      return {};
    }
    throw new Error("未知 SDK 请求");
  });
  ctx.effect(() => {
    transport.start();
    return async () => {
      await close();
      transport.close();
    };
  });
}
