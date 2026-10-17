import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const resolveModule = createRequire(join(process.env.KAITU_DSH_MODULES, "package.json")).resolve;
const load = (name) => import(pathToFileURL(resolveModule(name)).href);
const [
  { JsonRpcLineTransport },
  { HarnessSdkJsonRpcServer },
  { setSandboxMode },
  { setApprovalPolicy },
  { admitEncodedImages, admitEncodedFile },
] = await Promise.all([
  load("@deepseek-ai/dsh-sdk-protocol"),
  load("@deepseek-ai/dsh-sdk-jsonrpc-server"),
  load("@deepseek-ai/dsh-sandbox-policy"),
  load("@deepseek-ai/dsh-user-approval"),
  load("@deepseek-ai/dsh-attachment"),
]);
export const name = "kaitu-sdk-rpc";
export const inject = [
  "sdkAppStartup",
  "loader",
  "agents",
  "workingDirectory",
  "sessionPersistence",
  "kaitu",
  "fs",
  "llm",
  "authorization",
  "attachments",
];
export function apply(ctx) {
  const transport = new JsonRpcLineTransport(process.stdin, process.stdout);
  const sdk = new HarnessSdkJsonRpcServer(ctx, transport);
  const opened = new Set();
  const attempts = new Map();
  let initialized = false;
  let shutdown;
  const close = () => {
    shutdown ??= (async () => {
      await sdk.shutdown();
    })();
    return shutdown;
  };
  const resume = async (sessionId, stored) => {
    if (stored && stored.header.cwd !== process.env.KAITU_DIR) throw new Error("会话不属于此工作区");
    const result = await sdk.handleRequest("session/resume", { sessionId });
    const session = ctx.agents.get(sessionId).session;
    setSandboxMode(
      session,
      process.env.KAITU_AGENT_MODE === "full" ? "danger-full-access" : "workspace-write",
    );
    setApprovalPolicy(session, "never");
    opened.add(sessionId);
    return result;
  };
  transport.onRequest(async (method, params) => {
    if (method === "initialize") {
      await ctx.loader.await();
      if (params.cwd !== process.env.KAITU_DIR) throw new Error("工作区不匹配");
      if (params.capabilities) return { serverInfo: { name: "kaitu-dsh-capabilities", version: "1" } };
      const result = await sdk.initialize(params);
      initialized = true;
      return result;
    }
    if (method === "kaitu/directory") {
      return { providers: ctx.llm.listConfigurableProviders(), authorization: ctx.authorization.list() };
    }
    if (method === "kaitu/models") {
      return ctx.llm.discoverModels("llm-pi-ai", { provider: params.provider }, AbortSignal.timeout(20000));
    }
    if (method === "kaitu/sessionMention") {
      const { formatSessionReferenceMention } = await load("@deepseek-ai/dsh-session-reference");
      return formatSessionReferenceMention({ sessionId: params.sessionId, label: params.label });
    }
    if (method === "kaitu/authStart") {
      const key = params.key;
      const entry = ctx.authorization.describe(key);
      if (!entry?.methods.some((item) => item.id === params.method)) throw new Error("此服务没有该登录方式");
      if (attempts.get(key)?.status === "running") throw new Error("登录正在进行");
      const attempt = { status: "running", notices: [], prompt: null };
      attempts.set(key, attempt);
      void ctx.authorization
        .begin({
          key,
          method: params.method,
          interaction: {
            notify: (notice) => {
              attempt.notices.push(notice);
            },
            prompt: (prompt) =>
              new Promise((resolve, reject) => {
                const { signal, ...display } = prompt;
                attempt.prompt = display;
                attempt.answer = (value) => {
                  attempt.prompt = null;
                  resolve(value);
                };
                const abort = () => {
                  attempt.prompt = null;
                  reject(new Error("登录已取消"));
                };
                if (signal?.aborted) abort();
                else signal?.addEventListener("abort", abort, { once: true });
                attempt.reject = abort;
              }),
          },
        })
        .then((result) => {
          attempt.status = result.status;
        })
        .catch(() => {
          attempt.status = "failed";
          attempt.error = "登录未完成，请重试";
        })
        .finally(() => {
          attempt.prompt = null;
          attempt.answer = undefined;
          attempt.reject = undefined;
        });
      return { status: attempt.status };
    }
    if (method === "kaitu/authPoll") {
      const attempt = attempts.get(params.key);
      if (!attempt) return { status: "idle", notices: [] };
      return {
        status: attempt.status,
        notices: attempt.notices,
        prompt: attempt.prompt,
        error: attempt.error,
      };
    }
    if (method === "kaitu/authAnswer") {
      const attempt = attempts.get(params.key);
      if (!attempt?.prompt || typeof params.value !== "string") throw new Error("登录问题已结束");
      attempt.answer(params.value);
      return { accepted: true };
    }
    if (method === "kaitu/authCancel") {
      ctx.authorization.cancel(params.key);
      attempts.get(params.key)?.reject?.();
      return { cancelled: true };
    }
    if (method === "session/prompt") {
      if (!initialized || shutdown) throw new Error("AI 尚未就绪");
      const id = params.sessionId;
      if (typeof id !== "string" || !/^session-[\w-]+$/.test(id)) throw new Error("无效会话");
      // Admit a persisted identity once; the SDK owns restoration and Agent disposal.
      if (!opened.has(id)) {
        const stored = await ctx.sessionPersistence.stat(id);
        if (stored) await resume(id, stored);
        opened.add(id);
      }
      const blocks = params.contentBlocks;
      if (
        !Array.isArray(blocks) ||
        blocks.some(
          (block) =>
            !["text", "image", "file"].includes(block.type) ||
            (block.type === "text" ? typeof block.text !== "string" : typeof block.data !== "string"),
        )
      )
        throw new Error("消息内容无效");
      const imageBlocks = blocks.filter((block) => block.type === "image");
      const images = await admitEncodedImages(
        ctx.get("attachments"),
        imageBlocks.map((image) => ({
          data: image.data,
          mediaType: image.mimeType,
          name: image.name,
        })),
      );
      let imageIndex = 0;
      const content = [];
      for (const block of blocks) {
        if (block.type === "text") content.push(block);
        else if (block.type === "image") content.push({ type: "image", attachment: images[imageIndex++] });
        else {
          const attachment = await admitEncodedFile(ctx.get("attachments"), {
            data: block.data,
            name: block.name,
          });
          ctx.get("kaituAttachmentPaths")?.add(ctx.attachments.fileHostPath(attachment));
          content.push({ type: "file", attachment });
        }
      }
      return sdk.prompt({ ...params, contentBlocks: content });
    }
    if (method === "session/resume") {
      return resume(params.sessionId, await ctx.sessionPersistence.stat(params.sessionId));
    }
    if (method === "session/working-directory/get") {
      const result = await sdk.handleRequest(method, params);
      opened.add(params.sessionId);
      return result;
    }
    if (method === "session/wait") return sdk.handleRequest(method, params);

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
