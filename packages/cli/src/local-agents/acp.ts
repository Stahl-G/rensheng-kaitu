import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";

interface AcpChoice {
  value?: string;
  name?: string;
}
interface AcpResult {
  sessionId?: string;
  agentCapabilities?: { loadSession?: boolean; sessionCapabilities?: { resume?: boolean } };
  stopReason?: string;
  configOptions?: {
    id: string;
    category?: string;
    currentValue?: unknown;
    options?: (AcpChoice & { options?: AcpChoice[] })[];
  }[];
  models?: { currentModelId?: string; availableModels?: { modelId: string; name?: string }[] };
}

/** 会话可选的模型：新版 ACP 放在 configOptions 的 model 项里，旧版放在 models 里。 */
export function sessionModels(result: AcpResult) {
  const option = result.configOptions?.find((item) => item.category === "model" || item.id === "model");
  if (option)
    return {
      configId: option.id,
      current: typeof option.currentValue === "string" ? option.currentValue : undefined,
      models: (option.options ?? [])
        .flatMap((item): AcpChoice[] => item.options ?? [item])
        .map((item) => ({ id: item.value ?? "", name: item.name })),
    };
  return {
    current: result.models?.currentModelId,
    models: (result.models?.availableModels ?? []).map((item) => ({ id: item.modelId, name: item.name })),
  };
}

export function connectAcp(
  child: ChildProcessWithoutNullStreams,
  options: {
    permission?: (params: Record<string, unknown>) => Promise<string | null>;
    update: (params: Record<string, unknown>) => void;
    timeout?: number;
  },
) {
  let next = 0;
  let dead = false;
  const pending = new Map<
    number,
    { resolve: (value: AcpResult) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }
  >();
  const write = (frame: unknown) => {
    if (!dead && child.stdin.writable) child.stdin.write(`${JSON.stringify(frame)}\n`);
  };
  const lines = createInterface({ input: child.stdout });
  const fail = () => {
    dead = true;
    for (const entry of pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(new Error("ACP agent 已退出，请检查安装或登录状态后重试"));
    }
    pending.clear();
    lines.close();
  };
  child.once("error", fail);
  child.once("close", fail);
  child.stdin.on("error", fail);
  lines.on("line", (line) => {
    try {
      const frame = JSON.parse(line);
      if (frame.method && frame.id !== undefined) {
        if (frame.method === "session/request_permission") {
          void (options.permission?.(frame.params ?? {}) ?? Promise.resolve(null))
            .catch(() => null)
            .then((selected) => {
              const offered = frame.params?.options?.find(
                (item: { kind: string; optionId: string }) =>
                  item.optionId === selected &&
                  (["allow_once", "reject_once"].includes(item.kind) ||
                    (item.kind === "allow" && item.optionId === "allow_once")),
              );
              write({
                jsonrpc: "2.0",
                id: frame.id,
                result: {
                  outcome: offered
                    ? { outcome: "selected", optionId: offered.optionId }
                    : { outcome: "cancelled" },
                },
              });
            });
        } else
          write({
            jsonrpc: "2.0",
            id: frame.id,
            error: { code: -32601, message: "开图未提供文件或终端接口" },
          });
      } else if (frame.method === "session/update") options.update(frame.params);
      else if (frame.id !== undefined) {
        const entry = pending.get(frame.id);
        if (!entry) return;
        clearTimeout(entry.timer);
        pending.delete(frame.id);
        if (frame.error) entry.reject(new Error(`ACP：${frame.error.message ?? "请求失败"}`));
        else entry.resolve(frame.result);
      }
    } catch {
      /* Non-protocol diagnostics are not conversation content. */
    }
  });
  return {
    request(method: string, params: unknown, timeout = options.timeout ?? 20000): Promise<AcpResult> {
      if (dead) return Promise.reject(new Error("ACP agent 已退出"));
      const id = ++next;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`ACP ${method} 超时，请检查 agent 是否需要登录`));
        }, timeout);
        pending.set(id, { resolve, reject, timer });
        write({ jsonrpc: "2.0", id, method, params });
      });
    },
    notify(method: string, params: unknown) {
      write({ jsonrpc: "2.0", method, params });
    },
    close: fail,
  };
}
