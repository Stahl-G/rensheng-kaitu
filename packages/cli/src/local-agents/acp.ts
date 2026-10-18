import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";

interface AcpResult {
  sessionId?: string;
  agentCapabilities?: { loadSession?: boolean; sessionCapabilities?: { resume?: boolean } };
  stopReason?: string;
}

export function connectAcp(
  child: ChildProcessWithoutNullStreams,
  options: {
    full: boolean;
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
          const allow =
            options.full &&
            frame.params?.options?.find(
              (item: { kind: string; optionId: string }) =>
                item.kind === "allow_once" || (item.kind === "allow" && item.optionId === "allow_once"),
            );
          write({
            jsonrpc: "2.0",
            id: frame.id,
            result: {
              outcome: allow ? { outcome: "selected", optionId: allow.optionId } : { outcome: "cancelled" },
            },
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
